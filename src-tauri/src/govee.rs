//! Govee LAN API (UDP).
//! Scan: multicast to 239.255.255.250:4001, replies arrive on :4002.
//! Control: unicast JSON to device:4003.

use serde::Serialize;
use socket2::{Domain, Protocol, Socket, Type};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::io;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;

#[cfg(test)]
use crate::ptreal::Frame;
use crate::zones::Rgb;

const SCAN_ADDR: Ipv4Addr = Ipv4Addr::new(239, 255, 255, 250);
const SCAN_PORT: u16 = 4001;
const LISTEN_PORT: u16 = 4002;
pub const CONTROL_PORT: u16 = 4003;
const SCAN_MSG: &[u8] = br#"{"msg":{"cmd":"scan","data":{"account_topic":"reserve"}}}"#;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub ip: String,
    pub sku: String,
}

/// Parse a scan reply. Returns `None` for anything that is not one.
pub fn parse_scan_reply(buf: &[u8]) -> Option<Device> {
    let v: serde_json::Value = serde_json::from_slice(buf).ok()?;
    let msg = v.get("msg")?;
    if msg.get("cmd")?.as_str()? != "scan" {
        return None;
    }
    let data = msg.get("data")?;
    Some(Device {
        id: data.get("device")?.as_str()?.to_string(),
        ip: data.get("ip")?.as_str()?.to_string(),
        sku: data
            .get("sku")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

fn ipv4_ifaces() -> Vec<Ipv4Addr> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback())
        .filter_map(|i| match i.ip() {
            std::net::IpAddr::V4(ip) => Some(ip),
            _ => None,
        })
        .collect()
}

/// Socket bound to :4002 that also joins the scan multicast group.
/// Firmware differs: replies go to :4002, to the sender's port, or to the
/// multicast group. Sending from this socket catches all three.
struct ScanSocket {
    sock: Socket,
    recv: UdpSocket,
    ifaces: Vec<Ipv4Addr>,
}

impl ScanSocket {
    fn open() -> io::Result<Self> {
        let sock = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
        sock.set_reuse_address(true)?;
        sock.bind(&SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, LISTEN_PORT).into())
            .map_err(|e| {
                io::Error::new(e.kind(), format!("cannot listen on UDP {LISTEN_PORT}: {e}"))
            })?;
        let ifaces = ipv4_ifaces();
        for ip in &ifaces {
            let _ = sock.join_multicast_v4(&SCAN_ADDR, ip);
        }
        let _ = sock.set_multicast_ttl_v4(2);
        let _ = sock.set_multicast_loop_v4(false);
        let recv: UdpSocket = sock.try_clone()?.into();
        recv.set_read_timeout(Some(Duration::from_millis(100)))?;
        Ok(Self { sock, recv, ifaces })
    }

    /// Send on every IPv4 interface, so VPN / Hyper-V adapters don't swallow it.
    fn send_scan(&self) {
        let dest = SocketAddr::from(SocketAddrV4::new(SCAN_ADDR, SCAN_PORT)).into();
        for ip in self.ifaces.iter().chain([&Ipv4Addr::UNSPECIFIED]) {
            if self.sock.set_multicast_if_v4(ip).is_ok() {
                let _ = self.sock.send_to(SCAN_MSG, &dest);
            }
        }
    }

    /// Unicast the scan to every host in each local /24. Fallback for routers
    /// and access points that drop multicast.
    fn send_sweep(&self) {
        for ip in &self.ifaces {
            let [a, b, c, _] = ip.octets();
            for d in 1..=254u8 {
                let to = SocketAddr::from(SocketAddrV4::new(Ipv4Addr::new(a, b, c, d), SCAN_PORT));
                let _ = self.sock.send_to(SCAN_MSG, &to.into());
            }
        }
    }

    /// `Ok(None)` on timeout or ignorable errors.
    fn recv<'a>(&self, buf: &'a mut [u8]) -> io::Result<Option<(&'a [u8], SocketAddr)>> {
        match self.recv.recv_from(buf) {
            Ok((n, from)) => Ok(Some((&buf[..n], from))),
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                Ok(None)
            }
            // Windows reports ICMP port unreachable as ConnectionReset on UDP.
            Err(e) if e.kind() == io::ErrorKind::ConnectionReset => Ok(None),
            Err(e) => Err(e),
        }
    }
}

