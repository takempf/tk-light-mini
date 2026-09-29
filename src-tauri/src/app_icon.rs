//! While the engine runs, the tray, taskbar and window icons show the canvas
//! on the app icon's screen. Otherwise they show the plain app icon.
//!
//! The engine only posts thumbnails; a thread of its own applies them. Setting
//! icons waits on the main thread, which may itself be waiting for the engine
//! to stop.

use parking_lot::{Condvar, Mutex};
#[cfg(desktop)]
use std::sync::Arc;

/// Thumbnails are `THUMB_W` x `THUMB_H` RGB, about the screen's shape.
pub const THUMB_W: usize = 72;
pub const THUMB_H: usize = 50;
/// The app icon's screen in `icons/icon.svg` (1024 wide), after its 1.3x
/// scale: x, y, width, height and corner radius.
const SCREEN: [f32; 5] = [161.0, 213.0, 702.0, 486.2, 52.0];

/// The latest thumbnail, or `None` for the plain app icon.
#[derive(Default)]
pub struct Latest {
    slot: Mutex<(u64, Option<Vec<u8>>)>,
    changed: Condvar,
}

impl Latest {
    pub fn set(&self, thumb: Option<Vec<u8>>) {
        let mut slot = self.slot.lock();
        if slot.1 == thumb {
            return;
        }
        *slot = (slot.0 + 1, thumb);
        self.changed.notify_all();
    }

    /// The thumbnail once it changed after `seq`, with its own `seq`.
    #[cfg_attr(not(any(desktop, test)), allow(dead_code))]
    fn wait(&self, seq: u64) -> (u64, Option<Vec<u8>>) {
        let mut slot = self.slot.lock();
        while slot.0 == seq {
            self.changed.wait(&mut slot);
        }
        slot.clone()
    }
}

/// A `width` x `height` BGRA frame, tightly packed, squeezed into a thumbnail.
pub fn thumbnail(bgra: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut out = vec![0; THUMB_W * THUMB_H * 3];
    if width == 0 || height == 0 {
        return out;
    }
    // The source pixels behind output pixel `i` of `n`, at least one.
    let span = |i: usize, n: usize, len: usize| {
        let a = i * len / n;
        a..((i + 1) * len / n).max(a + 1)
    };
    for y in 0..THUMB_H {
        for x in 0..THUMB_W {
            let mut sum = [0u32; 3];
            let mut n = 0;
            for sy in span(y, THUMB_H, height) {
                for sx in span(x, THUMB_W, width) {
                    let p = &bgra[(sy * width + sx) * 4..][..3];
                    sum[0] += u32::from(p[2]);
                    sum[1] += u32::from(p[1]);
                    sum[2] += u32::from(p[0]);
                    n += 1;
                }
            }
            let o = (y * THUMB_W + x) * 3;
            out[o..o + 3].copy_from_slice(&sum.map(|s| (s / n) as u8));
        }
    }
    out
}

/// `icon`, `width` x `height` RGBA, with `thumb` on its screen.
pub fn compose(icon: &[u8], width: usize, height: usize, thumb: &[u8]) -> Vec<u8> {
    // Samples per pixel, per axis, for smooth corners.
    const N: usize = 4;
    let mut out = icon.to_vec();
    let (sx, sy) = (width as f32 / 1024.0, height as f32 / 1024.0);
    let [x, y, w, h, r] = SCREEN;
    let (x0, y0, x1, y1) = (x * sx, y * sy, (x + w) * sx, (y + h) * sy);
    let r = r * sx.min(sy);
    let inside = |x: f32, y: f32| {
        let (cx, cy) = (x.clamp(x0 + r, x1 - r), y.clamp(y0 + r, y1 - r));
        (x - cx).powi(2) + (y - cy).powi(2) <= r * r
    };
    for py in y0 as usize..(y1.ceil() as usize).min(height) {
        for px in x0 as usize..(x1.ceil() as usize).min(width) {
            let mut sum = [0u32; 3];
            let mut n = 0;
            for j in 0..N {
                for i in 0..N {
                    let x = px as f32 + (i as f32 + 0.5) / N as f32;
                    let y = py as f32 + (j as f32 + 0.5) / N as f32;
                    if !inside(x, y) {
                        continue;
                    }
                    let u = (((x - x0) / (x1 - x0)) * THUMB_W as f32) as usize;
                    let v = (((y - y0) / (y1 - y0)) * THUMB_H as f32) as usize;
                    let p = &thumb[(v.min(THUMB_H - 1) * THUMB_W + u.min(THUMB_W - 1)) * 3..][..3];
                    for c in 0..3 {
                        sum[c] += u32::from(p[c]);
                    }
                    n += 1;
                }
            }
            if n == 0 {
                continue;
            }
            let cover = n as f32 / (N * N) as f32;
            let o = &mut out[(py * width + px) * 4..][..4];
            for c in 0..3 {
                let s = (sum[c] / n) as f32;
                o[c] = (f32::from(o[c]) * (1.0 - cover) + s * cover).round() as u8;
            }
            o[3] = (f32::from(o[3]) + (255.0 - f32::from(o[3])) * cover).round() as u8;
        }
    }
    out
}

