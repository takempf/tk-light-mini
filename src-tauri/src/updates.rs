//! Updates from the app's GitHub releases. The window asks for a check (at
//! launch, every few hours, or from Settings). A newer release downloads in
//! the background, its signature checked against the key in
//! `tauri.conf.json`, and waits for the user to restart into it.
//!
//! On Windows the installer takes over and the app exits without the usual
//! exit event, so the lights are let go of first. The installer starts the
//! app again with the same arguments.

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Points the check at another `latest.json`, to try an update locally.
/// The signature still has to match.
pub const FEED_ENV: &str = "TK_LIGHT_MINI_UPDATE_URL";

/// An update that's downloaded and ready to install.
#[derive(Default)]
pub struct Updates(Mutex<Option<(Update, Vec<u8>)>>);

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    /// The release notes, as markdown.
    pub notes: Option<String>,
}

impl From<&Update> for UpdateInfo {
    fn from(u: &Update) -> Self {
        Self {
            version: u.version.clone(),
            notes: u.body.clone().filter(|n| !n.trim().is_empty()),
        }
    }
}

/// The newer version, once it's downloaded, or `None` if this one is the latest.
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    updates: State<'_, Updates>,
) -> Result<Option<UpdateInfo>, String> {
    if let Some((update, _)) = updates.0.lock().as_ref() {
        return Ok(Some(update.into()));
    }
    let handle = app.clone();
    let mut builder = app
        .updater_builder()
        .on_before_exit(move || let_go(&handle));
    if let Some(feed) = std::env::var(FEED_ENV).ok().filter(|f| !f.is_empty()) {
        let url = feed.parse().map_err(|e| format!("{FEED_ENV}: {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    let info = UpdateInfo::from(&update);
    *updates.0.lock() = Some((update, bytes));
    Ok(Some(info))
}

/// Install the downloaded update and restart into it.
#[tauri::command]
pub fn install_update(app: AppHandle, updates: State<'_, Updates>) -> Result<(), String> {
    let (update, bytes) = updates.0.lock().take().ok_or("No update is ready")?;
    // On Windows this exits, after `let_go`.
    if let Err(e) = update.install(&bytes) {
        let message = e.to_string();
        // Keep it for another try.
        *updates.0.lock() = Some((update, bytes));
        return Err(message);
    }
    app.restart()
}

/// Leave the lights and window as a normal quit would.
fn let_go(app: &AppHandle) {
    use tauri_plugin_window_state::AppHandleExt;
    let _ = app.save_window_state(crate::WINDOW_STATE);
    app.state::<crate::engine::Engine>().shutdown();
    crate::icue::close();
}