const SCAN_ROUNDS: u32 = 3;

/// Scan the LAN for Govee devices with the LAN API enabled.
pub fn discover(timeout: Duration) -> io::Result<Vec<Device>> {
    let sock = ScanSocket::open()?;
    let start = Instant::now();
    let mut found: HashMap<String, Device> = HashMap::new();
    let mut sent = 0;
    let mut buf = [0u8; 2048];
    while start.elapsed() < timeout {
        // Several rounds: devices drop packets, some answer slowly.
        if sent < SCAN_ROUNDS && start.elapsed() >= timeout * sent / SCAN_ROUNDS {
            sock.send_scan();
            if sent == 1 {
                sock.send_sweep();
            }
            sent += 1;
        }
        if let Some((data, _)) = sock.recv(&mut buf)? {
            if let Some(d) = parse_scan_reply(data) {
                found.insert(d.id.clone(), d);
            }
        }
    }
    let mut out: Vec<Device> = found.into_values().collect();
    out.sort_by(|a, b| a.sku.cmp(&b.sku).then(a.ip.cmp(&b.ip)));
    Ok(out)
}

/// Most segments one razer packet carries.
pub const RAZER_MAX_SEGMENTS: u8 = 100;

/// Fire-and-forget control socket. Non-blocking so it never stalls the engine.
pub struct Sender {
    sock: UdpSocket,
    buf: String,
    pkt: Vec<u8>,
}