/// Apply `latest` to the tray and the main window as it changes.
#[cfg(desktop)]
pub fn follow(app: tauri::AppHandle, latest: Arc<Latest>) {
    use tauri::image::Image;
    use tauri::Manager;

    let run = move || {
        let default = app.default_window_icon().cloned();
        // The icon at the sizes it's shown at: small in the tray and title,
        // big in the taskbar.
        #[cfg(windows)]
        let [small, big] = windows_icon::sizes().map(|s| Image::from_app_icon_resource(s).ok());
        #[cfg(not(windows))]
        let [small, big] = [default.clone(), default.clone()];
        let on = |base: &Option<Image<'static>>, thumb: &[u8]| {
            base.as_ref().map(|b| {
                let (w, h) = (b.width(), b.height());
                Image::new_owned(compose(b.rgba(), w as usize, h as usize, thumb), w, h)
            })
        };
        #[cfg(windows)]
        let mut window_icon = windows_icon::WindowIcon::default();
        let mut seq = 0;
        loop {
            let (s, thumb) = latest.wait(seq);
            seq = s;
            let icons = thumb.as_deref().map(|t| [on(&small, t), on(&big, t)]);
            let [small, big] = icons.unwrap_or_default();
            if let Some(tray) = app.tray_by_id("main") {
                let _ = tray.set_icon(small.clone().or_else(|| default.clone()));
            }
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            // Tauri only sets the small icon there; the taskbar shows the big one.
            #[cfg(windows)]
            if let Ok(hwnd) = window.hwnd() {
                window_icon.set(hwnd.0, small.zip(big));
            }
            #[cfg(not(windows))]
            if let Some(icon) = big.or_else(|| default.clone()) {
                let _ = window.set_icon(icon);
            }
        }
    };
    let _ = std::thread::Builder::new()
        .name("app-icon".into())
        .spawn(run);
}

