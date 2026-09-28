//! Capture -> extract -> smooth -> send loop, on its own low-priority thread.

use parking_lot::Mutex;
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;

use crate::capture::{CaptureError, Capturer};
use crate::color::{content_rect, Frame, Rect, Rgb, Smoother, Tuning};
use crate::govee::{control_addr, Sender};
use crate::paths::{PathConfig, PathSampler};

/// Where a segment gets its color: its section's path, or fixed. From JSON as
/// `"path"` or `"#rrggbb"`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Source {
    /// Segment `i` takes region `i` of the light's paths.
    Path,
    Fixed(Rgb),
}

impl Source {
    /// Color for segment `i`. `path` has the light's path colors, one per
    /// segment; black where there's none.
    fn resolve(self, path: &[Rgb], i: usize) -> Rgb {
        match self {
            Source::Path => path.get(i).copied().unwrap_or([0, 0, 0]),
            Source::Fixed(c) => c,
        }
    }
}

fn parse_hex(hex: &str) -> Option<Rgb> {
    if hex.len() != 6 || !hex.is_ascii() {
        return None;
    }
    let ch = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some([ch(0)?, ch(2)?, ch(4)?])
}

impl<'de> Deserialize<'de> for Source {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        if s == "path" {
            return Ok(Source::Path);
        }
        s.strip_prefix('#')
            .and_then(parse_hex)
            .map(Source::Fixed)
            .ok_or_else(|| D::Error::custom(format!("bad color {s}")))
    }
}

/// A run of a light's segments, placed on screen with its own path.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionConfig {
    /// Where its segments sample, one region each. None = not sampled.
    #[serde(default)]
    pub path: Option<PathConfig>,
    pub count: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTarget {
    pub ip: String,
    #[serde(default = "full")]
    pub brightness: f32,
    /// Experimental: stream colors in razer mode, which skips the device fade.
    #[serde(default)]
    pub razer: bool,
    /// One source per segment, first to last. Without razer mode the light is
    /// one segment: only the first counts.
    pub segments: Vec<Source>,
    /// The segments in order, split into sections.
    #[serde(default)]
    pub sections: Vec<SectionConfig>,
}

fn full() -> f32 {
    1.0
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    pub enabled: bool,
    pub fps: u32,
    pub monitor: u32,
    pub tuning: Tuning,
    pub devices: Vec<DeviceTarget>,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            fps: 30,
            monitor: 0,
            tuning: Tuning::default(),
            devices: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub running: bool,
    pub error: Option<String>,
}

pub const EVENT_PATHS: &str = "paths";
pub const EVENT_SCREEN: &str = "screen";
pub const EVENT_STATUS: &str = "engine-status";

/// One light's live path colors, one per segment, for the preview.
#[derive(Clone, Serialize)]
struct PathColors<'a> {
    ip: &'a str,
    colors: &'a [Rgb],
}

/// The small frame the engine samples, for drawing paths on.
#[derive(Clone, Serialize)]
struct ScreenImage {
    width: usize,
    height: usize,
    /// RGB, row by row, base64.
    rgb: String,
}

/// Resend unchanged colors this often, since UDP can drop packets.
const KEEPALIVE: Duration = Duration::from_secs(1);
/// Resend "on" this long after the last time. One packet can be dropped or
/// ignored (H6056 bars stayed off), and a light may be switched off elsewhere,
/// where color commands alone don't wake it.
const POWER_RETRY: Duration = Duration::from_secs(1);
const POWER_KEEPALIVE: Duration = Duration::from_secs(10);
/// Quick resends before settling into the keepalive.
const POWER_TRIES: u8 = 3;
/// Skip sends when no channel moved more than this.
const MIN_DELTA: u8 = 2;
const PREVIEW_INTERVAL: Duration = Duration::from_millis(100);
const SCREEN_INTERVAL: Duration = Duration::from_millis(250);

struct Shared {
    config: Mutex<EngineConfig>,
    generation: AtomicU64,
    stop: AtomicBool,
    /// The window is visible: send live colors and the screen image, and keep
    /// capturing even with sync off (for placing lights).
    preview: AtomicBool,
    /// Lights the engine leaves alone until the given time (while identifying).
    held: Mutex<Vec<(SocketAddr, Instant)>>,
}