impl Sender {
    pub fn new() -> io::Result<Self> {
        let sock = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))?;
        sock.set_nonblocking(true)?;
        Ok(Self {
            sock,
            buf: String::with_capacity(128),
            pkt: Vec::with_capacity(8 + 3 * RAZER_MAX_SEGMENTS as usize),
        })
    }

    pub fn color(&mut self, to: SocketAddr, c: Rgb) {
        self.buf.clear();
        let _ = write!(
            self.buf,
            r#"{{"msg":{{"cmd":"colorwc","data":{{"color":{{"r":{},"g":{},"b":{}}},"colorTemInKelvin":0}}}}}}"#,
            c[0], c[1], c[2]
        );
        let _ = self.sock.send_to(self.buf.as_bytes(), to);
    }

    /// Switch razer streaming on or off. This is the undocumented mode Govee's
    /// DreamView and Razer Chroma use (and LedFx). While it's on, colors apply
    /// at once, skipping the device's own fade (~3 s on the H61F5).
    pub fn razer_mode(&mut self, to: SocketAddr, on: bool) {
        self.pkt.clear();
        self.pkt
            .extend_from_slice(&[0xBB, 0x00, 0x01, 0xB1, on as u8]);
        self.send_razer(to);
    }

    /// Stream one color to every segment. Needs `razer_mode` on.
    pub fn razer_color(&mut self, to: SocketAddr, c: Rgb, segments: u8) {
        let n = segments.clamp(1, RAZER_MAX_SEGMENTS);
        self.pkt.clear();
        // Header from LedFx. Byte 4: 0 = one color per segment.
        self.pkt
            .extend_from_slice(&[0xBB, 0x00, 0xFA, 0xB0, 0x00, n]);
        for _ in 0..n {
            self.pkt.extend_from_slice(&c);
        }
        self.send_razer(to);
    }

    /// Append the XOR checksum to `pkt` and send it as a `razer` command.
    fn send_razer(&mut self, to: SocketAddr) {
        let x = self.pkt.iter().fold(0, |a, b| a ^ b);
        self.pkt.push(x);
        self.buf.clear();
        self.buf.push_str(r#"{"msg":{"cmd":"razer","data":{"pt":""#);
        BASE64.encode_string(&self.pkt, &mut self.buf);
        self.buf.push_str(r#""}}}"#);
        let _ = self.sock.send_to(self.buf.as_bytes(), to);
    }

    /// Raw BLE frames through the undocumented `ptReal` command.
    #[cfg(test)]
    pub fn pt_real(&mut self, to: SocketAddr, frames: &[Frame]) {
        self.buf.clear();
        self.buf
            .push_str(r#"{"msg":{"cmd":"ptReal","data":{"command":["#);
        for (i, f) in frames.iter().enumerate() {
            if i > 0 {
                self.buf.push(',');
            }
            self.buf.push('"');
            BASE64.encode_string(f, &mut self.buf);
            self.buf.push('"');
        }
        self.buf.push_str("]}}}");
        let _ = self.sock.send_to(self.buf.as_bytes(), to);
    }

    /// Device brightness, 1-100.
    pub fn brightness(&mut self, to: SocketAddr, percent: u8) {
        self.buf.clear();
        let _ = write!(
            self.buf,
            r#"{{"msg":{{"cmd":"brightness","data":{{"value":{}}}}}}}"#,
            percent.clamp(1, 100)
        );
        let _ = self.sock.send_to(self.buf.as_bytes(), to);
    }

    pub fn turn(&mut self, to: SocketAddr, on: bool) {
        self.buf.clear();
        let _ = write!(
            self.buf,
            r#"{{"msg":{{"cmd":"turn","data":{{"value":{}}}}}}}"#,
            on as u8
        );
        let _ = self.sock.send_to(self.buf.as_bytes(), to);
    }
}

/// Hot pink: nothing in a typical scene looks like it.
const IDENTIFY_COLOR: Rgb = [255, 0, 150];
const IDENTIFY_PULSES: u32 = 3;
const IDENTIFY_PERIOD: Duration = Duration::from_millis(800);
const IDENTIFY_STEP: Duration = Duration::from_millis(40);
/// How long `identify` takes.
pub const IDENTIFY_DURATION: Duration =
    Duration::from_millis(IDENTIFY_PERIOD.as_millis() as u64 * IDENTIFY_PULSES as u64);

/// Pulse level at `t` seconds: 0 → 1 → 0 once per period, eased at both ends.
fn pulse_level(t: f32) -> f32 {
    (std::f32::consts::PI * t / IDENTIFY_PERIOD.as_secs_f32())
        .sin()
        .powi(2)
}

/// Pulse a light hot pink at full brightness so the user can tell which one it
/// is. Blocks for `IDENTIFY_DURATION`.
pub fn identify(to: SocketAddr) -> io::Result<()> {
    let mut s = Sender::new()?;
    s.turn(to, true);
    s.brightness(to, 100);
    let start = Instant::now();
    while start.elapsed() < IDENTIFY_DURATION {
        let k = pulse_level(start.elapsed().as_secs_f32());
        s.color(to, IDENTIFY_COLOR.map(|v| (v as f32 * k).round() as u8));
        std::thread::sleep(IDENTIFY_STEP);
    }
    s.color(to, [0, 0, 0]);
    Ok(())
}

pub fn control_addr(ip: &str) -> Option<SocketAddr> {
    let ip: Ipv4Addr = ip.parse().ok()?;
    Some(SocketAddrV4::new(ip, CONTROL_PORT).into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identify_pulses_from_dark_to_full_and_back() {
        let period = IDENTIFY_PERIOD.as_secs_f32();
        assert!(pulse_level(0.0) < 0.001);
        assert!((pulse_level(period / 2.0) - 1.0).abs() < 0.001);
        assert!(pulse_level(period) < 0.001);
        assert!((pulse_level(period * 1.5) - 1.0).abs() < 0.001);
    }

    #[test]
    fn parses_scan_reply() {
        let raw = br#"{"msg":{"cmd":"scan","data":{"ip":"192.168.1.23","device":"1F:80:C5:32:32:36:72:4E","sku":"H618E","bleVersionHard":"3.01.01","wifiVersionSoft":"1.02.03"}}}"#;
        assert_eq!(
            parse_scan_reply(raw),
            Some(Device {
                id: "1F:80:C5:32:32:36:72:4E".into(),
                ip: "192.168.1.23".into(),
                sku: "H618E".into(),
            })
        );
    }

    #[test]
    fn ignores_other_messages() {
        assert_eq!(
            parse_scan_reply(br#"{"msg":{"cmd":"devStatus","data":{}}}"#),
            None
        );
        assert_eq!(parse_scan_reply(b"garbage"), None);
    }

    #[test]
    fn color_message_is_valid_json() {
        let rx = UdpSocket::bind("127.0.0.1:0").unwrap();
        rx.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
        let mut s = Sender::new().unwrap();
        s.color(rx.local_addr().unwrap(), [1, 2, 3]);
        let mut buf = [0u8; 256];
        let n = rx.recv(&mut buf).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf[..n]).unwrap();
        assert_eq!(v["msg"]["cmd"], "colorwc");
        assert_eq!(v["msg"]["data"]["color"]["g"], 2);
    }

    #[test]
    fn pt_real_message_carries_base64_frames() {
        let rx = UdpSocket::bind("127.0.0.1:0").unwrap();
        rx.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
        let mut s = Sender::new().unwrap();
        s.pt_real(rx.local_addr().unwrap(), &[[0x33; 20], [0; 20]]);
        let mut buf = [0u8; 256];
        let n = rx.recv(&mut buf).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf[..n]).unwrap();
        assert_eq!(v["msg"]["cmd"], "ptReal");
        let cmds = v["msg"]["data"]["command"].as_array().unwrap();
        assert_eq!(cmds.len(), 2);
        assert_eq!(
            BASE64.decode(cmds[0].as_str().unwrap()).unwrap(),
            [0x33; 20]
        );
    }

    fn recv_razer(rx: &UdpSocket) -> Vec<u8> {
        let mut buf = [0u8; 1024];
        let n = rx.recv(&mut buf).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf[..n]).unwrap();
        assert_eq!(v["msg"]["cmd"], "razer");
        BASE64
            .decode(v["msg"]["data"]["pt"].as_str().unwrap())
            .unwrap()
    }

    #[test]
    fn razer_packets_match_ledfx() {
        let rx = UdpSocket::bind("127.0.0.1:0").unwrap();
        rx.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
        let to = rx.local_addr().unwrap();
        let mut s = Sender::new().unwrap();
        s.razer_mode(to, true);
        assert_eq!(BASE64.encode(recv_razer(&rx)), "uwABsQEK");
        s.razer_mode(to, false);
        assert_eq!(BASE64.encode(recv_razer(&rx)), "uwABsQAL");
        s.razer_color(to, [1, 2, 3], 2);
        let p = recv_razer(&rx);
        assert_eq!(p[..12], [0xBB, 0, 0xFA, 0xB0, 0, 2, 1, 2, 3, 1, 2, 3]);
        assert_eq!(p[12], p[..12].iter().fold(0, |a, b| a ^ b));
    }

    #[test]
    fn control_addr_parses() {
        assert_eq!(control_addr("10.0.0.5").unwrap().port(), CONTROL_PORT);
        assert!(control_addr("nope").is_none());
    }
}

#[cfg(test)]
mod live {
    use super::*;

    /// Needs Govee devices on the LAN: `cargo test -- --ignored live_discover --nocapture`
    #[test]
    #[ignore]
    fn live_discover() {
        let found = discover(Duration::from_secs(3)).unwrap();
        println!("found {found:#?}");
    }

    /// Razer streaming: rainbow, then a running white segment, then off.
    /// `GOVEE_IP=... cargo test -- --ignored live_razer --nocapture`
    #[test]
    #[ignore]
    fn live_razer() {
        let ip = std::env::var("GOVEE_IP").expect("set GOVEE_IP");
        let to = control_addr(&ip).expect("bad GOVEE_IP");
        let mut s = Sender::new().unwrap();
        s.turn(to, true);
        s.razer_mode(to, true);
        for c in [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]] {
            println!("{c:?}");
            for _ in 0..20 {
                s.razer_color(to, c, 10);
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        s.razer_mode(to, false);
    }

    /// Prints every packet received during a multicast scan + subnet sweep.
    /// `cargo test -- --ignored live_scan_raw --nocapture`
    #[test]
    #[ignore]
    fn live_scan_raw() {
        let sock = ScanSocket::open().unwrap();
        println!("interfaces: {:?}", sock.ifaces);
        let start = Instant::now();
        let mut buf = [0u8; 2048];
        let mut sent = 0;
        while start.elapsed() < Duration::from_secs(6) {
            if sent < 3 && start.elapsed() >= Duration::from_secs(2 * sent) {
                sock.send_scan();
                sock.send_sweep();
                sent += 1;
            }
            if let Some((data, from)) = sock.recv(&mut buf).unwrap() {
                println!("{from} -> {}", String::from_utf8_lossy(data));
            }
        }
    }
}
