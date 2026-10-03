//! Corsair Lighting Node CORE / PRO and Commander Pro, direct mode.
//!
//! Protocol from OpenRGB's CorsairLightingNodeController: 64-byte output
//! reports, 16-byte replies. Direct mode sends one color plane (R, G or B)
//! per packet, up to 50 LEDs each, then a commit. The node drops back to its
//! own effect if it hears nothing for a while, so `--hold` keeps resending.

use std::time::{Duration, Instant};

use hidapi::HidDevice;

use crate::known::{lookup, CORSAIR};
use crate::util::{hex, hid_api, open_hid, sleep_ms, Rgb};

const CMD_FIRMWARE: u8 = 0x02;
const CMD_DIRECT: u8 = 0x32;
const CMD_COMMIT: u8 = 0x33;
const CMD_BEGIN: u8 = 0x34;
const CMD_EFFECT: u8 = 0x35;
const CMD_RESET: u8 = 0x37;
const CMD_PORT_STATE: u8 = 0x38;
const CMD_BRIGHTNESS: u8 = 0x39;
const CMD_PORT_TYPE: u8 = 0x3B;
const PORT_HARDWARE: u8 = 0x01;
const PORT_SOFTWARE: u8 = 0x02;
const MODE_STATIC: u8 = 0x04;

const LEDS_PER_PACKET: usize = 50;
/// Six SP RGB ELITE fans (8 LEDs each), as in the Vengeance a7200.
pub const DEFAULT_LEDS: usize = 48;
pub const LEDS_PER_FAN: usize = 8;
const FAN_COUNT: usize = 6;
/// One color per fan port for `node fans`.
const FAN_COLORS: [(&str, Rgb); FAN_COUNT] = [
    ("red", Rgb(255, 0, 0)),
    ("green", Rgb(0, 255, 0)),
    ("blue", Rgb(0, 0, 255)),
    ("yellow", Rgb(255, 200, 0)),
    ("cyan", Rgb(0, 255, 255)),
    ("magenta", Rgb(255, 0, 255)),
];

pub fn set(color: Rgb, channel: u8, leds: usize, hold: u64) -> Result<(), String> {
    println!(
        "channel {channel}, {leds} LEDs -> #{:02X}{:02X}{:02X}",
        color.0, color.1, color.2
    );
    run(channel, &vec![color; leds], hold)
}

/// Gives each fan port its own color, so you can see which fan is where.
pub fn fans(channel: u8, hold: u64) -> Result<(), String> {
    let colors: Vec<Rgb> = FAN_COLORS
        .iter()
        .flat_map(|(_, c)| std::iter::repeat_n(*c, LEDS_PER_FAN))
        .collect();
    for (i, (name, _)) in FAN_COLORS.iter().enumerate() {
        println!(
            "  fan {} (LEDs {}..{}): {name}",
            i + 1,
            i * LEDS_PER_FAN,
            (i + 1) * LEDS_PER_FAN
        );
    }
    println!("  holding {hold} s");
    run(channel, &colors, hold)
}

/// A frame of colors from the frame number and the seconds since the start.
type Pattern = fn(usize, f32) -> Vec<Rgb>;

/// Patterns for `node anim`.
pub const PATTERNS: &str = "fans | rainbow | chase";

/// One hue per fan, all turning once every 10 s.
fn fans_hue(_: usize, t: f32) -> Vec<Rgb> {
    (0..DEFAULT_LEDS)
        .map(|i| hue(t / 10.0 + (i / LEDS_PER_FAN) as f32 / FAN_COUNT as f32))
        .collect()
}

/// A hue across every LED, turning once every 10 s.
fn rainbow(_: usize, t: f32) -> Vec<Rgb> {
    (0..DEFAULT_LEDS)
        .map(|i| hue(t / 10.0 + i as f32 / DEFAULT_LEDS as f32))
        .collect()
}

/// One white LED a fan, a step a frame, so a dropped frame shows as a jump.
fn chase(f: usize, _: f32) -> Vec<Rgb> {
    (0..DEFAULT_LEDS)
        .map(|i| {
            if i % LEDS_PER_FAN == f % LEDS_PER_FAN {
                Rgb(255, 255, 255)
            } else {
                Rgb(0, 0, 0)
            }
        })
        .collect()
}

/// Animates the fans at `fps` for `secs`, then reports the rate the node
/// kept up with. `fans` is what the app does (one color per fan).
pub fn anim(
    channel: u8,
    pattern: &str,
    fps: u64,
    secs: u64,
    port_type: Option<u8>,
) -> Result<(), String> {
    let pattern: Pattern = match pattern {
        "fans" => fans_hue,
        "rainbow" => rainbow,
        "chase" => chase,
        p => return Err(format!("unknown pattern {p}, try {PATTERNS}")),
    };
    let dev = open(channel, port_type)?;
    play(&dev, channel, fps, secs, pattern)?.print(fps);
    Ok(())
}

