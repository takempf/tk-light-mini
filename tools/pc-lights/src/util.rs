use std::collections::HashMap;
use std::process::Command;
use std::time::Duration;

use hidapi::{HidApi, HidDevice};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

/// `red`, `ff8800`, `#ff8800` or `255,136,0`.
pub fn parse_color(s: &str) -> Result<Rgb, String> {
    let named = match s.to_ascii_lowercase().as_str() {
        "red" => Some(Rgb(255, 0, 0)),
        "green" => Some(Rgb(0, 255, 0)),
        "blue" => Some(Rgb(0, 0, 255)),
        "white" => Some(Rgb(255, 255, 255)),
        "pink" => Some(Rgb(255, 20, 147)),
        "orange" => Some(Rgb(255, 100, 0)),
        "purple" => Some(Rgb(128, 0, 255)),
        "off" | "black" => Some(Rgb(0, 0, 0)),
        _ => None,
    };
    if let Some(c) = named {
        return Ok(c);
    }
    if s.contains(',') {
        let parts: Vec<u8> = s
            .split(',')
            .map(|p| p.trim().parse::<u8>())
            .collect::<Result<_, _>>()
            .map_err(|_| format!("bad color: {s}"))?;
        if let [r, g, b] = parts[..] {
            return Ok(Rgb(r, g, b));
        }
        return Err(format!("bad color: {s}"));
    }
    let hex = s.trim_start_matches('#');
    if hex.len() == 6 {
        if let Ok(v) = u32::from_str_radix(hex, 16) {
            return Ok(Rgb((v >> 16) as u8, (v >> 8) as u8, v as u8));
        }
    }
    Err(format!("bad color: {s}"))
}

pub struct Flags(HashMap<String, String>);

impl Flags {
    pub fn str(&self, name: &str) -> Option<&str> {
        self.0.get(name).map(String::as_str)
    }

    pub fn num(&self, name: &str) -> Result<Option<u64>, String> {
        self.str(name)
            .map(|v| {
                v.parse()
                    .map_err(|_| format!("--{name} wants a number, got {v}"))
            })
            .transpose()
    }
}

/// Splits `--name value` pairs from positional args.
pub fn split_flags(args: &[String]) -> (Flags, Vec<String>) {
    let mut flags = HashMap::new();
    let mut pos = Vec::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.strip_prefix("--") {
            Some(name) if !name.is_empty() && name != "help" => {
                flags.insert(name.to_string(), it.next().cloned().unwrap_or_default());
            }
            _ => pos.push(a.clone()),
        }
    }
    (Flags(flags), pos)
}

pub fn hid_api() -> Result<HidApi, String> {
    HidApi::new().map_err(|e| format!("hidapi: {e}"))
}

/// Opens the first interface of a device matching `matches(vid, pid)`.
pub fn open_hid(
    api: &HidApi,
    what: &str,
    matches: impl Fn(u16, u16) -> bool,
) -> Result<(HidDevice, String), String> {
    let info = api
        .device_list()
        .find(|d| matches(d.vendor_id(), d.product_id()))
        .ok_or_else(|| format!("no {what} found"))?;
    let label = format!(
        "{:04X}:{:04X} {}",
        info.vendor_id(),
        info.product_id(),
        info.product_string().unwrap_or("?").trim()
    );
    let dev = info
        .open_device(api)
        .map_err(|e| format!("open {label}: {e}"))?;
    Ok((dev, label))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn sleep_secs(s: u64) {
    std::thread::sleep(Duration::from_secs(s));
}

pub fn sleep_ms(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

/// Vendor RGB apps that hold the devices and repaint them.
pub fn rgb_software_running() -> Vec<String> {
    const NAMES: [&str; 12] = [
        "iCUE.exe",
        "Corsair.Service.exe",
        "MSI.CentralServer.exe",
        "MSI Center.exe",
        "LightKeeperService.exe",
        "MysticLight.exe",
        "SignalRgb.exe",
        "OpenRGB.exe",
        "ArmouryCrate.Service.exe",
        "LightingService.exe",
        "RGBFusion.exe",
        "GCC.exe",
    ];
    let Ok(out) = Command::new("tasklist")
        .args(["/fo", "csv", "/nh"])
        .output()
    else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&out.stdout).to_ascii_lowercase();
    NAMES
        .iter()
        .filter(|n| text.contains(&format!("\"{}\"", n.to_ascii_lowercase())))
        .map(|n| n.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colors() {
        assert_eq!(parse_color("red").unwrap(), Rgb(255, 0, 0));
        assert_eq!(parse_color("#FF8800").unwrap(), Rgb(255, 136, 0));
        assert_eq!(parse_color("ff8800").unwrap(), Rgb(255, 136, 0));
        assert_eq!(parse_color("1, 2,3").unwrap(), Rgb(1, 2, 3));
        assert!(parse_color("1,2").is_err());
        assert!(parse_color("zzz").is_err());
    }

    #[test]
    fn flags() {
        let args: Vec<String> = ["node", "set", "red", "--leds", "16"]
            .map(String::from)
            .to_vec();
        let (f, pos) = split_flags(&args);
        assert_eq!(pos, ["node", "set", "red"]);
        assert_eq!(f.num("leds").unwrap(), Some(16));
        assert_eq!(f.num("hold").unwrap(), None);
    }
}
