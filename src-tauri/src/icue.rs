//! Lights inside this PC, through Corsair iCUE's SDK: fans, cooler, RAM,
//! whatever iCUE sees.
//!
//! The SDK's client DLL, `iCUESDK.x64_2019.dll` from
//! github.com/CorsairOfficial/cue-sdk/releases, goes next to the app's exe
//! (Corsair doesn't state a license for it, so the app doesn't ship it). With
//! it there, the app starts iCUE hidden in the tray when it needs it, and
//! closes it on exit if it started it. Without it, iCUE is left alone. One
//! session lasts until the app exits.
//!
//! The engine hands the latest segment colors to one thread, which stretches
//! them over each device's LEDs and sends them, so a slow reply from iCUE
//! never stalls the engine.

use libloading::Library;
use parking_lot::{Condvar, Mutex};
use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::color::Rgb;
use crate::govee::{pulse_level, Device, IDENTIFY_COLOR, IDENTIFY_DURATION};

/// App ids of iCUE lights start with this, then iCUE's device id.
pub const PREFIX: &str = "icue:";
const DLL: &str = "iCUESDK.x64_2019.dll";

const STRING_M: usize = 128;
const DEVICE_COUNT_MAX: usize = 64;
const LED_COUNT_MAX: usize = 512;
const STATE_CONNECTED: i32 = 6;
const TYPE_ALL: i32 = -1;
const TYPE_FAN_CONTROLLER: i32 = 0x0020;
const TYPE_LED_CONTROLLER: i32 = 0x0040;
const TYPE_MEMORY: i32 = 0x0080;
const PROPERTY_CHANNEL_DEVICE_COUNT: i32 = 11;
const ACCESS_EXCLUSIVE_LIGHTING: i32 = 1;
/// How long to wait for iCUE to answer a new session.
const CONNECT_WAIT: Duration = Duration::from_secs(2);
/// How long a scan waits for iCUE it just started (about 6 s on the a7200).
const LAUNCH_WAIT: Duration = Duration::from_secs(15);
/// A fresh iCUE's device list counts as complete once it holds still this long.
const SETTLED: Duration = Duration::from_secs(2);
/// Wait this long before trying iCUE again after it failed.
const RETRY: Duration = Duration::from_secs(5);
/// Resend unchanged colors this often.
const KEEPALIVE: Duration = Duration::from_secs(2);

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
#[derive(Clone, Copy)]
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

#[repr(C)]
union PropertyValue {
    int32: i32,
    /// The largest member: an array's pointer and count.
    _array: [u64; 2],
}

#[repr(C)]
struct Property {
    kind: i32,
    value: PropertyValue,
}

type StateHandler = unsafe extern "C" fn(*mut c_void, *const i32);

/// The SDK's functions, from iCUESDK.h v4.
struct Sdk {
    _lib: Library,
    connect: unsafe extern "C" fn(StateHandler, *mut c_void) -> i32,
    devices: unsafe extern "C" fn(*const DeviceFilter, i32, *mut DeviceInfo, *mut i32) -> i32,
    positions: unsafe extern "C" fn(*const c_char, i32, *mut LedPosition, *mut i32) -> i32,
    read_property: unsafe extern "C" fn(*const c_char, i32, u32, *mut Property) -> i32,
    free_property: unsafe extern "C" fn(*mut Property) -> i32,
    set_colors: unsafe extern "C" fn(*const c_char, i32, *const LedColor) -> i32,
    request_control: unsafe extern "C" fn(*const c_char, i32) -> i32,
}

/// Session state from the SDK's callback.
static STATE: AtomicI32 = AtomicI32::new(0);
/// Counts events after which the engine's thread must take its devices again
/// and resend everything: a new connection (iCUE may have restarted and
/// forgotten who had control), or colors painted outside it (identify, off).
static RESETS: AtomicU64 = AtomicU64::new(0);

/// The event starts with the new state; the versions after it aren't needed.
unsafe extern "C" fn on_state(_: *mut c_void, e: *const i32) {
    if let Some(&s) = unsafe { e.as_ref() } {
        STATE.store(s, Ordering::Release);
        if s == STATE_CONNECTED {
            RESETS.fetch_add(1, Ordering::AcqRel);
        }
    }
}

