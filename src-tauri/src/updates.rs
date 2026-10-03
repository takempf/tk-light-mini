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
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    /// What `scripts/release.mjs` publishes, made with a throwaway key.
    const FEED: &str = include_str!("../../scripts/fixtures/latest.json");
    const INSTALLER: &[u8] = include_bytes!("../../scripts/fixtures/installer.txt");
    const PUBKEY: &str = include_str!("../../scripts/fixtures/fixture.key.pub");

    /// Serves `latest.json` and the installer, with the installer's bytes run
    /// through `tamper`. Returns the feed's URL.
    fn serve(tamper: fn(&mut Vec<u8>)) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let feed = FEED.replace("PORT", &port.to_string());
        let mut installer = INSTALLER.to_vec();
        tamper(&mut installer);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut line = String::new();
                let mut reader = BufReader::new(&stream);
                reader.read_line(&mut line).unwrap();
                // Skip the headers.
                let mut header = String::new();
                while reader.read_line(&mut header).is_ok_and(|n| n > 2) {
                    header.clear();
                }
                let body: &[u8] = match line.split(' ').nth(1) {
                    Some("/latest.json") => feed.as_bytes(),
                    Some("/installer.txt") => &installer,
                    _ => b"",
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(body);
            }
        });
        format!("http://127.0.0.1:{port}/latest.json")
    }

    /// The real updater in a mock app at version `current`, reading `feed`.
    fn check(current: &str, feed: &str) -> Option<Update> {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.package_info_mut().version = current.parse().unwrap();
        context.config_mut().plugins.0.insert(
            "updater".into(),
            serde_json::json!({ "pubkey": PUBKEY.trim(), "endpoints": [] }),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let updater = app
            .updater_builder()
            .endpoints(vec![feed.parse().unwrap()])
            .unwrap()
            .build()
            .unwrap();
        tauri::async_runtime::block_on(updater.check()).unwrap()
    }

    #[test]
    fn finds_a_newer_release_and_checks_its_signature() {
        let update = check("0.1.0", &serve(|_| {})).expect("an update");
        assert_eq!(
            UpdateInfo::from(&update),
            UpdateInfo {
                version: "9.9.9".into(),
                notes: Some("- Faster scans".into()),
            }
        );
        let bytes = tauri::async_runtime::block_on(update.download(|_, _| {}, || {})).unwrap();
        assert_eq!(bytes, INSTALLER);
    }

    #[test]
    fn refuses_an_installer_that_doesnt_match_its_signature() {
        let update = check("0.1.0", &serve(|b| b[0] ^= 1)).expect("an update");
        let got = tauri::async_runtime::block_on(update.download(|_, _| {}, || {}));
        let e = got.expect_err("a changed installer downloaded").to_string();
        assert!(e.to_lowercase().contains("signature"), "{e}");
    }

    #[test]
    fn stays_put_on_the_latest_version() {
        assert!(check("9.9.9", &serve(|_| {})).is_none());
        assert!(check("10.0.0", &serve(|_| {})).is_none());
    }
}