pub struct Engine {
    shared: Arc<Shared>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Default for Engine {
    fn default() -> Self {
        Self {
            shared: Arc::new(Shared {
                config: Mutex::new(EngineConfig::default()),
                generation: AtomicU64::new(0),
                stop: AtomicBool::new(false),
                preview: AtomicBool::new(false),
                held: Mutex::new(Vec::new()),
            }),
            thread: Mutex::new(None),
        }
    }
}

impl Engine {
    pub fn apply(&self, app: &AppHandle, config: EngineConfig) {
        *self.shared.config.lock() = config;
        self.shared.generation.fetch_add(1, Ordering::Release);
        self.reconcile(app);
    }

    /// Send live colors and the screen image while the window is visible.
    pub fn set_preview(&self, app: &AppHandle, on: bool) {
        self.shared.preview.store(on, Ordering::Release);
        self.reconcile(app);
    }

    /// Run the thread while syncing or while the window shows the screen.
    fn reconcile(&self, app: &AppHandle) {
        let want = self.shared.config.lock().enabled || self.shared.preview.load(Ordering::Acquire);
        let mut thread = self.thread.lock();
        if want && thread.as_ref().is_none_or(|t| t.is_finished()) {
            self.shared.stop.store(false, Ordering::Release);
            let shared = self.shared.clone();
            let app = app.clone();
            *thread = std::thread::Builder::new()
                .name("ambient-engine".into())
                .spawn(move || run(shared, app))
                .ok();
        } else if !want {
            self.stop_locked(&mut thread);
        }
    }

    /// Stop sending to `addr` for `d`, then resend its color.
    pub fn hold(&self, addr: SocketAddr, d: Duration) {
        let until = Instant::now() + d;
        let mut held = self.shared.held.lock();
        held.retain(|(a, _)| *a != addr);
        held.push((addr, until));
    }

    pub fn shutdown(&self) {
        self.stop_locked(&mut self.thread.lock());
    }

    fn stop_locked(&self, thread: &mut Option<JoinHandle<()>>) {
        if let Some(t) = thread.take() {
            self.shared.stop.store(true, Ordering::Release);
            let _ = t.join();
        }
    }
}

struct Target {
    addr: SocketAddr,
    ip: String,
    /// One per segment.
    sources: Vec<Source>,
    brightness: f32,
    /// Streams in razer mode.
    razer: bool,
    /// Razer mode is switched on on the device.
    streaming: bool,
    last: Option<Rgb>,
    sent_at: Instant,
    /// When "on" was last sent, and how many times.
    power_at: Option<Instant>,
    power_tries: u8,
    sections: Vec<Section>,
    /// Latest path colors from the screen, one per segment, and smoothed.
    path_target: Vec<Rgb>,
    path_smoother: Smoother,
    path_colors: Vec<Rgb>,
    /// One section's samples, before they're copied into `path_target`.
    scratch: Vec<Rgb>,
}

struct Section {
    config: SectionConfig,
    /// Built on the first frame, and again when the path, sizes or picture
    /// change.
    sampler: Option<PathSampler>,
}

impl Target {
    /// Time to send "on": right away, a few quick retries, then now and then.
    /// Streaming lights get it once, before the stream starts.
    fn power_due(&self, now: Instant) -> bool {
        let Some(at) = self.power_at else { return true };
        if self.razer {
            return false;
        }
        let wait = if self.power_tries < POWER_TRIES {
            POWER_RETRY
        } else {
            POWER_KEEPALIVE
        };
        now.duration_since(at) >= wait
    }

    fn has_paths(&self) -> bool {
        self.sections.iter().any(|s| s.config.path.is_some())
    }

    /// Sample each placed section from `f`, whose picture is `rect`, into
    /// `path_target`: always when `fresh`, else only sections whose sampler
    /// had to be rebuilt. Unplaced sections are black.
    fn sample_paths(&mut self, f: &Frame, rect: Rect, t: &Tuning, fresh: bool) {
        let total: usize = self.sections.iter().map(|s| s.config.count).sum();
        self.path_target.resize(total, [0, 0, 0]);
        let mut at = 0;
        for s in &mut self.sections {
            let n = s.config.count;
            let span = at..at + n;
            at += n;
            let Some(p) = &s.config.path else {
                self.path_target[span].fill([0, 0, 0]);
                continue;
            };
            let stale = !s
                .sampler
                .as_ref()
                .is_some_and(|x| x.fits(n, f.width, f.height, rect));
            if stale {
                s.sampler = Some(PathSampler::new(p, n, f.width, f.height, rect));
            }
            if let (true, Some(x)) = (fresh || stale, s.sampler.as_mut()) {
                x.sample(f, t, &mut self.scratch);
                self.path_target[span].copy_from_slice(&self.scratch[..n]);
            }
        }
    }

