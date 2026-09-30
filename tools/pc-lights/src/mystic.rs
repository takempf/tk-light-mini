//! MSI Mystic Light, 185-byte feature report boards (B550-A PRO is one).
//!
//! Layout from OpenRGB's MSIMysticLight185Controller. We read the report,
//! change only effect, color, brightness and the "single color" flag, and
//! write it back with the save byte at 0, so nothing goes to flash.

use std::path::PathBuf;

use hidapi::HidDevice;

use crate::known::MSI;
use crate::util::{hex, hid_api, open_hid, Rgb};

const REPORT_ID: u8 = 0x52;
const SIZE_185: usize = 185;
/// Other Mystic Light report sizes. Only 185 can be set here.
const OTHER_SIZES: [usize; 2] = [162, 112];
const SAVE_BYTE: usize = 184;

const MODE_OFF: u8 = 0x00;
const MODE_STATIC: u8 = 0x01;
/// Brightness 10 (max) in bits 2..6, speed 0 in bits 0..1.
const FULL_BRIGHTNESS: u8 = 10 << 2;
const BRIGHTNESS_BITS: u8 = 0x1F << 2;
/// Bit 7 of the color flags: single color, not rainbow.
const SINGLE_COLOR: u8 = 0x80;

/// Zone name and byte offset. Each zone is 10 bytes: effect, R, G, B,
/// speed/brightness, R2, G2, B2, color flags, padding. The JCORSAIR zone
/// differs after byte 3, so we only touch its effect and color.
const ZONES: [(&str, usize); 18] = [
    ("jrgb1", 1),
    ("jpipe1", 11),
    ("jpipe2", 21),
    ("jrainbow1", 31),
    ("jrainbow2", 42),
    ("jcorsair", 53),
    ("jcorsair_outer", 64),
    ("onboard0", 74),
    ("onboard1", 84),
    ("onboard2", 94),
    ("onboard3", 104),
    ("onboard4", 114),
    ("onboard5", 124),
    ("onboard6", 134),
    ("onboard7", 144),
    ("onboard8", 154),
    ("onboard9", 164),
    ("jrgb2", 174),
];

fn open() -> Result<(HidDevice, String), String> {
    let api = hid_api()?;
    open_hid(&api, "MSI Mystic Light controller", |v, _| v == MSI)
}

fn read(dev: &HidDevice, size: usize) -> Result<Vec<u8>, String> {
    let mut buf = vec![0u8; size];
    buf[0] = REPORT_ID;
    let n = dev
        .get_feature_report(&mut buf)
        .map_err(|e| format!("read {size}-byte report: {e}"))?;
    buf.truncate(n);
    Ok(buf)
}

/// Reads the 185-byte report, or says which size the board uses instead.
fn read_185(dev: &HidDevice) -> Result<Vec<u8>, String> {
    match read(dev, SIZE_185) {
        Ok(buf) if buf.len() == SIZE_185 && buf[0] == REPORT_ID => Ok(buf),
        first => {
            for size in OTHER_SIZES {
                if let Ok(buf) = read(dev, size) {
                    if buf.len() == size {
                        return Err(format!(
                            "board uses the {size}-byte report, not handled yet"
                        ));
                    }
                }
            }
            match first {
                Ok(buf) => Err(format!(
                    "unexpected report: {} bytes, id {:02X}",
                    buf.len(),
                    buf[0]
                )),
                Err(e) => Err(e),
            }
        }
    }
}

fn backup_path() -> PathBuf {
    std::env::temp_dir().join("pc-lights-mystic-backup.bin")
}

pub fn dump() -> Result<(), String> {
    let (dev, label) = open()?;
    println!("{label}");
    let buf = read_185(&dev)?;
    println!("185-byte report OK");
    println!("  zone            mode  color    bright  flags  raw");
    for (name, at) in ZONES {
        let z = &buf[at..at + 10];
        println!(
            "  {name:<15} {:<5} #{:02X}{:02X}{:02X}  {:>6}  {:02X}     {}",
            mode_name(z[0]),
            z[1],
            z[2],
            z[3],
            (z[4] & BRIGHTNESS_BITS) >> 2,
            z[8],
            hex(z)
        );
    }
    println!("  save byte: {:02X}", buf[SAVE_BYTE]);
    Ok(())
}

fn mode_name(m: u8) -> String {
    match m {
        MODE_OFF => "off".into(),
        MODE_STATIC => "static".into(),
        m => format!("{m:#04x}"),
    }
}

/// `color: None` turns the zones off.
pub fn set(color: Option<Rgb>, zone: Option<&str>) -> Result<(), String> {
    if let Some(z) = zone {
        if !ZONES.iter().any(|(n, _)| *n == z) {
            let names: Vec<_> = ZONES.iter().map(|(n, _)| *n).collect();
            return Err(format!("unknown zone {z}. Zones: {}", names.join(", ")));
        }
    }
    let (dev, label) = open()?;
    let mut buf = read_185(&dev)?;

    let backup = backup_path();
    if !backup.exists() {
        std::fs::write(&backup, &buf).map_err(|e| format!("save backup: {e}"))?;
        println!("saved original report to {}", backup.display());
    }

    for (name, at) in ZONES {
        if zone.is_some_and(|z| z != name) {
            continue;
        }
        let z = &mut buf[at..at + 10];
        match color {
            Some(Rgb(r, g, b)) => {
                z[0] = MODE_STATIC;
                z[1..4].copy_from_slice(&[r, g, b]);
                if name != "jcorsair" {
                    z[4] = FULL_BRIGHTNESS | (z[4] & !BRIGHTNESS_BITS);
                    z[8] |= SINGLE_COLOR;
                }
            }
            None => z[0] = MODE_OFF,
        }
    }
    buf[SAVE_BYTE] = 0;
    write(&dev, &buf)?;

    let what = color.map_or("off".into(), |Rgb(r, g, b)| {
        format!("#{r:02X}{g:02X}{b:02X}")
    });
    println!("{label}: {} -> {what}", zone.unwrap_or("all zones"));
    Ok(())
}

pub fn restore() -> Result<(), String> {
    let backup = backup_path();
    let mut buf = std::fs::read(&backup).map_err(|e| format!("read {}: {e}", backup.display()))?;
    if buf.len() != SIZE_185 || buf[0] != REPORT_ID {
        return Err(format!("{} is not a 185-byte report", backup.display()));
    }
    buf[SAVE_BYTE] = 0;
    let (dev, label) = open()?;
    write(&dev, &buf)?;
    std::fs::remove_file(&backup).ok();
    println!("{label}: restored the original report");
    Ok(())
}

fn write(dev: &HidDevice, buf: &[u8]) -> Result<(), String> {
    dev.send_feature_report(buf)
        .map_err(|e| format!("write report: {e}"))?;
    // Read back to confirm the board took it.
    let now = read(dev, SIZE_185)?;
    let changed: Vec<_> = ZONES
        .iter()
        .filter(|(_, at)| now[*at..*at + 4] != buf[*at..*at + 4])
        .map(|(n, _)| *n)
        .collect();
    if !changed.is_empty() {
        println!(
            "  note: board reads back differently for {}",
            changed.join(", ")
        );
    }
    Ok(())
}