fn dll_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let p = exe.parent()?.join(DLL);
    p.exists().then_some(p)
}

impl Sdk {
    fn load() -> Result<Self, String> {
        let path = dll_path().ok_or_else(|| format!("{DLL} is not next to the app"))?;
        // SAFETY: Corsair's SDK client; the signatures match iCUESDK.h v4.
        unsafe {
            let lib = Library::new(&path).map_err(|e| format!("load {DLL}: {e}"))?;
            macro_rules! sym {
                ($name:literal) => {
                    *lib.get($name).map_err(|e| format!("{}: {e}", $name))?
                };
            }
            Ok(Self {
                connect: sym!("CorsairConnect"),
                devices: sym!("CorsairGetDevices"),
                positions: sym!("CorsairGetLedPositions"),
                read_property: sym!("CorsairReadDeviceProperty"),
                free_property: sym!("CorsairFreeProperty"),
                set_colors: sym!("CorsairSetLedColors"),
                request_control: sym!("CorsairRequestControl"),
                _lib: lib,
            })
        }
    }

    fn devices(&self) -> Result<Vec<DeviceInfo>, String> {
        let filter = DeviceFilter {
            type_mask: TYPE_ALL,
        };
        let mut out: Vec<DeviceInfo> = Vec::with_capacity(DEVICE_COUNT_MAX);
        let mut n = 0;
        check(unsafe {
            (self.devices)(&filter, DEVICE_COUNT_MAX as i32, out.as_mut_ptr(), &mut n)
        })?;
        // SAFETY: the SDK filled the first `n`.
        unsafe { out.set_len(n.clamp(0, DEVICE_COUNT_MAX as i32) as usize) };
        Ok(out)
    }

    /// LED ids in the SDK's order: for a fan hub, port by port.
    fn leds(&self, id: &CStr) -> Result<Vec<u32>, String> {
        let mut out = vec![LedPosition::default(); LED_COUNT_MAX];
        let mut n = 0;
        check(unsafe {
            (self.positions)(id.as_ptr(), LED_COUNT_MAX as i32, out.as_mut_ptr(), &mut n)
        })?;
        out.truncate(n.max(0) as usize);
        Ok(out.iter().map(|p| p.id).collect())
    }

    fn int_property(&self, id: &[c_char], property: i32, index: u32) -> Option<i32> {
        let mut p = Property {
            kind: 0,
            value: PropertyValue { int32: 0 },
        };
        if unsafe { (self.read_property)(id.as_ptr(), property, index, &mut p) } != 0 {
            return None;
        }
        // SAFETY: an Int32 property (type 1) fills `int32`; it starts zeroed.
        let v = (p.kind == 1).then_some(unsafe { p.value.int32 });
        unsafe { (self.free_property)(&mut p) };
        v
    }

    /// Segments a new light starts with: one per fan, one per RAM stick, or
    /// one for the whole device.
    fn default_segments(&self, d: &DeviceInfo) -> usize {
        match d.kind {
            TYPE_MEMORY => d.channel_count.max(1) as usize,
            TYPE_FAN_CONTROLLER | TYPE_LED_CONTROLLER => {
                let fans: i32 = (0..d.channel_count.max(0) as u32)
                    .filter_map(|c| self.int_property(&d.id, PROPERTY_CHANNEL_DEVICE_COUNT, c))
                    .sum();
                fans.max(1) as usize
            }
            _ => 1,
        }
    }

    fn paint(&self, id: &CStr, leds: &[u32], colors: &[Rgb]) -> Result<(), String> {
        let buf: Vec<LedColor> = leds
            .iter()
            .zip(colors)
            .map(|(&id, &[r, g, b])| LedColor {
                id,
                r,
                g,
                b,
                a: 255,
            })
            .collect();
        check(unsafe { (self.set_colors)(id.as_ptr(), buf.len() as i32, buf.as_ptr()) })
    }
}

fn check(e: i32) -> Result<(), String> {
    match e {
        0 => Ok(()),
        1 => Err(NOT_RUNNING.into()),
        2 => Err("another app has control of the lights".into()),
        6 => Err("iCUE doesn't have that device".into()),
        e => Err(format!("iCUE SDK error {e}")),
    }
}