/// Numbered steps that change one thing at a time, so where the blinking
/// starts says what causes it: in-between values, moving colors, or how
/// often colors are sent.
pub fn diag(channel: u8, port_type: Option<u8>) -> Result<(), String> {
    const SECS: u64 = 8;
    let steps: [(&str, u64, Pattern); 8] = [
        ("full red, sent 1x a second", 1, |_, _| {
            vec![Rgb(255, 0, 0); DEFAULT_LEDS]
        }),
        ("full red, sent 30x a second", 30, |_, _| {
            vec![Rgb(255, 0, 0); DEFAULT_LEDS]
        }),
        ("orange (255,100,0), sent 1x a second", 1, |_, _| {
            vec![Rgb(255, 100, 0); DEFAULT_LEDS]
        }),
        ("orange (255,100,0), sent 30x a second", 30, |_, _| {
            vec![Rgb(255, 100, 0); DEFAULT_LEDS]
        }),
        ("dim white (40,40,40), sent 30x a second", 30, |_, _| {
            vec![Rgb(40, 40, 40); DEFAULT_LEDS]
        }),
        ("each fan a fixed color, sent 30x a second", 30, |_, _| {
            FAN_COLORS
                .iter()
                .flat_map(|(_, c)| [*c; LEDS_PER_FAN])
                .collect()
        }),
        ("slow rainbow, 5 frames a second", 5, rainbow),
        ("slow rainbow, 30 frames a second", 30, rainbow),
    ];
    let dev = open(channel, port_type)?;
    println!(
        "  {} steps, {SECS} s each. Note the step numbers that blink.",
        steps.len()
    );
    for (i, (what, fps, pattern)) in steps.into_iter().enumerate() {
        println!(
            "
  step {}: {what}",
            i + 1
        );
        play(&dev, channel, fps, SECS, pattern)?.print(fps);
    }
    Ok(())
}

/// What `play` measured.
struct Stats {
    writes: Vec<Duration>,
    took: Duration,
    late: usize,
    bad: usize,
}

impl Stats {
    fn print(mut self, fps: u64) {
        let n = self.writes.len().max(1);
        self.writes.sort();
        let ms = |d: Duration| d.as_secs_f64() * 1000.0;
        let pct = |p: usize| {
            self.writes
                .get((n - 1) * p / 100)
                .copied()
                .unwrap_or_default()
        };
        println!(
            "  sent {} frames in {:.1} s = {:.1} fps (asked {fps}); write median {:.1} ms, max {:.1} ms; late {}, error replies {}",
            self.writes.len(),
            self.took.as_secs_f64(),
            self.writes.len() as f64 / self.took.as_secs_f64(),
            ms(pct(50)),
            ms(pct(100)),
            self.late,
            self.bad,
        );
    }
}

/// Sends `pattern` at `fps` for `secs`.
fn play(
    dev: &HidDevice,
    channel: u8,
    fps: u64,
    secs: u64,
    pattern: Pattern,
) -> Result<Stats, String> {
    let step = Duration::from_secs_f64(1.0 / fps.clamp(1, 500) as f64);
    let mut s = Stats {
        writes: Vec::new(),
        took: Duration::ZERO,
        late: 0,
        bad: 0,
    };
    let start = Instant::now();
    let end = start + Duration::from_secs(secs);
    let mut next = start;
    while Instant::now() < end {
        let t = Instant::now();
        s.bad += paint(
            dev,
            channel,
            &pattern(s.writes.len(), start.elapsed().as_secs_f32()),
        )?;
        s.writes.push(t.elapsed());
        next += step;
        match next.checked_duration_since(Instant::now()) {
            Some(wait) => std::thread::sleep(wait),
            None => {
                s.late += 1;
                next = Instant::now();
            }
        }
    }
    s.took = start.elapsed();
    Ok(s)
}

/// Full-bright color at hue `h`, in turns (wraps).
fn hue(h: f32) -> Rgb {
    let h = h.rem_euclid(1.0);
    let x = |o: f32| {
        let k = (h * 6.0 + o) % 6.0;
        (255.0 * (1.0 - (k.min(4.0 - k).clamp(0.0, 1.0)))) as u8
    };
    Rgb(x(5.0), x(3.0), x(1.0))
}

