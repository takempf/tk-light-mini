use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Corsair's iCUE SDK client, which `tauri.windows.conf.json` puts next to
/// the exe. Fetched once into `vendor/` (not in git: Corsair doesn't state a
/// license for it).
const ICUE_DLL: &str = "iCUESDK.x64_2019.dll";
const ICUE_ZIP: &str =
    "https://github.com/CorsairOfficial/cue-sdk/releases/download/v4.0.84/iCUESDK_4.0.84.zip";
const ICUE_ENTRY: &str = "iCUESDK/redist/x64/iCUESDK.x64_2019.dll";
const ICUE_SHA256: &str = "d72fd819b91fd1d3b0c3db2ea17a47dcfe3b38e26269aa967ecfee10d2e93884";

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        icue_dll();
    }
    tauri_build::build()
}

fn icue_dll() {
    let dll = Path::new("vendor").join(ICUE_DLL);
    println!("cargo:rerun-if-changed={}", dll.display());
    if sha256(&dll).as_deref() == Some(ICUE_SHA256) {
        return;
    }
    if let Err(e) = fetch(&dll) {
        panic!(
            "can't get {ICUE_DLL}: {e}\nDownload {ICUE_ZIP} and put {ICUE_ENTRY} at src-tauri/{}",
            dll.display()
        );
    }
}

fn fetch(dll: &Path) -> Result<(), String> {
    let out = PathBuf::from(std::env::var("OUT_DIR").map_err(|e| e.to_string())?);
    let zip = out.join("icuesdk.zip");
    run(Command::new("curl").args(["-fsSL", "-o"]).arg(&zip).arg(ICUE_ZIP))?;
    // Windows' own tar reads zips; Git's doesn't.
    let tar = PathBuf::from(std::env::var_os("SystemRoot").ok_or("no SystemRoot")?)
        .join(r"System32\tar.exe");
    run(Command::new(tar).arg("-xf").arg(&zip).arg("-C").arg(&out).arg(ICUE_ENTRY))?;
    let got = out.join(ICUE_ENTRY);
    match sha256(&got) {
        Some(h) if h == ICUE_SHA256 => {}
        h => return Err(format!("unexpected SHA-256 {h:?}")),
    }
    std::fs::create_dir_all(dll.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::copy(&got, dll).map_err(|e| e.to_string())?;
    Ok(())
}

fn run(cmd: &mut Command) -> Result<(), String> {
    let s = cmd.status().map_err(|e| format!("{cmd:?}: {e}"))?;
    s.success()
        .then_some(())
        .ok_or_else(|| format!("{cmd:?}: {s}"))
}

fn sha256(p: &Path) -> Option<String> {
    let bytes = std::fs::read(p).ok()?;
    Some(
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect(),
    )
}
