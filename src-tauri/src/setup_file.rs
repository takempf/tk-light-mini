//! Saving the light setup to a file and opening one, through native dialogs.
//! The page builds and reads the file's text; this only moves it.

use tauri::WebviewWindow;
use tauri_plugin_dialog::DialogExt;

const FILTER: (&str, &[&str]) = ("Light setup", &["json"]);

/// Ask where to save `text`, then write it there. False if the user cancelled.
#[tauri::command]
pub async fn export_setup(
    window: WebviewWindow,
    name: String,
    text: String,
) -> Result<bool, String> {
    let Some(path) = window
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter(FILTER.0, FILTER.1)
        .set_file_name(name)
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Ask for a setup file and read it. None if the user cancelled.
#[tauri::command]
pub async fn import_setup(window: WebviewWindow) -> Result<Option<String>, String> {
    let Some(path) = window
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter(FILTER.0, FILTER.1)
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|e| e.to_string())
}
