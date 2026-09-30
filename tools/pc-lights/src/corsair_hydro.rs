//! Corsair Hydro Platinum and RGB PRO XT coolers (pump head LEDs).
//!
//! Protocol from liquidctl's hydro_platinum driver: 64-byte reports that
//! start with 0x3F, then a sequence number (bits 3..7) and a command
//! (bits 0..2), and end with a CRC-8 (SMBus PEC) of bytes 1..63. Colors go
//! out as B, G, R, 20 LEDs per packet. The PRO XT has 16 LEDs on the pump.

use std::time::{Duration, Instant};

use hidapi::HidDevice;

use crate::known::{lookup, CORSAIR};
use crate::util::{hex, hid_api, open_hid, sleep_ms, Rgb};

const PREFIX: u8 = 0x3F;
/// Lighting commands for LEDs 0..20, 20..40, 40..60.
const CMD_LIGHTING: [u8; 3] = [0b100, 0b101, 0b110];
const LEDS_PER_PACKET: usize = 20;
pub const DEFAULT_LEDS: usize = 16;

pub fn set(color: Rgb, leds: usize, hold: u64) -> Result<(), String> {
    if leds > LEDS_PER_PACKET * CMD_LIGHTING.len() {
        return Err(format!(
            "at most {} LEDs",
            LEDS_PER_PACKET * CMD_LIGHTING.len()
        ));
    }
    let api = hid_api()?;
    let (dev, label) = open_hid(&api, "Corsair Hydro Platinum / PRO XT cooler", |v, p| {
        v == CORSAIR && lookup(v, p).and_then(|k| k.command) == Some("hydro")
    })?;
    println!("{label}");

    let mut seq = 0u8;
    paint(&dev, &mut seq, leds, color, true)?;
    println!(
        "  {leds} LEDs -> #{:02X}{:02X}{:02X}",
        color.0, color.1, color.2
    );

    let end = Instant::now() + Duration::from_secs(hold);
    while Instant::now() < end {
        sleep_ms(1000);
        paint(&dev, &mut seq, leds, color, false)?;
    }
    Ok(())
}

fn paint(
    dev: &HidDevice,
    seq: &mut u8,
    leds: usize,
    Rgb(r, g, b): Rgb,
    verbose: bool,
) -> Result<(), String> {
    let bgr: Vec<u8> = std::iter::repeat_n([b, g, r], leds).flatten().collect();
    for (i, chunk) in bgr.chunks(LEDS_PER_PACKET * 3).enumerate() {
        let reply = send(dev, seq, CMD_LIGHTING[i], chunk)?;
        if verbose {
            println!("  reply: {}", hex(&reply[..8]));
        }
    }
    Ok(())
}

fn send(dev: &HidDevice, seq: &mut u8, cmd: u8, data: &[u8]) -> Result<[u8; 64], String> {
    // Sequence runs 1..=31 and never 0.
    *seq = *seq % 31 + 1;
    let mut buf = [0u8; 65];
    buf[1] = PREFIX;
    buf[2] = *seq << 3 | cmd;
    buf[3..3 + data.len()].copy_from_slice(data);
    buf[64] = pec(&buf[2..64]);
    dev.write(&buf).map_err(|e| format!("write: {e}"))?;

    let mut reply = [0u8; 64];
    let n = dev
        .read_timeout(&mut reply, 500)
        .map_err(|e| format!("read: {e}"))?;
    if n == 0 {
        return Err("no reply".into());
    }
    if pec(&reply[1..n - 1]) != reply[n - 1] {
        println!("  warning: reply CRC mismatch: {}", hex(&reply[..n]));
    }
    Ok(reply)
}

/// CRC-8, polynomial 0x07, init 0 (SMBus PEC).
fn pec(data: &[u8]) -> u8 {
    data.iter().fold(0u8, |mut crc, &byte| {
        crc ^= byte;
        for _ in 0..8 {
            crc = if crc & 0x80 != 0 {
                crc << 1 ^ 0x07
            } else {
                crc << 1
            };
        }
        crc
    })
}

#[cfg(test)]
mod tests {
    use super::pec;

    #[test]
    fn pec_matches_crc8_smbus() {
        // CRC-8/SMBUS check value.
        assert_eq!(pec(b"123456789"), 0xF4);
        assert_eq!(pec(&[]), 0);
    }
}
