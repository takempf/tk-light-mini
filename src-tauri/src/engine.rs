//! Capture -> extract -> smooth -> send loop, on its own low-priority thread.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::capture::{CaptureError, Capturer};
use crate::govee::{control_addr, Sender};
use crate::zones::{extract, Rgb, Smoother, Tuning, Zone};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTarget {
    pub ip: String,
    pub zone: Zone,
    #[serde(default = "full")]
    pub brightness: f32,
    /// Experimental: stream colors in razer mode, which skips the device fade.
    #[serde(default)]
    pub razer: bool,
    /// Segments to fill in razer mode.
    #[serde(default = "one")]
    pub segments: u8,
}

fn one() -> u8 {
    1
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

pub const EVENT_ZONES: &str = "zones";
pub const EVENT_STATUS: &str = "engine-status";

/// Resend unchanged colors this often, since UDP can drop packets.
const KEEPALIVE: Duration = Duration::from_secs(1);
/// Skip sends when no channel moved more than this.
const MIN_DELTA: u8 = 2;
const PREVIEW_INTERVAL: Duration = Duration::from_millis(100);

struct Shared {
    config: Mutex<EngineConfig>,
    generation: AtomicU64,
    stop: AtomicBool,
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
        let enabled = config.enabled;
        *self.shared.config.lock() = config;
        self.shared.generation.fetch_add(1, Ordering::Release);

        let mut thread = self.thread.lock();
        if enabled && thread.as_ref().is_none_or(|t| t.is_finished()) {
            self.shared.stop.store(false, Ordering::Release);
            let shared = self.shared.clone();
            let app = app.clone();
            *thread = std::thread::Builder::new()
                .name("ambient-engine".into())
                .spawn(move || run(shared, app))
                .ok();
        } else if !enabled {
            self.stop_locked(&mut thread);
        }
    }

    pub fn set_preview(&self, on: bool) {
        self.shared.preview.store(on, Ordering::Relaxed);
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
    zone: usize,
    brightness: f32,
    /// Segment count, when this light streams in razer mode.
    razer: Option<u8>,
    /// Razer mode is switched on on the device.
    streaming: bool,
    last: Option<Rgb>,
    sent_at: Instant,
}

fn build_targets(cfg: &EngineConfig, old: &[Target]) -> Vec<Target> {
    cfg.devices
        .iter()
        .filter_map(|d| {
            let addr = control_addr(&d.ip)?;
            let razer = d.razer.then_some(d.segments.max(1));
            let prev = old.iter().find(|t| t.addr == addr);
            let same = prev.filter(|p| p.zone == d.zone.index() && p.razer == razer);
            Some(Target {
                addr,
                zone: d.zone.index(),
                brightness: d.brightness.max(0.0),
                razer,
                streaming: razer.is_some() && prev.is_some_and(|p| p.streaming),
                last: same.and_then(|p| p.last),
                sent_at: prev.map_or_else(Instant::now, |p| p.sent_at),
            })
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
    let mut target_colors = [[0u8; 3]; Zone::COUNT];
    let mut smoother = Smoother::default();
    let mut last_tick = Instant::now();
    let mut last_preview = Instant::now() - PREVIEW_INTERVAL;
    let mut turned_on: Vec<SocketAddr> = Vec::new();

    emit_status(None);

    while !shared.stop.load(Ordering::Acquire) {
        let tick = Instant::now();

        let g = shared.generation.load(Ordering::Acquire);
        if g != generation {
            generation = g;
            cfg = shared.config.lock().clone();
            let new = build_targets(&cfg, &targets);
            for addr in stopped_streams(&targets, &new) {
                sender.razer_mode(addr, false);
            }
            targets = new;
            if cfg.monitor != monitor {
                monitor = cfg.monitor;
                capturer = None;
            }
            for t in &targets {
                if !turned_on.contains(&t.addr) {
                    sender.turn(t.addr, true);
                    turned_on.push(t.addr);
                }
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

        if let Some(c) = capturer.as_mut() {
            match c.poll(|f| extract(f, &cfg.tuning)) {
                Ok(Some(z)) => target_colors = z,
                Ok(None) => {}
                Err(CaptureError::Lost) => capturer = None,
                Err(e) => {
                    eprintln!("capture: {e}");
                    capturer = None;
                }
            }
        }

        let dt = tick.duration_since(last_tick).as_secs_f32();
        last_tick = tick;
        let colors = smoother.update(&target_colors, dt, cfg.tuning.smoothing);

        let held: Vec<SocketAddr> = {
            let mut h = shared.held.lock();
            h.retain(|(_, until)| *until > tick);
            h.iter().map(|(a, _)| *a).collect()
        };
        for t in &mut targets {
            if held.contains(&t.addr) {
                // Let identify's plain color commands through.
                if t.streaming {
                    sender.razer_mode(t.addr, false);
                    t.streaming = false;
                }
                t.last = None;
                continue;
            }
            let c = scale(colors[t.zone], t.brightness);
            if let Some(n) = t.razer {
                if !t.streaming {
                    sender.razer_mode(t.addr, true);
                    t.streaming = true;
                }
                // Every frame: there's no fade to hide gaps, and it keeps the
                // stream alive.
                sender.razer_color(t.addr, c, n);
                t.last = Some(c);
                t.sent_at = tick;
                continue;
            }
            let due = t.last.is_none_or(|l| changed(l, c)) || t.sent_at.elapsed() >= KEEPALIVE;
            if due {
                sender.color(t.addr, c);
                t.last = Some(c);
                t.sent_at = tick;
            }
        }

        if shared.preview.load(Ordering::Relaxed) && last_preview.elapsed() >= PREVIEW_INTERVAL {
            last_preview = tick;
            let _ = app.emit(EVENT_ZONES, colors);
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
        let json = r#"{"enabled":true,"fps":30,"monitor":0,
            "tuning":{"saturation":1.2,"brightness":0.9,"depth":0.2,"smoothing":0.4},
            "devices":[{"ip":"192.168.1.9","zone":"left"},
                {"ip":"192.168.1.8","zone":"top","brightness":0.5}]}"#;
        let c: EngineConfig = serde_json::from_str(json).unwrap();
        assert_eq!(c.devices[0].zone, Zone::Left);
        assert_eq!(c.devices[0].brightness, 1.0, "defaults to full");
        assert_eq!(c.devices[1].brightness, 0.5);
        assert_eq!(c.tuning.depth, 0.2);
    }

    #[test]
    fn targets_keep_state_across_rebuilds() {
        let mut cfg = EngineConfig::default();
        cfg.devices.push(DeviceTarget {
            ip: "10.0.0.2".into(),
            zone: Zone::Top,
            brightness: 1.0,
            razer: false,
            segments: 1,
        });
        cfg.devices.push(DeviceTarget {
            ip: "bad".into(),
            zone: Zone::Top,
            brightness: 1.0,
            razer: false,
            segments: 1,
        });
        let mut t = build_targets(&cfg, &[]);
        assert_eq!(t.len(), 1);
        t[0].last = Some([1, 2, 3]);
        let t2 = build_targets(&cfg, &t);
        assert_eq!(t2[0].last, Some([1, 2, 3]));
        cfg.devices[0].zone = Zone::All;
        let t3 = build_targets(&cfg, &t2);
        assert_eq!(t3[0].last, None, "zone change forces resend");
    }

    fn razer_cfg(razer: bool) -> EngineConfig {
        serde_json::from_str(&format!(
            r#"{{"enabled":true,"fps":30,"monitor":0,"tuning":{{}},
            "devices":[{{"ip":"10.0.0.2","zone":"all","razer":{razer},"segments":10}},
                {{"ip":"10.0.0.3","zone":"all"}}]}}"#
        ))
        .unwrap()
    }

    #[test]
    fn razer_is_opt_in_per_light() {
        let t = build_targets(&razer_cfg(true), &[]);
        assert_eq!(t[0].razer, Some(10));
        assert_eq!(t[1].razer, None);
        assert!(!t[0].streaming, "switched on by the loop");
    }

    #[test]
    fn razer_off_or_removed_stops_the_stream() {
        let mut t = build_targets(&razer_cfg(true), &[]);
        t[0].streaming = true;
        let kept = build_targets(&razer_cfg(true), &t);
        assert!(kept[0].streaming);
        assert!(stopped_streams(&t, &kept).is_empty());
        let off = build_targets(&razer_cfg(false), &t);
        assert_eq!(stopped_streams(&t, &off), [t[0].addr]);
        assert_eq!(stopped_streams(&t, &[]), [t[0].addr]);
    }

    #[test]
    fn toggling_razer_forces_resend() {
        let mut t = build_targets(&razer_cfg(false), &[]);
        t[0].last = Some([1, 2, 3]);
        assert_eq!(build_targets(&razer_cfg(true), &t)[0].last, None);
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
