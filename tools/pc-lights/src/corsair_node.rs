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
const CMD_RESET: u8 = 0x37;
const CMD_PORT_STATE: u8 = 0x38;
const PORT_SOFTWARE: u8 = 0x02;

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

fn run(channel: u8, colors: &[Rgb], hold: u64) -> Result<(), String> {
    let api = hid_api()?;
    let (dev, label) = open_hid(&api, "Corsair Lighting Node / Commander Pro", |v, p| {
        v == CORSAIR && lookup(v, p).and_then(|k| k.command) == Some("node")
    })?;
    println!("{label}");

    let fw = send(&dev, &[CMD_FIRMWARE])?;
    println!("  firmware {}.{}.{}", fw[1], fw[2], fw[3]);

    send(&dev, &[CMD_RESET, channel])?;
    send(&dev, &[CMD_PORT_STATE, channel, PORT_SOFTWARE])?;
    paint(&dev, channel, colors)?;

    // Resend each second so the node stays in software mode.
    let end = Instant::now() + Duration::from_secs(hold);
    while Instant::now() < end {
        sleep_ms(1000);
        paint(&dev, channel, colors)?;
    }
    Ok(())
}

fn paint(dev: &HidDevice, channel: u8, colors: &[Rgb]) -> Result<(), String> {
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
            send(dev, &pkt)?;
        }
    }
    send(dev, &[CMD_COMMIT, 0xFF])?;
    Ok(())
}

/// Writes one 64-byte report (plus report id 0) and reads the reply.
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
    // First byte is a status: 0 is OK.
    if reply[0] != 0 {
        println!("  reply to {:02X}: {}", data[0], hex(&reply[..n]));
    }
    Ok(reply)
}
