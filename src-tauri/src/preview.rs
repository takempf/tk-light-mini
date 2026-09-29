//! What the window shows live: engine status, path colors and the small
//! canvas frame. The window long-polls `next_preview` for them as raw bytes,
//! instead of getting events, which Tauri delivers by eval'ing script.
//!
//! A message, little endian:
//! - `u64` sequence number; pass it back as `after` for the next one
//! - `u8` parts in it: 1 = status, 2 = paths, 4 = image
//! - status: `u8` running, `u8` has error, `u16` length, UTF-8 error
//! - paths: `u16` lights; each `u8` IP length, IP, `u16` count, count x RGB
//! - image: `u16` width, `u16` height, width x height x RGBA

use parking_lot::{Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::color::Rgb;

const STATUS: u8 = 1;
const PATHS: u8 = 2;
const IMAGE: u8 = 4;

/// One part and the sequence number it last changed at.
#[derive(Default)]
struct Part {
    seq: u64,
    bytes: Vec<u8>,
}

#[derive(Default)]
struct Slot {
    seq: u64,
    status: Part,
    paths: Part,
    image: Part,
}

impl Slot {
    /// Replace a part, unless it's the same.
    fn set(&mut self, which: u8, bytes: Vec<u8>, force: bool) -> bool {
        let seq = self.seq + 1;
        let part = match which {
            STATUS => &mut self.status,
            PATHS => &mut self.paths,
            _ => &mut self.image,
        };
        if !force && part.seq > 0 && part.bytes == bytes {
            return false;
        }
        *part = Part { seq, bytes };
        self.seq = seq;
        true
    }

    /// The parts changed after `after`.
    fn message(&self, after: u64) -> Vec<u8> {
        // From an older app run: send everything.
        let after = if after > self.seq { 0 } else { after };
        let parts = [
            (STATUS, &self.status),
            (PATHS, &self.paths),
            (IMAGE, &self.image),
        ];
        let mut out = Vec::new();
        out.extend_from_slice(&self.seq.to_le_bytes());
        let mut flags = 0;
        for (bit, p) in parts {
            if p.seq > after {
                flags |= bit;
            }
        }
        out.push(flags);
        for (bit, p) in parts {
            if flags & bit != 0 {
                out.extend_from_slice(&p.bytes);
            }
        }
        out
    }
}

/// The latest preview, shared by the engine thread and `next_preview`.
#[derive(Default)]
pub struct Preview {
    slot: Mutex<Slot>,
    changed: Condvar,
}

impl Preview {
    fn set(&self, which: u8, bytes: Vec<u8>, force: bool) {
        if self.slot.lock().set(which, bytes, force) {
            self.changed.notify_all();
        }
    }

    pub fn set_status(&self, running: bool, error: Option<&str>) {
        let mut b = vec![u8::from(running), u8::from(error.is_some())];
        let text = error.unwrap_or("").as_bytes();
        let text = &text[..text.len().min(u16::MAX as usize)];
        b.extend_from_slice(&(text.len() as u16).to_le_bytes());
        b.extend_from_slice(text);
        self.set(STATUS, b, false);
    }

    /// Each light's path colors. Sent only when they changed, unless `force`.
    pub fn set_paths<'a>(
        &self,
        lights: impl IntoIterator<Item = (&'a str, &'a [Rgb])>,
        force: bool,
    ) {
        let lights: Vec<_> = lights.into_iter().take(u16::MAX as usize).collect();
        let mut b = Vec::new();
        b.extend_from_slice(&(lights.len() as u16).to_le_bytes());
        for (ip, colors) in lights {
            let ip = &ip.as_bytes()[..ip.len().min(u8::MAX as usize)];
            let colors = &colors[..colors.len().min(u16::MAX as usize)];
            b.push(ip.len() as u8);
            b.extend_from_slice(ip);
            b.extend_from_slice(&(colors.len() as u16).to_le_bytes());
            b.extend(colors.iter().flatten());
        }
        self.set(PATHS, b, force);
    }

    /// A `width` x `height` BGRA frame, tightly packed.
    pub fn set_image(&self, bgra: &[u8], width: usize, height: usize) {
        let (w, h) = (width.min(u16::MAX as usize), height.min(u16::MAX as usize));
        let mut b = Vec::with_capacity(4 + w * h * 4);
        b.extend_from_slice(&(w as u16).to_le_bytes());
        b.extend_from_slice(&(h as u16).to_le_bytes());
        for p in bgra[..w * h * 4].as_chunks::<4>().0 {
            b.extend_from_slice(&[p[2], p[1], p[0], 255]);
        }
        self.set(IMAGE, b, true);
    }

    /// What changed after `after`, waiting up to `timeout` for something to.
    /// With nothing new, the message has no parts.
    pub fn wait(&self, after: u64, timeout: Duration) -> Vec<u8> {
        let end = Instant::now() + timeout;
        let mut slot = self.slot.lock();
        while slot.seq == after && !self.changed.wait_until(&mut slot, end).timed_out() {}
        slot.message(after)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: Duration = Duration::ZERO;

    #[test]
    fn sends_what_changed_since_the_last_message() {
        let p = Preview::default();
        p.set_status(true, None);
        p.set_paths([("10.0.0.2", &[[1, 2, 3]][..])], false);
        let all = p.wait(0, NOW);
        assert_eq!(all[..8], 2u64.to_le_bytes());
        assert_eq!(all[8], STATUS | PATHS);
        assert_eq!(all[9..13], [1, 0, 0, 0], "running, no error");
        assert_eq!(all[13..15], [1, 0], "one light");
        assert_eq!(all[15], 8);
        assert_eq!(&all[16..24], b"10.0.0.2");
        assert_eq!(all[24..], [1, 0, 1, 2, 3]);

        // Same colors: nothing to send.
        p.set_paths([("10.0.0.2", &[[1, 2, 3]][..])], false);
        assert_eq!(p.wait(2, NOW), [2, 0, 0, 0, 0, 0, 0, 0, 0]);
        // Unless forced, for a window that just opened.
        p.set_paths([("10.0.0.2", &[[1, 2, 3]][..])], true);
        assert_eq!(p.wait(2, NOW)[8], PATHS);
    }

    #[test]
    fn status_carries_the_error() {
        let p = Preview::default();
        p.set_status(false, Some("boom"));
        let m = p.wait(0, NOW);
        assert_eq!(m[8], STATUS);
        assert_eq!(m[9..], [0, 1, 4, 0, b'b', b'o', b'o', b'm']);
    }

    #[test]
    fn images_are_rgba() {
        let p = Preview::default();
        p.set_image(&[10, 20, 30, 0, 40, 50, 60, 0], 2, 1);
        let m = p.wait(0, NOW);
        assert_eq!(m[8], IMAGE);
        assert_eq!(m[9..], [2, 0, 1, 0, 30, 20, 10, 255, 60, 50, 40, 255]);
    }

    #[test]
    fn waits_for_a_change() {
        let p = std::sync::Arc::new(Preview::default());
        let t = Instant::now();
        assert_eq!(
            p.wait(0, Duration::from_millis(30))[8],
            0,
            "times out empty"
        );
        assert!(t.elapsed() >= Duration::from_millis(30));
        let q = p.clone();
        let waiter = std::thread::spawn(move || q.wait(0, Duration::from_secs(5)));
        std::thread::sleep(Duration::from_millis(20));
        p.set_status(true, None);
        assert_eq!(waiter.join().unwrap()[8], STATUS);
    }

    #[test]
    fn a_stale_sequence_gets_everything() {
        let p = Preview::default();
        p.set_status(true, None);
        assert_eq!(p.wait(99, NOW)[8], STATUS);
    }
}