#[cfg(windows)]
mod windows_icon {
    use std::ffi::c_void;
    use tauri::image::Image;
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIcon, DestroyIcon, GetSystemMetrics, SendMessageW, HICON, ICON_BIG, ICON_SMALL,
        SM_CXICON, SM_CXSMICON, WM_SETICON,
    };

    const KINDS: [u32; 2] = [ICON_SMALL, ICON_BIG];

    /// The small and big icon sizes, in pixels.
    pub fn sizes() -> [u32; 2] {
        [SM_CXSMICON, SM_CXICON].map(|m| match unsafe { GetSystemMetrics(m) } {
            n if n > 0 => n as u32,
            _ => 32,
        })
    }

    /// The window's small and big icons, set to our own until put back.
    #[derive(Default)]
    pub struct WindowIcon {
        ours: Option<[isize; 2]>,
        /// What the window had before ours, to put back.
        original: [isize; 2],
    }

    impl WindowIcon {
        /// Show `icons` (small, big), or put back the original icons.
        pub fn set(&mut self, hwnd: *mut c_void, icons: Option<(Image, Image)>) {
            let hwnd = HWND(hwnd);
            let send = |kind: u32, icon: isize| unsafe {
                SendMessageW(
                    hwnd,
                    WM_SETICON,
                    Some(WPARAM(kind as usize)),
                    Some(LPARAM(icon)),
                )
                .0
            };
            let old = self.ours.take();
            let new = icons.and_then(|(s, b)| Some([create(&s)?, create(&b)?]));
            if let Some(new) = new {
                for ((kind, icon), original) in KINDS.into_iter().zip(new).zip(&mut self.original) {
                    let prev = send(kind, icon);
                    if old.is_none() {
                        *original = prev;
                    }
                }
                self.ours = Some(new);
            } else if old.is_some() {
                for (kind, original) in KINDS.into_iter().zip(self.original) {
                    send(kind, original);
                }
            }
            for h in old.into_iter().flatten() {
                unsafe {
                    let _ = DestroyIcon(HICON(h as *mut c_void));
                }
            }
        }
    }

    fn create(image: &Image) -> Option<isize> {
        let (w, h) = (image.width() as usize, image.height() as usize);
        let bgra: Vec<u8> = image
            .rgba()
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|p| [p[2], p[1], p[0], p[3]])
            .collect();
        // Alpha decides what shows; the mask only needs to exist. Its rows are
        // whole 16-bit words.
        let mask = vec![0u8; w.div_ceil(16) * 2 * h];
        let icon = unsafe {
            CreateIcon(
                None,
                w as i32,
                h as i32,
                1,
                32,
                mask.as_ptr(),
                bgra.as_ptr(),
            )
        };
        icon.ok().map(|h| h.0 as isize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn px(img: &[u8], width: usize, x: usize, y: usize) -> &[u8] {
        &img[(y * width + x) * 4..][..4]
    }

    #[test]
    fn thumbnails_squeeze_the_frame() {
        // 144 x 50, left half red, right half blue (BGRA).
        let mut f = Vec::new();
        for _ in 0..50 {
            for x in 0..144 {
                f.extend_from_slice(if x < 72 {
                    &[0, 0, 255, 0]
                } else {
                    &[255, 0, 0, 0]
                });
            }
        }
        let t = thumbnail(&f, 144, 50);
        assert_eq!(t[..3], [255, 0, 0]);
        assert_eq!(t[(THUMB_W - 1) * 3..][..3], [0, 0, 255]);
        assert_eq!(t[t.len() - 3..], [0, 0, 255]);
    }

    #[test]
    fn thumbnails_average_what_they_shrink() {
        // 144 x 100 checkerboard of black and white.
        let f: Vec<u8> = (0..144 * 100)
            .flat_map(|i| {
                let v = if (i % 144 + i / 144) % 2 == 0 { 255 } else { 0 };
                [v, v, v, 0]
            })
            .collect();
        assert_eq!(thumbnail(&f, 144, 100)[..3], [127, 127, 127]);
    }

    #[test]
    fn composes_onto_the_screen_only() {
        // At 256 wide the screen spans 40.25..215.75 x 53.25..174.8, radius 13.
        let icon = vec![9; 256 * 256 * 4];
        let thumb = vec![200; THUMB_W * THUMB_H * 3];
        let out = compose(&icon, 256, 256, &thumb);
        assert_eq!(px(&out, 256, 128, 120), [200, 200, 200, 255], "screen");
        assert_eq!(px(&out, 256, 128, 52), [9, 9, 9, 9], "bezel");
        assert_eq!(px(&out, 256, 40, 53), [9, 9, 9, 9], "rounded corner");
        assert_eq!(
            px(&out, 256, 128, 53),
            [152, 152, 152, 194],
            "edge, 3/4 covered"
        );
    }

    #[test]
    fn only_changes_wake_the_icon_thread() {
        let l = Latest::default();
        l.set(Some(vec![1]));
        assert_eq!(l.wait(0), (1, Some(vec![1])));
        l.set(Some(vec![1]));
        l.set(None);
        assert_eq!(l.wait(1), (2, None));
    }
}
