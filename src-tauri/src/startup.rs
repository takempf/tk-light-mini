//! Start with Windows: a value under the user's `Run` key launches the app at
//! sign-in, hidden in the tray.
//!
//! Task Manager can switch the entry off without removing it. That shows up
//! under `StartupApproved`, so it counts as off here, and switching on again
//! clears it.

/// Passed at sign-in: start in the tray, without the window.
pub const HIDDEN_ARG: &str = "--hidden";

/// Whether this copy of the app starts with Windows.
#[cfg(windows)]
pub fn enabled() -> bool {
    let Ok(command) = command() else {
        return false;
    };
    let registered = imp::read_string(imp::RUN).is_some_and(|v| v.eq_ignore_ascii_case(&command));
    // The first byte is odd when Task Manager switched it off.
    let blocked =
        imp::read_binary(imp::APPROVED).is_some_and(|v| v.first().is_some_and(|b| b & 1 == 1));
    registered && !blocked
}

#[cfg(windows)]
pub fn set(on: bool) -> Result<(), String> {
    // Either way, a Task Manager switch no longer applies.
    imp::delete(imp::APPROVED)?;
    if on {
        imp::write_string(imp::RUN, &command()?)
    } else {
        imp::delete(imp::RUN)
    }
}

#[cfg(not(windows))]
pub fn enabled() -> bool {
    false
}

#[cfg(not(windows))]
pub fn set(_on: bool) -> Result<(), String> {
    Err("Only on Windows".into())
}

/// What Windows runs at sign-in.
#[cfg(windows)]
fn command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("\"{}\" {HIDDEN_ARG}", exe.display()))
}

#[cfg(windows)]
mod imp {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows::Win32::System::Registry::{
        RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_ROUTINE_FLAGS,
        REG_SZ, RRF_RT_REG_BINARY, RRF_RT_REG_SZ,
    };

    pub const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    pub const APPROVED: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    /// The value's name under both keys.
    const NAME: &str = "tk-light-mini";

    fn read(key: &str, flags: REG_ROUTINE_FLAGS) -> Option<Vec<u8>> {
        let (key, name) = (HSTRING::from(key), HSTRING::from(NAME));
        let mut size = 0u32;
        unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                &key,
                &name,
                flags,
                None,
                None,
                Some(&mut size),
            )
        }
        .ok()
        .ok()?;
        let mut data = vec![0u8; size as usize];
        unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                &key,
                &name,
                flags,
                None,
                Some(data.as_mut_ptr().cast()),
                Some(&mut size),
            )
        }
        .ok()
        .ok()?;
        data.truncate(size as usize);
        Some(data)
    }

    pub fn read_string(key: &str) -> Option<String> {
        let data = read(key, RRF_RT_REG_SZ)?;
        let wide: Vec<u16> = data
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&c| u16::from_le_bytes(c))
            .take_while(|&c| c != 0)
            .collect();
        Some(String::from_utf16_lossy(&wide))
    }

    pub fn read_binary(key: &str) -> Option<Vec<u8>> {
        read(key, RRF_RT_REG_BINARY)
    }

    pub fn write_string(key: &str, value: &str) -> Result<(), String> {
        let value = HSTRING::from(value);
        // With the terminating null.
        let bytes = (value.len() + 1) * 2;
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                &HSTRING::from(key),
                &HSTRING::from(NAME),
                REG_SZ.0,
                Some(value.as_ptr().cast()),
                bytes as u32,
            )
        }
        .ok()
        .map_err(|e| e.message())
    }

    /// Already gone is fine.
    pub fn delete(key: &str) -> Result<(), String> {
        let e = unsafe {
            RegDeleteKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(key), &HSTRING::from(NAME))
        };
        if e == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        e.ok().map_err(|e| e.message())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// Writes the real `Run` key, then puts it back.
    /// `cargo test -- --ignored live_round_trip`
    #[test]
    #[ignore]
    fn live_round_trip() {
        let before = imp::read_string(imp::RUN);
        set(true).unwrap();
        assert!(enabled());
        assert!(imp::read_string(imp::RUN).unwrap().ends_with(" --hidden"));
        set(false).unwrap();
        assert!(!enabled());
        assert_eq!(imp::read_string(imp::RUN), None);
        // Removing twice is fine.
        set(false).unwrap();
        if let Some(v) = before {
            imp::write_string(imp::RUN, &v).unwrap();
        }
    }
}
