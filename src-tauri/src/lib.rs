mod capture;
mod engine;
mod govee;
mod paths;
#[cfg(test)]
mod ptreal;
mod zones;

use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, State};

use capture::MonitorInfo;
use engine::{Engine, EngineConfig};
use govee::Device;

#[tauri::command]
async fn discover_devices() -> Result<Vec<Device>, String> {
    tauri::async_runtime::spawn_blocking(|| govee::discover(Duration::from_millis(2500)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_monitors() -> Vec<MonitorInfo> {
    capture::list_monitors()
}

#[tauri::command]
fn set_config(app: AppHandle, engine: State<'_, Engine>, config: EngineConfig) {
    engine.apply(&app, config);
}

/// While the window is visible, the engine captures (even with sync off) and
/// sends live colors and the small screen image.
#[tauri::command]
fn set_preview(app: AppHandle, engine: State<'_, Engine>, enabled: bool) {
    engine.set_preview(&app, enabled);
}

/// Pulse a light so the user can tell which one it is. The engine leaves it
/// alone meanwhile, so sync doesn't fight the pulse.
#[tauri::command]
async fn identify_device(engine: State<'_, Engine>, ip: String) -> Result<(), String> {
    let addr = govee::control_addr(&ip).ok_or("invalid ip")?;
    engine.hold(addr, govee::IDENTIFY_DURATION + Duration::from_millis(100));
    tauri::async_runtime::spawn_blocking(move || govee::identify(addr))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Switch one light on or off. Sent twice, since UDP can drop packets; the
/// second send also lands after any color the engine still had in flight.
#[tauri::command]
async fn set_power(ip: String, on: bool) -> Result<(), String> {
    let addr = govee::control_addr(&ip).ok_or("invalid ip")?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = govee::Sender::new().map_err(|e| e.to_string())?;
        s.turn(addr, on);
        std::thread::sleep(Duration::from_millis(150));
        s.turn(addr, on);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop syncing and switch the lights off. The engine stops first so its last
/// color can't land after the off. Sent twice, since UDP can drop packets.
#[tauri::command]
async fn lights_off(engine: State<'_, Engine>, ips: Vec<String>) -> Result<(), String> {
    engine.shutdown();
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = govee::Sender::new().map_err(|e| e.to_string())?;
        let addrs: Vec<_> = ips
            .iter()
            .filter_map(|ip| govee::control_addr(ip))
            .collect();
        for round in 0..2 {
            if round > 0 {
                std::thread::sleep(Duration::from_millis(150));
            }
            for &a in &addrs {
                s.turn(a, false);
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Engine::default())
        .invoke_handler(tauri::generate_handler![
            discover_devices,
            list_monitors,
            set_config,
            set_preview,
            identify_device,
            set_power,
            lights_off
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Engine>().shutdown();
            }
        });
}
