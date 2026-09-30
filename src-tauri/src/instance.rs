//! One copy at a time, across all of Windows: two engines would fight over the
//! lights.
//!
//! The single-instance plugin handles the usual case: a second launch shows
//! the running window and exits. But its lock is per sign-in session, and a
//! second copy it can't reach (the first isn't ready yet) keeps running. This
//! lock backs it up.

/// Exit if another copy is running, for any user. Otherwise hold the lock
/// until this copy exits.
#[cfg(windows)]
pub fn exit_if_another(id: &str) {
    use windows::core::{w, HSTRING};
    use windows::Win32::Foundation::{GetLastError, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS};
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};

    let name = HSTRING::from(format!(r"Global\{id}-one-copy"));
    // Left open: Windows closes it when this copy exits.
    match unsafe { CreateMutexW(None, false, &name) } {
        // Another copy in this session, still starting. It shows itself.
        Ok(_) if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS => std::process::exit(0),
        Ok(_) => {}
        // Another user's copy holds it, and we may not open theirs.
        Err(e) if e.code() == ERROR_ACCESS_DENIED.to_hresult() => {
            unsafe {
                MessageBoxW(
                    None,
                    w!("light mini is already running for another user on this PC."),
                    w!("light mini"),
                    MB_OK | MB_ICONINFORMATION,
                );
            }
            std::process::exit(0);
        }
        Err(e) => eprintln!("one-copy lock: {e}"),
    }
}

#[cfg(not(windows))]
pub fn exit_if_another(_id: &str) {}
