fn main() {
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        manifest();
    }
    tauri_build::try_build(attributes).expect("tauri build")
}

/// Tauri's app manifest (Common Controls v6, which the dialogs need), linked
/// into every binary rather than only the app's exe as tauri-build does:
/// test binaries without it fail to start.
fn manifest() {
    let path = std::env::current_dir().unwrap().join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", path.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", path.display());
}