fn text(s: &[c_char]) -> String {
    // SAFETY: the SDK null-terminates its strings within the array.
    unsafe { CStr::from_ptr(s.as_ptr()) }
        .to_string_lossy()
        .into_owned()
}

/// The app's one SDK session, opened on first use.
struct Session {
    sdk: Option<Sdk>,
    /// When loading or connecting last failed, to wait before trying again.
    failed_at: Option<Instant>,
}

fn session() -> &'static Mutex<Session> {
    static S: OnceLock<Mutex<Session>> = OnceLock::new();
    S.get_or_init(|| {
        Mutex::new(Session {
            sdk: None,
            failed_at: None,
        })
    })
}

const NOT_RUNNING: &str = "iCUE is not running, or its SDK setting is off";

/// Runs `f` with a connected SDK: loads it, starts iCUE if it isn't running,
/// and waits up to `wait` for it to answer. After a failure, short waits fail
/// at once for a while instead of waiting again.
fn with_sdk<R>(wait: Duration, f: impl FnOnce(&Sdk) -> Result<R, String>) -> Result<R, String> {
    let mut s = session().lock();
    let connected = || STATE.load(Ordering::Acquire) == STATE_CONNECTED;
    if !connected() && wait <= CONNECT_WAIT && s.failed_at.is_some_and(|t| t.elapsed() < RETRY) {
        return Err(NOT_RUNNING.into());
    }
    if s.sdk.is_none() {
        let sdk = Sdk::load().inspect_err(|_| s.failed_at = Some(Instant::now()))?;
        // The session reconnects by itself if iCUE restarts.
        check(unsafe { (sdk.connect)(on_state, std::ptr::null_mut()) })?;
        s.sdk = Some(sdk);
    }
    if !connected() {
        app::start();
    }
    let end = Instant::now() + wait;
    while !connected() {
        if Instant::now() > end {
            s.failed_at = Some(Instant::now());
            return Err(NOT_RUNNING.into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    s.failed_at = None;
    f(s.sdk.as_ref().expect("loaded above"))
}

/// Starting and closing iCUE itself, so the user never has to.
mod app {
    use parking_lot::Mutex;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::{Duration, Instant};

    /// When the app started iCUE, if it did: then it closes iCUE on exit.
    static STARTED: Mutex<Option<Instant>> = Mutex::new(None);
    const EXE: &str = "iCUE.exe";
    /// iCUE keeps finding devices for a while after it starts.
    const SETTLING: Duration = Duration::from_secs(20);

    #[cfg(windows)]
    fn quiet(cmd: &mut Command) -> &mut Command {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW)
    }

    #[cfg(not(windows))]
    fn quiet(cmd: &mut Command) -> &mut Command {
        cmd
    }

    fn running() -> bool {
        quiet(Command::new("tasklist").args(["/fo", "csv", "/nh", "/fi"]))
            .arg(format!("IMAGENAME eq {EXE}"))
            .output()
            .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).contains(EXE))
    }

    /// The newest `iCUE.exe` under Program Files\Corsair. Updates can leave
    /// older copies in other folders.
    fn exe() -> Option<PathBuf> {
        let corsair = PathBuf::from(std::env::var_os("ProgramFiles")?).join("Corsair");
        std::fs::read_dir(corsair)
            .ok()?
            .filter_map(|e| Some(e.ok()?.path().join(EXE)))
            .filter(|p| p.is_file())
            .max_by_key(|p| p.metadata().and_then(|m| m.modified()).ok())
    }

    /// Starts iCUE hidden in the tray (as it does at login) unless it's
    /// already running.
    pub fn start() {
        if running() {
            return;
        }
        let Some(exe) = exe() else { return };
        match Command::new(&exe).arg("--autorun").spawn() {
            Ok(_) => *STARTED.lock() = Some(Instant::now()),
            Err(e) => eprintln!("icue: start {}: {e}", exe.display()),
        }
    }

    /// The app started iCUE moments ago, and it may still be finding devices.
    pub fn settling() -> bool {
        STARTED.lock().is_some_and(|t| t.elapsed() < SETTLING)
    }

    /// Closes iCUE if the app started it.
    pub fn close() {
        if STARTED.lock().take().is_some() {
            let _ = quiet(Command::new("taskkill").args(["/f", "/t", "/im", EXE])).output();
        }
    }
}

