mod capture;
mod color;
mod startup;

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::Response;
use tauri::{Manager, State, WindowEvent};

struct Worker {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

#[derive(Default)]
struct CaptureState {
    worker: Mutex<Option<Worker>>,
    latest: Arc<Mutex<Vec<u8>>>,
    sequence: Arc<AtomicU32>,
}

fn encode_frame(frame: &color::Frame<'_>, sequence: u32, captured_at: f64) -> Option<Vec<u8>> {
    if frame.width == 0 || frame.height == 0 || frame.width > 256 || frame.height > 256 {
        return None;
    }
    let mut packet = Vec::with_capacity(20 + frame.width * frame.height * 4);
    packet.extend_from_slice(b"TKL1");
    packet.extend_from_slice(&(frame.width as u16).to_le_bytes());
    packet.extend_from_slice(&(frame.height as u16).to_le_bytes());
    packet.extend_from_slice(&sequence.to_le_bytes());
    packet.extend_from_slice(&captured_at.to_le_bytes());
    for y in 0..frame.height {
        let row = y * frame.stride;
        packet.extend_from_slice(&frame.data[row..row + frame.width * 4]);
    }
    Some(packet)
}

impl CaptureState {
    fn start(&self, monitor: u32) {
        self.stop();
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let latest = self.latest.clone();
        let sequence = self.sequence.clone();
        let handle = std::thread::spawn(move || {
            let mut capturer = None;
            while !thread_stop.load(Ordering::Relaxed) {
                if capturer.is_none() {
                    capturer = capture::Capturer::new(monitor).ok();
                    if capturer.is_none() {
                        std::thread::sleep(Duration::from_millis(500));
                        continue;
                    }
                }
                if let Some(c) = capturer.as_mut() {
                    match c.poll(|frame| {
                        let at = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs_f64()
                            * 1000.0;
                        if let Some(packet) =
                            encode_frame(frame, sequence.fetch_add(1, Ordering::Relaxed) + 1, at)
                        {
                            *latest.lock() = packet;
                        }
                    }) {
                        Ok(_) => {}
                        Err(_) => capturer = None,
                    }
                }
                std::thread::sleep(Duration::from_millis(16));
            }
        });
        *self.worker.lock() = Some(Worker { stop, handle });
    }

    fn stop(&self) {
        if let Some(worker) = self.worker.lock().take() {
            worker.stop.store(true, Ordering::Relaxed);
            let _ = worker.handle.join();
        }
        self.latest.lock().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_packet_matches_the_publish_protocol() {
        let data = [3, 2, 1, 255, 99, 99, 99, 99, 6, 5, 4, 255];
        let frame = color::Frame {
            data: &data,
            width: 1,
            height: 2,
            stride: 8,
        };
        let bytes = encode_frame(&frame, 7, 100.0).unwrap();
        assert_eq!(&bytes[..4], b"TKL1");
        assert_eq!(u16::from_le_bytes(bytes[4..6].try_into().unwrap()), 1);
        assert_eq!(u16::from_le_bytes(bytes[6..8].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(bytes[8..12].try_into().unwrap()), 7);
        assert_eq!(f64::from_le_bytes(bytes[12..20].try_into().unwrap()), 100.0);
        assert_eq!(&bytes[20..], &[3, 2, 1, 255, 6, 5, 4, 255]);
    }
}

#[tauri::command]
fn list_monitors() -> Vec<capture::MonitorInfo> {
    capture::list_monitors()
}

#[tauri::command]
fn set_monitor(state: State<'_, CaptureState>, index: u32) {
    state.start(index);
}

#[tauri::command]
fn stop_capture(state: State<'_, CaptureState>) {
    state.stop();
}

#[tauri::command]
fn next_frame(state: State<'_, CaptureState>, after: u32) -> Response {
    let latest = state.latest.lock();
    if latest.len() < 12
        || u32::from_le_bytes(latest[8..12].try_into().unwrap_or_default()) <= after
    {
        Response::new(Vec::new())
    } else {
        Response::new(latest.clone())
    }
}

#[tauri::command]
fn autostart() -> bool {
    startup::enabled()
}

#[tauri::command]
fn set_autostart(on: bool) -> Result<(), String> {
    startup::set(on)
}

pub fn run() {
    tauri::Builder::default()
        .manage(CaptureState::default())
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("sender")
                .menu(&menu)
                .tooltip("Screen sender")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            if !std::env::args().any(|arg| arg == startup::HIDDEN_ARG) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_monitors,
            set_monitor,
            stop_capture,
            next_frame,
            autostart,
            set_autostart
        ])
        .build(tauri::generate_context!())
        .expect("failed to build sender")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<CaptureState>().stop();
            }
        });
}
