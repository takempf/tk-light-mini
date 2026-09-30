mod app_icon;
mod calibration;
mod capture;
mod color;
mod engine;
mod govee;
mod icue;
mod instance;
mod paths;
mod preview;
#[cfg(test)]
mod ptreal;
mod setup_file;
mod startup;
mod visuals;

use std::time::Duration;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, RunEvent, State, Window, WindowEvent};

use capture::MonitorInfo;
use engine::{Dest, Engine, EngineConfig};
use govee::Device;

/// Govee lights on the network, then lights inside this PC (through iCUE).
#[tauri::command]
async fn discover_devices() -> Result<Vec<Device>, String> {
    let pcs = tauri::async_runtime::spawn_blocking(icue::discover);
    let mut found =
        tauri::async_runtime::spawn_blocking(|| govee::discover(Duration::from_millis(2500)))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    found.extend(pcs.await.unwrap_or_default());
    Ok(found)
}

#[tauri::command]
fn list_monitors() -> Vec<MonitorInfo> {
    capture::list_monitors()
}

#[tauri::command]
fn set_config(engine: State<'_, Engine>, config: EngineConfig) {
    engine.apply(config);
}

/// While the window is visible, the engine captures (even with sync off) and
/// keeps live colors and the small screen image for `next_preview`.
/// A window started hidden may still call itself visible; that's ignored.
#[tauri::command]
fn set_preview(window: Window, engine: State<'_, Engine>, enabled: bool) {
    engine.set_preview(enabled && window.is_visible().unwrap_or(true));
}

/// Whether the app starts with Windows.
#[tauri::command]
fn autostart() -> bool {
    startup::enabled()
}

#[tauri::command]
fn set_autostart(on: bool) -> Result<(), String> {
    startup::set(on)
}

/// Engine status, live colors and the screen image that changed after `after`,
/// as raw bytes (see `preview.rs`). Waits up to a second for a change. The
/// window polls this instead of listening for events, which Tauri delivers by
/// eval'ing script.
#[tauri::command]
async fn next_preview(engine: State<'_, Engine>, after: u64) -> Result<Response, String> {
    let preview = engine.preview();
    tauri::async_runtime::spawn_blocking(move || preview.wait(after, Duration::from_secs(1)))
        .await
        .map(Response::new)
        .map_err(|e| e.to_string())
}

/// Pulse a light so the user can tell which one it is. The engine leaves it
/// alone meanwhile, so sync doesn't fight the pulse.
#[tauri::command]
async fn identify_device(engine: State<'_, Engine>, ip: String) -> Result<(), String> {
    let dest = Dest::parse(&ip).ok_or("invalid ip")?;
    // Colors the engine already queued for an iCUE light land first.
    let settle = match dest {
        Dest::Lan(_) => Duration::ZERO,
        Dest::Icue(_) => Duration::from_millis(150),
    };
    engine.hold(
        dest.clone(),
        settle + govee::IDENTIFY_DURATION + Duration::from_millis(100),
    );
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(settle);
        match dest {
            Dest::Lan(addr) => govee::identify(addr).map_err(|e| e.to_string()),
            Dest::Icue(device) => icue::identify(&device),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Switch one light on or off. Sent twice, since UDP can drop packets; the
/// second send also lands after any color the engine still had in flight.
/// An iCUE light has no power of its own: off paints it black, and on leaves
/// it to the engine.
#[tauri::command]
async fn set_power(ip: String, on: bool) -> Result<(), String> {
    if let Some(device) = icue::device_id(&ip) {
        if on {
            return Ok(());
        }
        let device = device.to_string();
        return tauri::async_runtime::spawn_blocking(move || {
            // After colors the engine queued before it stopped syncing the light.
            std::thread::sleep(Duration::from_millis(150));
            icue::off(&device)
        })
        .await
        .map_err(|e| e.to_string())?;
    }
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
        for device in ips.iter().filter_map(|ip| icue::device_id(ip)) {
            if let Err(e) = icue::off(device) {
                eprintln!("icue {device}: {e}");
            }
        }
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

/// Hidden, nothing shows the preview, so the engine stops capturing for it.
/// The page may not see a visibility change on hide, so tell the engine here.
fn hide_window(window: &Window) {
    let _ = window.hide();
    window.state::<Engine>().set_preview(false);
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        app.state::<Engine>().set_preview(true);
    }
}

#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("light mini")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // One copy at a time: two engines would fight over the lights.
    // A second launch shows the running window instead, unless it's the one
    // at sign-in. Must be registered first. `instance` backs it up.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _| {
        if !args.iter().any(|a| a == startup::HIDDEN_ARG) {
            show_window(app)
        }
    }));
    // Register before configured windows are created so the plugin can track them.
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::SIZE
                    | tauri_plugin_window_state::StateFlags::POSITION
                    | tauri_plugin_window_state::StateFlags::MAXIMIZED,
            )
            .build(),
    );
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(Engine::default())
        .setup(|app| {
            instance::exit_if_another(&app.config().identifier);
            #[cfg(desktop)]
            {
                setup_tray(app)?;
                app_icon::follow(app.handle().clone(), app.state::<Engine>().icon());
            }
            // The window starts hidden. At sign-in it stays in the tray.
            if !std::env::args().any(|a| a == startup::HIDDEN_ARG) {
                show_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing or minimizing hides to the tray; Quit in its menu exits.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                hide_window(window);
            }
            WindowEvent::Resized(_) if window.is_minimized().unwrap_or(false) => {
                hide_window(window);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            discover_devices,
            list_monitors,
            set_config,
            set_preview,
            next_preview,
            identify_device,
            set_power,
            lights_off,
            setup_file::export_setup,
            setup_file::import_setup,
            autostart,
            set_autostart
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Engine>().shutdown();
                icue::close();
            }
        });
}