/// On app exit: closes iCUE if the app started it. Its lights fall back to
/// their built-in effects.
pub fn close() {
    app::close();
}

/// iCUE's lights, shaped like Govee scan results. None if iCUE or its SDK
/// isn't there. Starts iCUE if needed, and waits for it.
pub fn discover() -> Vec<Device> {
    let list = || {
        with_sdk(LAUNCH_WAIT, |sdk| {
            Ok(sdk
                .devices()?
                .iter()
                .filter(|d| d.led_count > 0)
                .map(|d| {
                    let id = format!("{PREFIX}{}", text(&d.id));
                    Device {
                        ip: id.clone(),
                        id,
                        sku: text(&d.model),
                        segments: Some(sdk.default_segments(d)),
                    }
                })
                .collect::<Vec<_>>())
        })
        .unwrap_or_else(|e| {
            eprintln!("icue: {e}");
            Vec::new()
        })
    };
    let mut found = list();
    // A freshly started iCUE answers before it has found its devices, and
    // finds them one by one: wait until the list holds still.
    let end = Instant::now() + LAUNCH_WAIT;
    let mut still_since = Instant::now();
    while app::settling() && Instant::now() < end {
        if !found.is_empty() && still_since.elapsed() >= SETTLED {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
        let next = list();
        if next != found {
            found = next;
            still_since = Instant::now();
        }
    }
    found
}

/// iCUE's device id from an app id.
pub fn device_id(app_id: &str) -> Option<&str> {
    app_id.strip_prefix(PREFIX).filter(|s| !s.is_empty())
}

/// Segment colors spread over `leds` LEDs: each segment gets an even share,
/// first to last.
fn stretch(segments: &[Rgb], leds: usize, out: &mut Vec<Rgb>) {
    out.clear();
    if segments.is_empty() {
        return;
    }
    out.extend((0..leds).map(|i| segments[i * segments.len() / leds]));
}

/// A device we paint: its id for the SDK and its LEDs, in order.
struct Target {
    id: CString,
    leds: Vec<u32>,
}

/// Takes the device from iCUE's own effects and learns its LEDs.
fn take(sdk: &Sdk, device: &str) -> Result<Target, String> {
    let id = CString::new(device).map_err(|_| "bad device id".to_string())?;
    check(unsafe { (sdk.request_control)(id.as_ptr(), ACCESS_EXCLUSIVE_LIGHTING) })?;
    let leds = sdk.leds(&id)?;
    Ok(Target { id, leds })
}

/// Paints outside the engine's thread, so that thread resends its colors
/// afterwards even if they didn't change.
fn paint_all(t: &Target, color: Rgb) -> Result<(), String> {
    let r = with_sdk(CONNECT_WAIT, |sdk| {
        sdk.paint(&t.id, &t.leds, &vec![color; t.leds.len()])
    });
    RESETS.fetch_add(1, Ordering::AcqRel);
    r
}

/// Switch an iCUE light off: black. It has no power of its own.
pub fn off(device: &str) -> Result<(), String> {
    paint_all(&with_sdk(CONNECT_WAIT, |sdk| take(sdk, device))?, [0, 0, 0])
}

/// Pulse an iCUE light hot pink, like `govee::identify`. Blocks for
/// `IDENTIFY_DURATION`. The engine must hold the light meanwhile.
pub fn identify(device: &str) -> Result<(), String> {
    let t = with_sdk(CONNECT_WAIT, |sdk| take(sdk, device))?;
    let start = Instant::now();
    while start.elapsed() < IDENTIFY_DURATION {
        let k = pulse_level(start.elapsed().as_secs_f32());
        paint_all(&t, IDENTIFY_COLOR.map(|v| (v as f32 * k).round() as u8))?;
        std::thread::sleep(Duration::from_millis(40));
    }
    paint_all(&t, [0, 0, 0])
}

/// The latest colors per device, handed from the engine to the thread.
#[derive(Default)]
struct Slot {
    frames: Mutex<HashMap<Arc<str>, Vec<Rgb>>>,
    ready: Condvar,
    stop: AtomicBool,
}

fn work(slot: &Slot) {
    let mut targets: HashMap<Arc<str>, Target> = HashMap::new();
    let mut failed: HashMap<Arc<str>, Instant> = HashMap::new();
    let mut sent: HashMap<Arc<str>, (Vec<Rgb>, Instant)> = HashMap::new();
    let mut leds: Vec<Rgb> = Vec::new();
    let mut resets = RESETS.load(Ordering::Acquire);
    loop {
        let frames = {
            let mut f = slot.frames.lock();
            while f.is_empty() && !slot.stop.load(Ordering::Acquire) {
                slot.ready.wait(&mut f);
            }
            std::mem::take(&mut *f)
        };
        if slot.stop.load(Ordering::Acquire) {
            break;
        }
        let now = RESETS.load(Ordering::Acquire);
        if now != resets {
            resets = now;
            targets.clear();
            sent.clear();
        }
        for (device, segments) in frames {
            if failed.get(&device).is_some_and(|t| t.elapsed() < RETRY) {
                continue;
            }
            // iCUE keeps colors, so only changes need sending. Now and then
            // anyway, in case something else painted over them.
            if sent
                .get(&device)
                .is_some_and(|(s, at)| *s == segments && at.elapsed() < KEEPALIVE)
            {
                continue;
            }
            let r = with_sdk(CONNECT_WAIT, |sdk| {
                if !targets.contains_key(&device) {
                    targets.insert(device.clone(), take(sdk, &device)?);
                }
                let t = &targets[&device];
                stretch(&segments, t.leds.len(), &mut leds);
                sdk.paint(&t.id, &t.leds, &leds)
            });
            if let Err(e) = r {
                eprintln!("icue {device}: {e}");
                // Take it again after a pause.
                targets.remove(&device);
                sent.remove(&device);
                failed.insert(device, Instant::now());
            } else {
                failed.remove(&device);
                sent.insert(device, (segments, Instant::now()));
            }
        }
    }
}

/// The engine's iCUE lights. The thread starts on the first colors and stops
/// when dropped. Lights keep their last color, as Govee lights do; iCUE takes
/// them back when the app exits.
#[derive(Default)]
pub struct Outputs {
    slot: Arc<Slot>,
    thread: Option<JoinHandle<()>>,
}

impl Outputs {
    /// Queue `segments` for `device`, replacing colors not yet sent.
    pub fn send(&mut self, device: &Arc<str>, segments: &[Rgb]) {
        if self.thread.is_none() {
            let slot = self.slot.clone();
            self.thread = std::thread::Builder::new()
                .name("icue-lights".into())
                .spawn(move || work(&slot))
                .ok();
        }
        self.slot
            .frames
            .lock()
            .insert(device.clone(), segments.to_vec());
        self.slot.ready.notify_one();
    }
}

impl Drop for Outputs {
    fn drop(&mut self) {
        self.slot.stop.store(true, Ordering::Release);
        self.slot.ready.notify_one();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_stretch_evenly_over_leds() {
        let mut out = Vec::new();
        let six: Vec<Rgb> = (0..6).map(|i| [i, 0, 0]).collect();
        stretch(&six, 48, &mut out);
        assert_eq!(out.len(), 48);
        assert_eq!(out[0..8], [[0, 0, 0]; 8], "fan 1 is segment 1");
        assert_eq!(out[40..48], [[5, 0, 0]; 8], "fan 6 is segment 6");
        stretch(&[[9, 9, 9]], 16, &mut out);
        assert_eq!(out, [[9, 9, 9]; 16], "one segment fills the ring");
        stretch(&[], 16, &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn device_ids() {
        assert_eq!(device_id("icue:{abc}"), Some("{abc}"));
        assert_eq!(device_id("icue:"), None);
        assert_eq!(device_id("192.168.1.2"), None);
    }

    #[test]
    fn struct_sizes_match_the_sdk() {
        assert_eq!(std::mem::size_of::<DeviceInfo>(), 4 + 3 * STRING_M + 8);
        assert_eq!(std::mem::size_of::<LedPosition>(), 24);
        assert_eq!(std::mem::size_of::<LedColor>(), 8);
        assert_eq!(std::mem::size_of::<Property>(), 24);
    }

    /// Needs iCUE installed and the DLL next to the test exe. Starts iCUE if
    /// it's closed, and closes it again if so. Run with --ignored.
    #[test]
    #[ignore]
    fn live_discover() {
        let found = discover();
        println!("{found:#?}");
        assert!(!found.is_empty());
        close();
    }
}
