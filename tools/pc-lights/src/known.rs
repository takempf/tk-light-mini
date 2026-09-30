//! USB RGB controllers we know about.

use crate::util::hid_api;

pub struct Known {
    pub vid: u16,
    /// `None` matches any product from the vendor.
    pub pid: Option<u16>,
    pub name: &'static str,
    /// The `pc-lights` command that drives it, if any.
    pub command: Option<&'static str>,
}

const fn k(vid: u16, pid: Option<u16>, name: &'static str, command: Option<&'static str>) -> Known {
    Known {
        vid,
        pid,
        name,
        command,
    }
}

pub const MSI: u16 = 0x1462;
pub const CORSAIR: u16 = 0x1B1C;

pub const KNOWN: &[Known] = &[
    // MSI Mystic Light boards report their board id (7C56 = B550-A PRO) as the pid.
    k(MSI, None, "MSI Mystic Light (motherboard)", Some("mystic")),
    k(
        CORSAIR,
        Some(0x0C0B),
        "Corsair Lighting Node Pro",
        Some("node"),
    ),
    k(
        CORSAIR,
        Some(0x0C1A),
        "Corsair Lighting Node CORE",
        Some("node"),
    ),
    k(CORSAIR, Some(0x0C10), "Corsair Commander Pro", Some("node")),
    k(
        CORSAIR,
        Some(0x0C17),
        "Corsair H115i Platinum",
        Some("hydro"),
    ),
    k(
        CORSAIR,
        Some(0x0C18),
        "Corsair H100i Platinum",
        Some("hydro"),
    ),
    k(
        CORSAIR,
        Some(0x0C19),
        "Corsair H100i Platinum SE",
        Some("hydro"),
    ),
    k(
        CORSAIR,
        Some(0x0C20),
        "Corsair H100i RGB PRO XT",
        Some("hydro"),
    ),
    k(
        CORSAIR,
        Some(0x0C21),
        "Corsair H115i RGB PRO XT",
        Some("hydro"),
    ),
    k(
        CORSAIR,
        Some(0x0C22),
        "Corsair H150i RGB PRO XT",
        Some("hydro"),
    ),
    k(CORSAIR, None, "Corsair (protocol not handled here)", None),
    k(0x0B05, None, "ASUS (Aura?)", None),
    k(0x048D, None, "ITE (Gigabyte RGB Fusion?)", None),
    k(0x26CE, None, "ASRock Polychrome", None),
    k(0x1E71, None, "NZXT", None),
    k(0x0CF2, None, "Lian Li", None),
];

pub fn lookup(vid: u16, pid: u16) -> Option<&'static Known> {
    KNOWN
        .iter()
        .find(|k| k.vid == vid && k.pid.is_none_or(|p| p == pid))
}

/// HID usage page Windows Dynamic Lighting devices expose.
pub const LAMPARRAY_USAGE_PAGE: u16 = 0x59;

pub fn print_known_hid() -> Result<(), String> {
    let api = hid_api()?;
    let mut seen = Vec::new();
    for d in api.device_list() {
        let id = (d.vendor_id(), d.product_id());
        let lamp = d.usage_page() == LAMPARRAY_USAGE_PAGE;
        let known = lookup(id.0, id.1);
        if (known.is_none() && !lamp) || seen.contains(&id) {
            continue;
        }
        seen.push(id);
        let name = known.map(|k| k.name).unwrap_or("Dynamic Lighting device");
        let cmd = known
            .and_then(|k| k.command)
            .or(lamp.then_some("lamp"))
            .map(|c| format!("try: pc-lights {c} ..."))
            .unwrap_or_else(|| "no test yet".into());
        println!(
            "  {:04X}:{:04X}  {:<34} \"{}\"  -> {cmd}",
            id.0,
            id.1,
            name,
            d.product_string().unwrap_or("?").trim()
        );
    }
    if seen.is_empty() {
        println!("  none");
    }
    Ok(())
}

pub fn print_all_hid() -> Result<(), String> {
    let api = hid_api()?;
    println!("  VID:PID    if  page:usage  product");
    for d in api.device_list() {
        let mark = if d.usage_page() == LAMPARRAY_USAGE_PAGE {
            "  [LampArray]"
        } else if lookup(d.vendor_id(), d.product_id()).is_some() {
            "  [RGB]"
        } else {
            ""
        };
        println!(
            "  {:04X}:{:04X} {:>3}  {:04X}:{:04X}   {} / {}{mark}",
            d.vendor_id(),
            d.product_id(),
            d.interface_number(),
            d.usage_page(),
            d.usage(),
            d.manufacturer_string().unwrap_or("?").trim(),
            d.product_string().unwrap_or("?").trim(),
        );
    }
    Ok(())
}
