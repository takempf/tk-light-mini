//! Corsair's iCUE SDK client, `iCUESDK.x64_2019.dll`, which the app needs to
//! reach lights through iCUE. Corsair's license doesn't let the app pass it
//! on, so the user gets it: the app downloads it from Corsair's own GitHub
//! release when asked, or copies one the user picks. Either way it goes in
//! the app's data folder.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

pub const NAME: &str = "iCUESDK.x64_2019.dll";
const ZIP_URL: &str =
    "https://github.com/CorsairOfficial/cue-sdk/releases/download/v4.0.84/iCUESDK_4.0.84.zip";
const ZIP_ENTRY: &str = "iCUESDK/redist/x64/iCUESDK.x64_2019.dll";
/// The DLL in that release. Anything else isn't loaded into the app.
const SHA256: &str = "d72fd819b91fd1d3b0c3db2ea17a47dcfe3b38e26269aa967ecfee10d2e93884";

/// The app's data folder, set at startup.
static DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_dir(dir: PathBuf) {
    let _ = DIR.set(dir);
}

/// Where the DLL can be: the app's data folder, then next to the exe.
fn places() -> Vec<PathBuf> {
    let data = DIR.get().map(|d| d.join(NAME));
    let exe = std::env::current_exe()
        .ok()
        .and_then(|e| Some(e.parent()?.join(NAME)));
    data.into_iter().chain(exe).collect()
}

/// The first of `places` that exists.
fn first_file(places: &[PathBuf]) -> Option<PathBuf> {
    places.iter().find(|p| p.is_file()).cloned()
}

/// The DLL, if the app has one.
pub fn find() -> Option<PathBuf> {
    first_file(&places())
}

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The DLL out of Corsair's SDK zip, if its hash is `expected`.
fn from_zip(zip: &[u8], expected: &str) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(zip)).map_err(|e| format!("SDK zip: {e}"))?;
    let mut entry = archive
        .by_name(ZIP_ENTRY)
        .map_err(|e| format!("{ZIP_ENTRY}: {e}"))?;
    let mut dll = Vec::new();
    entry
        .read_to_end(&mut dll)
        .map_err(|e| format!("{ZIP_ENTRY}: {e}"))?;
    match sha256(&dll) {
        h if h == expected => Ok(dll),
        h => Err(format!("{NAME} isn't the expected file (SHA-256 {h})")),
    }
}

/// Save `dll` as the app's copy, once it loads as the SDK. Checked under
/// another name first, so a bad file never replaces a good one.
fn install(dir: &Path, dll: &[u8]) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join(NAME);
    let trial = dir.join(format!("{NAME}.new"));
    std::fs::write(&trial, dll).map_err(|e| format!("{}: {e}", trial.display()))?;
    let checked = crate::icue::check_dll(&trial)
        .and_then(|()| std::fs::rename(&trial, &path).map_err(|e| e.to_string()));
    if let Err(e) = checked {
        let _ = std::fs::remove_file(&trial);
        return Err(e);
    }
    crate::icue::retry_now();
    Ok(path)
}

fn data_dir() -> Result<&'static PathBuf, String> {
    DIR.get().ok_or_else(|| "no data folder".into())
}

#[derive(Debug, Serialize)]
pub struct IcueStatus {
    /// The app has the SDK's DLL.
    sdk: bool,
    /// iCUE itself is installed.
    icue: bool,
}

#[tauri::command]
pub fn icue_status() -> IcueStatus {
    IcueStatus {
        sdk: find().is_some(),
        icue: crate::icue::installed(),
    }
}

/// Download the SDK from Corsair's release on GitHub and keep its DLL.
#[tauri::command]
pub async fn download_icue_sdk() -> Result<(), String> {
    // As the updater does: reqwest's rustls needs a crypto provider.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .user_agent("tk-light-mini")
        .build()
        .map_err(|e| e.to_string())?;
    let zip = client
        .get(ZIP_URL)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("download: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("download: {e}"))?;
    let dir = data_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        install(dir, &from_zip(&zip, SHA256)?).map(drop)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ask for the DLL and keep a copy. False if the user cancelled.
#[tauri::command]
pub async fn choose_icue_sdk(window: WebviewWindow) -> Result<bool, String> {
    let Some(picked) = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(format!("Find {NAME}"))
        .add_filter("iCUE SDK", &["dll"])
        .blocking_pick_file()
    else {
        return Ok(false);
    };
    let picked = picked.into_path().map_err(|e| e.to_string())?;
    let dll = std::fs::read(&picked).map_err(|e| format!("{}: {e}", picked.display()))?;
    install(data_dir()?, &dll)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_with(entry: &str, bytes: &[u8]) -> Vec<u8> {
        let mut out = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        out.start_file(entry, zip::write::SimpleFileOptions::default())
            .unwrap();
        out.write_all(bytes).unwrap();
        out.finish().unwrap().into_inner()
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tk-light-mini-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn takes_the_dll_out_of_the_zip_when_its_hash_matches() {
        let dll = b"pretend dll";
        let zip = zip_with(ZIP_ENTRY, dll);
        assert_eq!(from_zip(&zip, &sha256(dll)).unwrap(), dll);
    }

    #[test]
    fn refuses_another_dll() {
        let zip = zip_with(ZIP_ENTRY, b"something else");
        let e = from_zip(&zip, SHA256).unwrap_err();
        assert!(e.contains("isn't the expected file"), "{e}");
    }

    #[test]
    fn refuses_a_zip_without_it() {
        assert!(from_zip(&zip_with("readme.txt", b"hi"), SHA256).is_err());
        assert!(from_zip(b"not a zip", SHA256).is_err());
    }

    #[test]
    fn looks_in_order_and_skips_missing_places() {
        let dir = temp_dir("places");
        let (a, b) = (dir.join("a.dll"), dir.join("b.dll"));
        assert_eq!(first_file(&[a.clone(), b.clone()]), None);
        std::fs::write(&b, b"x").unwrap();
        assert_eq!(first_file(&[a.clone(), b.clone()]), Some(b.clone()));
        std::fs::write(&a, b"x").unwrap();
        assert_eq!(first_file(&[a.clone(), b]), Some(a));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn keeps_a_file_that_isnt_the_sdk_out() {
        let dir = temp_dir("install");
        assert!(install(&dir, b"not a dll").is_err());
        assert!(!dir.join(NAME).exists());
        assert!(!dir.join(format!("{NAME}.new")).exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Downloads Corsair's SDK and installs it into a temp folder.
    /// `cargo test -- --ignored live_download`
    #[test]
    #[ignore]
    fn live_download() {
        let dir = temp_dir("download");
        set_dir(dir.clone());
        tauri::async_runtime::block_on(download_icue_sdk()).unwrap();
        assert_eq!(sha256(&std::fs::read(dir.join(NAME)).unwrap()), SHA256);
        let _ = std::fs::remove_dir_all(dir);
    }
}