    fn smooth_path(&mut self, dt: f32, smoothing: f32) {
        let c = self.path_smoother.update(&self.path_target, dt, smoothing);
        self.path_colors.clear();
        self.path_colors.extend_from_slice(c);
    }
}

/// Targets for `cfg`, taking state from `old` for the same lights.
fn build_targets(cfg: &EngineConfig, old: &mut [Target]) -> Vec<Target> {
    cfg.devices
        .iter()
        .filter_map(|d| {
            let addr = control_addr(&d.ip)?;
            let mut t = Target {
                addr,
                ip: d.ip.clone(),
                sources: d.segments.clone(),
                brightness: d.brightness.max(0.0),
                razer: d.razer,
                streaming: false,
                last: None,
                sent_at: Instant::now(),
                power_at: None,
                power_tries: 0,
                sections: d
                    .sections
                    .iter()
                    .map(|c| Section {
                        config: c.clone(),
                        sampler: None,
                    })
                    .collect(),
                path_target: Vec::new(),
                path_smoother: Smoother::default(),
                path_colors: Vec::new(),
                scratch: Vec::new(),
            };
            if let Some(p) = old.iter_mut().find(|o| o.addr == addr) {
                t.streaming = d.razer && p.streaming;
                if p.sources == t.sources && p.razer == d.razer {
                    t.last = p.last;
                }
                t.sent_at = p.sent_at;
                t.power_at = p.power_at;
                t.power_tries = p.power_tries;
                // Keep path colors across edits, so a still screen doesn't go dark.
                t.path_target = std::mem::take(&mut p.path_target);
                t.path_smoother = std::mem::take(&mut p.path_smoother);
                for (s, o) in t.sections.iter_mut().zip(&mut p.sections) {
                    if s.config.path == o.config.path {
                        s.sampler = o.sampler.take();
                    }
                }
            }
            Some(t)
        })
        .collect()
}

fn scale(c: Rgb, k: f32) -> Rgb {
    c.map(|v| (v as f32 * k).clamp(0.0, 255.0).round() as u8)
}

fn changed(a: Rgb, b: Rgb) -> bool {
    (0..3).any(|i| a[i].abs_diff(b[i]) >= MIN_DELTA)
}

/// Lights streaming in `old` that stop streaming in `new`.
fn stopped_streams(old: &[Target], new: &[Target]) -> Vec<SocketAddr> {
    old.iter()
        .filter(|o| o.streaming && !new.iter().any(|n| n.addr == o.addr && n.streaming))
        .map(|o| o.addr)
        .collect()
}

#[cfg(windows)]
fn lower_thread_priority() {
    use windows::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL,
    };
    unsafe {
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    }
}

#[cfg(not(windows))]
fn lower_thread_priority() {}

/// The latest captured frame, tightly packed. Paths and the screen image both
/// read it, and paths can be resampled from it after an edit even
/// when the screen is still (and no new frames arrive).
#[derive(Default)]
struct FrameCache {
    data: Vec<u8>,
    width: usize,
    height: usize,
}

impl FrameCache {
    fn store(&mut self, f: &Frame) {
        let row = f.width * 4;
        self.data.clear();
        for y in 0..f.height {
            let start = y * f.stride;
            self.data.extend_from_slice(&f.data[start..start + row]);
        }
        self.width = f.width;
        self.height = f.height;
    }

    fn frame(&self) -> Option<Frame<'_>> {
        (self.width > 0).then(|| Frame {
            data: &self.data,
            width: self.width,
            height: self.height,
            stride: self.width * 4,
        })
    }

    fn image(&self) -> ScreenImage {
        let rgb: Vec<u8> = self
            .data
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| [p[2], p[1], p[0]])
            .collect();
        ScreenImage {
            width: self.width,
            height: self.height,
            rgb: BASE64.encode(rgb),
        }
    }
}

