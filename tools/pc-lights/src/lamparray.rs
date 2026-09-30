//! Windows Dynamic Lighting (Windows.Devices.Lights.LampArray).
//!
//! Devices that speak the HID LampArray standard show up here without any
//! vendor app. Windows only lets a background app drive them when it is
//! picked in Settings > Personalization > Dynamic Lighting, so `IsAvailable`
//! may be false for this console app.

use windows::core::HSTRING;
use windows::Devices::Enumeration::DeviceInformation;
use windows::Devices::Lights::LampArray;
use windows::UI::Color;

use crate::util::Rgb;

fn arrays() -> windows::core::Result<Vec<(HSTRING, LampArray)>> {
    let selector = LampArray::GetDeviceSelector()?;
    let infos = DeviceInformation::FindAllAsyncAqsFilter(&selector)?.join()?;
    let mut out = Vec::new();
    for info in infos {
        let id = info.Id()?;
        let array = LampArray::FromIdAsync(&id)?.join()?;
        out.push((info.Name()?, array));
    }
    Ok(out)
}

pub fn list() -> Result<(), String> {
    let arrays = arrays().map_err(|e| e.to_string())?;
    if arrays.is_empty() {
        println!("  none");
    }
    for (name, a) in arrays {
        println!(
            "  {name}: {:04X}:{:04X}, {:?}, {} lamps, available to us: {}",
            a.HardwareVendorId().unwrap_or(0),
            a.HardwareProductId().unwrap_or(0),
            a.LampArrayKind().map(|k| k.0).unwrap_or(-1),
            a.LampCount().unwrap_or(0),
            a.IsAvailable().unwrap_or(false),
        );
    }
    Ok(())
}

pub fn set(Rgb(r, g, b): Rgb) -> Result<(), String> {
    let arrays = arrays().map_err(|e| e.to_string())?;
    if arrays.is_empty() {
        return Err("no Dynamic Lighting devices found".into());
    }
    for (name, a) in arrays {
        let color = Color {
            A: 255,
            R: r,
            G: g,
            B: b,
        };
        match a.SetColor(color) {
            Ok(()) => println!(
                "{name}: -> #{r:02X}{g:02X}{b:02X} (available: {})",
                a.IsAvailable().unwrap_or(false)
            ),
            Err(e) => println!("{name}: failed: {e}"),
        }
    }
    Ok(())
}