/// Opens the node and puts `channel` in software mode, with the LED chip
/// type `port_type` if given: 1 WS2812B (SP RGB ELITE and newer), 2 UCS1903
/// (old SP fans). The node saves it.
fn open(channel: u8, port_type: Option<u8>) -> Result<HidDevice, String> {
    let dev = connect()?;
    let mut cmds = vec![vec![CMD_RESET, channel]];
    if let Some(t) = port_type {
        println!("  port type {t}");
        cmds.push(vec![CMD_PORT_TYPE, channel, t]);
    }
    cmds.push(vec![CMD_PORT_STATE, channel, PORT_SOFTWARE]);
    send_all(&dev, &cmds)?;
    Ok(dev)
}

/// Opens the node and prints its firmware.
fn connect() -> Result<HidDevice, String> {
    let api = hid_api()?;
    let (dev, label) = open_hid(&api, "Corsair Lighting Node / Commander Pro", |v, p| {
        v == CORSAIR && lookup(v, p).and_then(|k| k.command) == Some("node")
    })?;
    println!("{label}");

    let fw = send(&dev, &[CMD_FIRMWARE])?;
    println!("  firmware {}.{}.{}", fw[1], fw[2], fw[3]);
    Ok(dev)
}

/// Sends each command, printing error replies.
fn send_all(dev: &HidDevice, cmds: &[Vec<u8>]) -> Result<(), String> {
    for cmd in cmds {
        let r = send(dev, cmd)?;
        if r[0] != 0 {
            println!("  reply to {:02X}: {}", cmd[0], hex(&r));
        }
    }
    Ok(())
}

/// Hands `channel` back to the node with its own effect set to static black,
/// at brightness 0: what iCUE's hardware lighting writes, which the node
/// keeps with no software running. All-zero data also can't be garbled.
/// Command layout from OpenRGB's SetChannelEffect.
pub fn off(channel: u8) -> Result<(), String> {
    let dev = connect()?;
    let mut effect = vec![CMD_EFFECT, channel, 0, DEFAULT_LEDS as u8, MODE_STATIC];
    // Speed, direction, random, then 3 colors and 3 temperatures, all zero.
    effect.resize(effect.len() + 4 + 9 + 6, 0);
    send_all(
        &dev,
        &[
            vec![CMD_RESET, channel],
            vec![CMD_BEGIN, channel],
            vec![CMD_PORT_STATE, channel, PORT_HARDWARE],
            effect,
            vec![CMD_COMMIT, 0xFF],
            vec![CMD_BRIGHTNESS, channel, 0],
        ],
    )?;
    println!("  channel {channel}: hardware effect static black, brightness 0");
    Ok(())
}

/// Sets `channel`'s brightness, 0 to 100 percent.
pub fn brightness(channel: u8, percent: u8) -> Result<(), String> {
    let dev = connect()?;
    send_all(&dev, &[vec![CMD_BRIGHTNESS, channel, percent.min(100)]])?;
    println!("  channel {channel}: brightness {}", percent.min(100));
    Ok(())
}

fn run(channel: u8, colors: &[Rgb], hold: u64) -> Result<(), String> {
    let dev = open(channel, None)?;
    let mut bad = paint(&dev, channel, colors)?;

    // Resend each second so the node stays in software mode.
    let end = Instant::now() + Duration::from_secs(hold);
    while Instant::now() < end {
        sleep_ms(1000);
        bad += paint(&dev, channel, colors)?;
    }
    if bad > 0 {
        println!("  error replies: {bad}");
    }
    Ok(())
}

/// Sends one frame. Returns how many packets the node answered with an error.
fn paint(dev: &HidDevice, channel: u8, colors: &[Rgb]) -> Result<usize, String> {
    let mut bad = 0;
    for (i, chunk) in colors.chunks(LEDS_PER_PACKET).enumerate() {
        let start = i * LEDS_PER_PACKET;
        for plane in 0..3 {
            let mut pkt = vec![
                CMD_DIRECT,
                channel,
                start as u8,
                chunk.len() as u8,
                plane as u8,
            ];
            pkt.extend(chunk.iter().map(|&Rgb(r, g, b)| [r, g, b][plane]));
            bad += (send(dev, &pkt)?[0] != 0) as usize;
        }
    }
    bad += (send(dev, &[CMD_COMMIT, 0xFF])?[0] != 0) as usize;
    Ok(bad)
}

/// Writes one 64-byte report (plus report id 0) and reads the reply. The
/// reply's first byte is a status: 0 is OK.
fn send(dev: &HidDevice, data: &[u8]) -> Result<[u8; 16], String> {
    let mut buf = [0u8; 65];
    buf[1..1 + data.len()].copy_from_slice(data);
    dev.write(&buf)
        .map_err(|e| format!("write {:02X}: {e}", data[0]))?;
    let mut reply = [0u8; 16];
    let n = dev
        .read_timeout(&mut reply, 500)
        .map_err(|e| format!("read {:02X}: {e}", data[0]))?;
    if n == 0 {
        return Err(format!("no reply to {:02X}", data[0]));
    }
    Ok(reply)
}