fn run(shared: Arc<Shared>, app: AppHandle) {
    lower_thread_priority();
    let emit_status = |error: Option<String>| {
        let _ = app.emit(
            EVENT_STATUS,
            EngineStatus {
                running: error.is_none(),
                error,
            },
        );
    };

    let mut sender = match Sender::new() {
        Ok(s) => s,
        Err(e) => return emit_status(Some(format!("network: {e}"))),
    };

    let mut cfg = EngineConfig::default();
    let mut generation = u64::MAX;
    let mut targets: Vec<Target> = Vec::new();
    let mut capturer: Option<Capturer> = None;
    let mut monitor = u32::MAX;
    let mut last_error: Option<String> = None;
    let mut cache = FrameCache::default();
    let mut rect: Option<Rect> = None;
    let mut last_tick = Instant::now();
    let mut last_preview = Instant::now() - PREVIEW_INTERVAL;
    let mut last_screen = Instant::now() - SCREEN_INTERVAL;
    let mut screen_dirty = false;
    let mut segment_colors: Vec<Rgb> = Vec::new();

    emit_status(None);

    while !shared.stop.load(Ordering::Acquire) {
        let tick = Instant::now();

        // Resample when the config changes: tuning or paths may have.
        let mut resample = false;
        let g = shared.generation.load(Ordering::Acquire);
        if g != generation {
            generation = g;
            resample = true;
            cfg = shared.config.lock().clone();
            let mut new = build_targets(&cfg, &mut targets);
            // With sync off the thread only captures (for placing lights):
            // hand the lights back and send nothing.
            let sending: &[Target] = if cfg.enabled { &new } else { &[] };
            for addr in stopped_streams(&targets, sending) {
                sender.razer_mode(addr, false);
            }
            if !cfg.enabled {
                // Turning sync back on turns the lights on again.
                for t in &mut new {
                    t.streaming = false;
                    t.power_at = None;
                    t.power_tries = 0;
                }
            }
            targets = new;
            if cfg.monitor != monitor {
                monitor = cfg.monitor;
                capturer = None;
            }
        }
        let frame_time = Duration::from_secs_f32(1.0 / cfg.fps.clamp(5, 60) as f32);

        if capturer.is_none() {
            match Capturer::new(monitor) {
                Ok(c) => {
                    capturer = Some(c);
                    if last_error.take().is_some() {
                        emit_status(None);
                    }
                }
                Err(e) => {
                    let msg = e.to_string();
                    if last_error.as_deref() != Some(&msg) {
                        emit_status(Some(msg.clone()));
                        last_error = Some(msg);
                    }
                    sleep_while_running(&shared, Duration::from_millis(500));
                    continue;
                }
            }
        }

        let mut fresh = false;
        if let Some(c) = capturer.as_mut() {
            match c.poll(|f| cache.store(f)) {
                Ok(Some(())) => fresh = true,
                Ok(None) => {}
                Err(CaptureError::Lost) => capturer = None,
                Err(e) => {
                    eprintln!("capture: {e}");
                    capturer = None;
                }
            }
        }
        if let Some(f) = cache.frame() {
            // Only fresh frames can move the bars.
            let r = match rect {
                Some(r) if !fresh => r,
                _ => *rect.insert(content_rect(&f)),
            };
            for t in &mut targets {
                t.sample_paths(&f, r, &cfg.tuning, fresh || resample);
            }
        }

        let dt = tick.duration_since(last_tick).as_secs_f32();
        last_tick = tick;
        for t in &mut targets {
            t.smooth_path(dt, cfg.tuning.smoothing);
        }

        let held: Vec<SocketAddr> = {
            let mut h = shared.held.lock();
            h.retain(|(_, until)| *until > tick);
            h.iter().map(|(a, _)| *a).collect()
        };
        for t in targets.iter_mut().filter(|_| cfg.enabled) {
            if held.contains(&t.addr) {
                // Let identify's plain color commands through.
                if t.streaming {
                    sender.razer_mode(t.addr, false);
                    t.streaming = false;
                }
                t.last = None;
                continue;
            }
            if t.power_due(tick) {
                sender.turn(t.addr, true);
                t.power_at = Some(tick);
                t.power_tries = t.power_tries.saturating_add(1);
            }
            if t.razer {
                if !t.streaming {
                    sender.razer_mode(t.addr, true);
                    t.streaming = true;
                }
                segment_colors.clear();
                segment_colors.extend(
                    t.sources
                        .iter()
                        .enumerate()
                        .map(|(i, s)| scale(s.resolve(&t.path_colors, i), t.brightness)),
                );
                // Every frame: there's no fade to hide gaps, and it keeps the
                // stream alive.
                sender.razer_colors(t.addr, &segment_colors);
                t.sent_at = tick;
                continue;
            }
            let c = t
                .sources
                .first()
                .map_or([0, 0, 0], |s| s.resolve(&t.path_colors, 0));
            let c = scale(c, t.brightness);
            let due = t.last.is_none_or(|l| changed(l, c)) || t.sent_at.elapsed() >= KEEPALIVE;
            if due {
                sender.color(t.addr, c);
                t.last = Some(c);
                t.sent_at = tick;
            }
        }

        let preview = shared.preview.load(Ordering::Relaxed);
        if preview && last_preview.elapsed() >= PREVIEW_INTERVAL {
            last_preview = tick;
            let paths: Vec<PathColors> = targets
                .iter()
                .filter(|t| t.has_paths())
                .map(|t| PathColors {
                    ip: &t.ip,
                    colors: &t.path_colors,
                })
                .collect();
            let _ = app.emit(EVENT_PATHS, paths);
        }

        // The first frame counts as fresh, so a still screen still gets sent.
        screen_dirty |= fresh;
        if preview && screen_dirty && cache.width > 0 && last_screen.elapsed() >= SCREEN_INTERVAL {
            last_screen = tick;
            screen_dirty = false;
            let _ = app.emit(EVENT_SCREEN, cache.image());
        }

        if let Some(rest) = frame_time.checked_sub(tick.elapsed()) {
            sleep_while_running(&shared, rest);
        }
    }
    // Hand the lights back to their normal mode.
    for addr in stopped_streams(&targets, &[]) {
        sender.razer_mode(addr, false);
    }
    let _ = app.emit(
        EVENT_STATUS,
        EngineStatus {
            running: false,
            error: None,
        },
    );
}

