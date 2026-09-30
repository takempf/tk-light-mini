//! Corsair iCUE SDK v4: colors through iCUE instead of the USB devices.
//!
//! Reaches what iCUE reaches, RAM included, with no driver of our own. Needs
//! iCUE running with its SDK setting on, and `iCUESDK.x64_2019.dll` from
//! github.com/CorsairOfficial/cue-sdk/releases next to the exe, in the
//! current folder, or at `--dll PATH`.

use std::ffi::{c_char, c_void, CStr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::{Duration, Instant};

use libloading::Library;

use crate::util::{sleep_ms, Rgb};

const DLL: &str = "iCUESDK.x64_2019.dll";
const STRING_M: usize = 128;
const DEVICE_COUNT_MAX: usize = 64;
const LED_COUNT_MAX: usize = 512;

const STATE_CONNECTED: i32 = 6;
const TYPE_ALL: i32 = -1; // 0xFFFFFFFF
const ACCESS_EXCLUSIVE_LIGHTING: i32 = 1;

#[repr(C)]
#[derive(Clone, Copy)]
struct Version {
    major: i32,
    minor: i32,
    patch: i32,
}

#[repr(C)]
struct SessionDetails {
    client: Version,
    server: Version,
    host: Version,
}

#[repr(C)]
struct StateChanged {
    state: i32,
    details: SessionDetails,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct DeviceInfo {
    kind: i32,
    id: [c_char; STRING_M],
    serial: [c_char; STRING_M],
    model: [c_char; STRING_M],
    led_count: i32,
    channel_count: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct LedPosition {
    id: u32,
    cx: f64,
    cy: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct LedColor {
    id: u32,
    r: u8,
    g: u8,
    b: u8,
    a: u8,
}

#[repr(C)]
struct DeviceFilter {
    type_mask: i32,
}

type StateHandler = unsafe extern "C" fn(*mut c_void, *const StateChanged);

struct Sdk {
    _lib: Library,
    connect: unsafe extern "C" fn(StateHandler, *mut c_void) -> i32,
    details: unsafe extern "C" fn(*mut SessionDetails) -> i32,
    disconnect: unsafe extern "C" fn() -> i32,
    devices: unsafe extern "C" fn(*const DeviceFilter, i32, *mut DeviceInfo, *mut i32) -> i32,
    positions: unsafe extern "C" fn(*const c_char, i32, *mut LedPosition, *mut i32) -> i32,
    set_colors: unsafe extern "C" fn(*const c_char, i32, *const LedColor) -> i32,
    request_control: unsafe extern "C" fn(*const c_char, i32) -> i32,
}

static STATE: AtomicI32 = AtomicI32::new(0);

unsafe extern "C" fn on_state(_: *mut c_void, e: *const StateChanged) {
    if let Some(e) = unsafe { e.as_ref() } {
        STATE.store(e.state, Ordering::Release);
    }
}

fn state_name(s: i32) -> &'static str {
    match s {
        1 => "closed",
        2 => "connecting",
        3 => "timeout (is iCUE running?)",
        4 => "refused (turn on the SDK in iCUE settings)",
        5 => "connection lost",
        6 => "connected",
        _ => "invalid",
    }
}

fn error_name(e: i32) -> String {
    let name = match e {
        1 => "not connected (iCUE off, or its SDK setting is off)",
        2 => "no control (another app has exclusive control)",
        3 => "incompatible protocol",
        4 => "invalid arguments",
        5 => "invalid operation",
        6 => "device not found",
        7 => "not allowed",
        _ => "unknown",
    };
    format!("{name} ({e})")
}

fn check(what: &str, e: i32) -> Result<(), String> {
    if e == 0 {
        Ok(())
    } else {
        Err(format!("{what}: {}", error_name(e)))
    }
}

fn find_dll(arg: Option<&str>) -> Result<PathBuf, String> {
    let mut tries: Vec<PathBuf> = arg.map(PathBuf::from).into_iter().collect();
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
    {
        tries.push(dir.join(DLL));
    }
    tries.push(PathBuf::from(DLL));
    tries
        .iter()
        .find(|p| p.exists())
        .cloned()
        .ok_or_else(|| format!("{DLL} not found. Get it from github.com/CorsairOfficial/cue-sdk/releases, or pass --dll PATH"))
}

impl Sdk {
    fn load(dll: Option<&str>) -> Result<Self, String> {
        let path = find_dll(dll)?;
        // SAFETY: Corsair's SDK DLL; the signatures match iCUESDK.h v4.
        unsafe {
            let lib = Library::new(&path).map_err(|e| format!("load {}: {e}", path.display()))?;
            macro_rules! sym {
                ($name:literal) => {
                    *lib.get($name).map_err(|e| format!("{}: {e}", $name))?
                };
            }
            Ok(Self {
                connect: sym!("CorsairConnect"),
                details: sym!("CorsairGetSessionDetails"),
                disconnect: sym!("CorsairDisconnect"),
                devices: sym!("CorsairGetDevices"),
                positions: sym!("CorsairGetLedPositions"),
                set_colors: sym!("CorsairSetLedColors"),
                request_control: sym!("CorsairRequestControl"),
                _lib: lib,
            })
        }
    }

    /// Connects and waits up to 5 s for iCUE to answer.
    fn connect(&self) -> Result<(), String> {
        check("connect", unsafe {
            (self.connect)(on_state, std::ptr::null_mut())
        })?;
        let end = Instant::now() + Duration::from_secs(5);
        loop {
            let s = STATE.load(Ordering::Acquire);
            if s == STATE_CONNECTED {
                break;
            }
            if Instant::now() > end {
                return Err(format!("iCUE did not connect: {}", state_name(s)));
            }
            sleep_ms(50);
        }
        let mut d = SessionDetails {
            client: Version {
                major: 0,
                minor: 0,
                patch: 0,
            },
            server: Version {
                major: 0,
                minor: 0,
                patch: 0,
            },
            host: Version {
                major: 0,
                minor: 0,
                patch: 0,
            },
        };
        if unsafe { (self.details)(&mut d) } == 0 {
            let v = |v: Version| format!("{}.{}.{}", v.major, v.minor, v.patch);
            println!(
                "connected: SDK {}, server {}, iCUE {}",
                v(d.client),
                v(d.server),
                v(d.host)
            );
        }
        Ok(())
    }

    fn devices(&self) -> Result<Vec<DeviceInfo>, String> {
        let filter = DeviceFilter {
            type_mask: TYPE_ALL,
        };
        let mut out: Vec<DeviceInfo> = Vec::with_capacity(DEVICE_COUNT_MAX);
        let mut n = 0;
        check("get devices", unsafe {
            (self.devices)(&filter, DEVICE_COUNT_MAX as i32, out.as_mut_ptr(), &mut n)
        })?;
        // SAFETY: the SDK filled the first `n`.
        unsafe { out.set_len(n.clamp(0, DEVICE_COUNT_MAX as i32) as usize) };
        Ok(out)
    }

    fn positions(&self, id: &[c_char]) -> Result<Vec<LedPosition>, String> {
        let mut out = vec![LedPosition::default(); LED_COUNT_MAX];
        let mut n = 0;
        check("get LED positions", unsafe {
            (self.positions)(id.as_ptr(), LED_COUNT_MAX as i32, out.as_mut_ptr(), &mut n)
        })?;
        out.truncate(n.max(0) as usize);
        Ok(out)
    }
}

impl Drop for Sdk {
    fn drop(&mut self) {
        unsafe { (self.disconnect)() };
    }
}

fn text(s: &[c_char]) -> String {
    // SAFETY: the SDK null-terminates its strings within the array.
    unsafe { CStr::from_ptr(s.as_ptr()) }
        .to_string_lossy()
        .into_owned()
}

fn type_name(t: i32) -> String {
    let name = match t {
        0x0001 => "keyboard",
        0x0002 => "mouse",
        0x0004 => "mousemat",
        0x0008 => "headset",
        0x0010 => "headset stand",
        0x0020 => "fan LED controller",
        0x0040 => "LED controller",
        0x0080 => "memory",
        0x0100 => "cooler",
        0x0200 => "motherboard",
        0x0400 => "graphics card",
        0x0800 => "touchbar",
        0x1000 => "game controller",
        _ => return format!("type {t:#x}"),
    };
    name.into()
}

/// Matches `--type` against a device: `ram`, `cooler`, `fans`, or any word
/// in its type or model.
fn matches(d: &DeviceInfo, want: Option<&str>) -> bool {
    let Some(w) = want.map(str::to_ascii_lowercase) else {
        return true;
    };
    let t = match w.as_str() {
        "ram" | "memory" | "dram" => return d.kind == 0x0080,
        "cooler" | "pump" => return d.kind == 0x0100,
        "fans" | "node" => return d.kind == 0x0020 || d.kind == 0x0040,
        _ => w,
    };
    format!("{} {}", type_name(d.kind), text(&d.model))
        .to_ascii_lowercase()
        .contains(&t)
}

pub fn list(dll: Option<&str>) -> Result<(), String> {
    let sdk = Sdk::load(dll)?;
    sdk.connect()?;
    let devices = sdk.devices()?;
    if devices.is_empty() {
        println!("  no devices");
    }
    for d in &devices {
        println!(
            "  {:<20} {:<28} {:>3} LEDs, {} channels  id {}",
            type_name(d.kind),
            text(&d.model),
            d.led_count,
            d.channel_count,
            text(&d.id)
        );
        if let Ok(p) = sdk.positions(&d.id) {
            let ids: Vec<String> = p.iter().take(12).map(|p| format!("{}", p.id)).collect();
            let more = if p.len() > 12 { " ..." } else { "" };
            println!("  {:<20} LED ids: {}{more}", "", ids.join(" "));
        }
    }
    Ok(())
}

pub fn set(color: Rgb, want: Option<&str>, hold: u64, dll: Option<&str>) -> Result<(), String> {
    let sdk = Sdk::load(dll)?;
    sdk.connect()?;
    let devices: Vec<_> = sdk
        .devices()?
        .into_iter()
        .filter(|d| matches(d, want))
        .collect();
    if devices.is_empty() {
        return Err(format!(
            "no iCUE device matches {}",
            want.unwrap_or("anything")
        ));
    }
    let Rgb(r, g, b) = color;
    let mut plans = Vec::new();
    for d in &devices {
        // Exclusive: iCUE stops its own effects on this device while we hold it.
        if let Err(e) = check("request control", unsafe {
            (sdk.request_control)(d.id.as_ptr(), ACCESS_EXCLUSIVE_LIGHTING)
        }) {
            println!("  {}: {e}", text(&d.model));
        }
        let leds: Vec<LedColor> = sdk
            .positions(&d.id)?
            .iter()
            .map(|p| LedColor {
                id: p.id,
                r,
                g,
                b,
                a: 255,
            })
            .collect();
        plans.push((d, leds));
    }

    let end = Instant::now() + Duration::from_secs(hold.max(1));
    let mut first = true;
    while first || Instant::now() < end {
        for (d, leds) in &plans {
            let e = unsafe { (sdk.set_colors)(d.id.as_ptr(), leds.len() as i32, leds.as_ptr()) };
            if first {
                let result = check("set", e).map_or_else(|e| e, |()| "ok".into());
                println!(
                    "  {:<20} {:<28} {} LEDs -> #{r:02X}{g:02X}{b:02X}: {result}",
                    type_name(d.kind),
                    text(&d.model),
                    leds.len()
                );
            }
        }
        first = false;
        sleep_ms(250);
    }
    // Disconnecting (on drop) hands the lights back to iCUE.
    Ok(())
}