fn sleep_while_running(shared: &Shared, d: Duration) {
    // Chunk long sleeps so stop is responsive.
    let end = Instant::now() + d;
    while !shared.stop.load(Ordering::Acquire) {
        let now = Instant::now();
        if now >= end {
            break;
        }
        std::thread::sleep((end - now).min(Duration::from_millis(50)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_deserializes_from_frontend_shape() {
        let json = r##"{"enabled":true,"fps":30,"monitor":0,
            "tuning":{"saturation":1.2,"brightness":0.9,"smoothing":0.4},
            "devices":[{"ip":"192.168.1.9","segments":["path"],
                    "sections":[{"path":null,"count":1}]},
                {"ip":"192.168.1.8","segments":["#ff8000"],"brightness":0.5}]}"##;
        let c: EngineConfig = serde_json::from_str(json).unwrap();
        assert_eq!(c.devices[0].segments, [Source::Path]);
        assert_eq!(c.devices[0].sections[0].count, 1);
        assert_eq!(c.devices[1].segments, [Source::Fixed([255, 128, 0])]);
        assert!(c.devices[1].sections.is_empty());
        assert_eq!(c.devices[0].brightness, 1.0, "defaults to full");
        assert_eq!(c.devices[1].brightness, 0.5);
    }

    #[test]
    fn old_depth_tuning_is_ignored() {
        let t: Tuning = serde_json::from_str(r#"{"depth":0.2,"smoothing":0.1}"#).unwrap();
        assert_eq!(t.smoothing, 0.1);
    }

    fn device(ip: &str, segments: Vec<Source>) -> DeviceTarget {
        DeviceTarget {
            ip: ip.into(),
            brightness: 1.0,
            razer: false,
            segments,
            sections: Vec::new(),
        }
    }

    #[test]
    fn targets_keep_state_across_rebuilds() {
        let mut cfg = EngineConfig::default();
        cfg.devices.push(device("10.0.0.2", vec![Source::Path]));
        cfg.devices.push(device("bad", vec![Source::Path]));
        let mut t = build_targets(&cfg, &mut []);
        assert_eq!(t.len(), 1);
        t[0].last = Some([1, 2, 3]);
        let mut t2 = build_targets(&cfg, &mut t);
        assert_eq!(t2[0].last, Some([1, 2, 3]));
        cfg.devices[0].segments = vec![Source::Fixed([9, 9, 9])];
        let t3 = build_targets(&cfg, &mut t2);
        assert_eq!(t3[0].last, None, "color change forces resend");
    }

    #[test]
    fn bad_colors_are_rejected() {
        for bad in ["\"#12345\"", "\"#gg0000\"", "\"middle\"", "\"top\""] {
            assert!(serde_json::from_str::<Source>(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn sources_resolve() {
        assert_eq!(Source::Fixed([7, 8, 9]).resolve(&[], 0), [7, 8, 9]);
        let path = [[1, 0, 0], [0, 1, 0]];
        assert_eq!(Source::Path.resolve(&path, 1), [0, 1, 0]);
        assert_eq!(
            Source::Path.resolve(&path, 5),
            [0, 0, 0],
            "past the end: black"
        );
        assert_eq!(Source::Path.resolve(&[], 0), [0, 0, 0], "no path: black");
    }

    /// Four vertical stripes: red, green, blue, white.
    const STRIPES: [Rgb; 4] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];

    fn stripes() -> (Vec<u8>, usize, usize) {
        let (w, h) = (40, 20);
        let mut data = Vec::new();
        for _ in 0..h {
            for x in 0..w {
                let [r, g, b] = STRIPES[x / 10];
                data.extend_from_slice(&[b, g, r, 255]);
            }
        }
        (data, w, h)
    }

    fn sample(t: &mut Target, data: &[u8], w: usize, h: usize) {
        let f = Frame {
            data,
            width: w,
            height: h,
            stride: w * 4,
        };
        let tuning = Tuning {
            saturation: 1.0,
            ..Tuning::default()
        };
        let rect = Rect {
            x0: 0,
            y0: 0,
            x1: w,
            y1: h,
        };
        t.sample_paths(&f, rect, &tuning, true);
        t.smooth_path(0.03, 0.0);
    }

    fn path_cfg(sections: &str, razer: bool) -> EngineConfig {
        serde_json::from_str(&format!(
            r#"{{"enabled":true,"fps":30,"monitor":0,"tuning":{{}},
            "devices":[{{"ip":"10.0.0.2","razer":{razer},
                "segments":["path","path","path","path"],
                "sections":{sections}}}]}}"#
        ))
        .unwrap()
    }

    const ACROSS: &str = r#"[{"path":{"points":[[0,0.5],[1,0.5]],"width":0.2},"count":4}]"#;

    #[test]
    fn path_samples_per_segment_in_razer_mode() {
        let (data, w, h) = stripes();
        let mut t = build_targets(&path_cfg(ACROSS, true), &mut []);
        sample(&mut t[0], &data, w, h);
        assert_eq!(t[0].path_colors, STRIPES);
        // Without razer mode the frontend sends one segment in one section.
        let one = r#"[{"path":{"points":[[0,0.5],[1,0.5]],"width":0.2},"count":1}]"#;
        let mut single = build_targets(&path_cfg(one, false), &mut []);
        sample(&mut single[0], &data, w, h);
        assert_eq!(single[0].path_target.len(), 1);
    }

    #[test]
    fn sections_join_in_order() {
        // Two sections of two, placed right to left then left to right. An
        // unplaced section in the middle stays black.
        let sections = r#"[
            {"path":{"points":[[1,0.5],[0.52,0.5]],"width":0.02},"count":2},
            {"path":null,"count":1},
            {"path":{"points":[[0,0.5],[0.48,0.5]],"width":0.02},"count":2}]"#;
        let (data, w, h) = stripes();
        let mut t = build_targets(&path_cfg(sections, true), &mut []);
        sample(&mut t[0], &data, w, h);
        assert_eq!(
            t[0].path_colors,
            [STRIPES[3], STRIPES[2], [0, 0, 0], STRIPES[0], STRIPES[1]]
        );
    }

    #[test]
    fn path_colors_survive_config_changes() {
        let mut t = build_targets(&path_cfg(ACROSS, true), &mut []);
        t[0].path_target = vec![[9, 9, 9]; 4];
        let mut t2 = build_targets(&path_cfg(ACROSS, true), &mut t);
        assert_eq!(t2[0].path_target, vec![[9, 9, 9]; 4]);
        // A moved path drops the sampler (rebuilt on the next frame) but keeps
        // the colors meanwhile.
        let rect = Rect {
            x0: 0,
            y0: 0,
            x1: 10,
            y1: 10,
        };
        let s = &mut t2[0].sections[0];
        s.sampler = Some(PathSampler::new(
            s.config.path.as_ref().unwrap(),
            4,
            10,
            10,
            rect,
        ));
        let moved = r#"[{"path":{"points":[[0,0.2],[1,0.2]],"width":0.2},"count":4}]"#;
        let t3 = build_targets(&path_cfg(moved, true), &mut t2);
        assert!(t3[0].sections[0].sampler.is_none());
        assert_eq!(t3[0].path_target.len(), 4);
    }

    fn razer_cfg(razer: bool) -> EngineConfig {
        serde_json::from_str(&format!(
            r##"{{"enabled":true,"fps":30,"monitor":0,"tuning":{{}},
            "devices":[{{"ip":"10.0.0.2","razer":{razer},
                    "segments":["path","path","#ff0000"]}},
                {{"ip":"10.0.0.3","segments":["path"]}}]}}"##
        ))
        .unwrap()
    }

    #[test]
    fn razer_is_opt_in_per_light() {
        let t = build_targets(&razer_cfg(true), &mut []);
        assert!(t[0].razer);
        assert_eq!(t[0].sources.len(), 3);
        assert_eq!(t[0].sources[2], Source::Fixed([255, 0, 0]));
        assert!(!t[1].razer);
        assert!(!t[0].streaming, "switched on by the loop");
    }

    #[test]
    fn razer_off_or_removed_stops_the_stream() {
        let mut t = build_targets(&razer_cfg(true), &mut []);
        t[0].streaming = true;
        let kept = build_targets(&razer_cfg(true), &mut t);
        assert!(kept[0].streaming);
        assert!(stopped_streams(&t, &kept).is_empty());
        let off = build_targets(&razer_cfg(false), &mut t);
        assert_eq!(stopped_streams(&t, &off), [t[0].addr]);
        assert_eq!(stopped_streams(&t, &[]), [t[0].addr]);
    }

    #[test]
    fn toggling_razer_forces_resend() {
        let mut t = build_targets(&razer_cfg(false), &mut []);
        t[0].last = Some([1, 2, 3]);
        assert_eq!(build_targets(&razer_cfg(true), &mut t)[0].last, None);
    }

    #[test]
    fn power_on_retries_then_keeps_alive() {
        let mut t = build_targets(&razer_cfg(false), &mut []).remove(0);
        let t0 = Instant::now();
        assert!(t.power_due(t0), "right away");
        let mut sends = 0;
        for ms in (0..30_000).step_by(100) {
            let now = t0 + Duration::from_millis(ms);
            if t.power_due(now) {
                t.power_at = Some(now);
                t.power_tries += 1;
                sends += 1;
            }
        }
        // 3 in the first 2 s, then every 10 s: at ~12 s and ~22 s.
        assert_eq!(sends, 5);
        // Kept across config changes, so edits don't resend.
        let mut old = vec![t];
        let again = build_targets(&razer_cfg(false), &mut old);
        assert_eq!(again[0].power_tries, 5);
    }

    #[test]
    fn streaming_lights_get_on_once() {
        let mut t = build_targets(&razer_cfg(true), &mut []).remove(0);
        let t0 = Instant::now();
        assert!(t.power_due(t0));
        t.power_at = Some(t0);
        t.power_tries = 1;
        assert!(!t.power_due(t0 + Duration::from_secs(60)));
    }

    #[test]
    fn per_light_brightness_scales_and_clamps() {
        assert_eq!(scale([200, 100, 0], 0.5), [100, 50, 0]);
        assert_eq!(scale([200, 100, 0], 1.5), [255, 150, 0]);
        assert_eq!(scale([200, 100, 0], 0.0), [0, 0, 0]);
    }

    #[test]
    fn small_changes_are_skipped() {
        assert!(!changed([10, 10, 10], [11, 10, 9]));
        assert!(changed([10, 10, 10], [12, 10, 10]));
    }
}
