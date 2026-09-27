//! Govee's undocumented `ptReal` LAN command, kept as hardware probes.
//!
//! `ptReal` carries raw BLE frames (base64) over the LAN API. Segment frames can
//! put each segment in RGB mode or in white mode (the real white LEDs). On the
//! H61F5 this gained nothing: the firmware already uses the white LEDs for RGB,
//! and it fades ~3 s between changes. Sync uses razer streaming instead.
//!
//! Frames are 20 bytes. Byte 19 = XOR of bytes 0..19. Layouts from
//! govee2mqtt issue #105 (H61E0, H6046):
//!
//! ```text
//! 33 05 15 01 RR GG BB KK KK TR TG TB M0..M6  XX   segment color (KK = 0)
//!                                                  or white (KK = kelvin, BE;
//!                                                  RR GG BB = ff ff ff, T = tint)
//! 33 05 15 02 BR M0..M13                      XX   segment brightness, 0-100
//! ```
//!
//! Mask bit n (LE) = segment n.

use crate::zones::Rgb;

pub type Frame = [u8; 20];

fn finish(mut f: Frame) -> Frame {
    f[19] = f[..19].iter().fold(0, |a, b| a ^ b);
    f
}

fn put_mask(f: &mut Frame, at: usize, mask: u64) {
    let n = (19 - at).min(8);
    f[at..at + n].copy_from_slice(&mask.to_le_bytes()[..n]);
}

pub fn segment_color(c: Rgb, mask: u64) -> Frame {
    let mut f = [0u8; 20];
    f[..7].copy_from_slice(&[0x33, 0x05, 0x15, 0x01, c[0], c[1], c[2]]);
    put_mask(&mut f, 12, mask);
    finish(f)
}

pub fn segment_white(kelvin: u16, tint: Rgb, mask: u64) -> Frame {
    let mut f = [0u8; 20];
    let [kh, kl] = kelvin.to_be_bytes();
    f[..12].copy_from_slice(&[
        0x33, 0x05, 0x15, 0x01, 0xff, 0xff, 0xff, kh, kl, tint[0], tint[1], tint[2],
    ]);
    put_mask(&mut f, 12, mask);
    finish(f)
}

/// Segment brightness, 0-100.
pub fn segment_brightness(percent: u8, mask: u64) -> Frame {
    let mut f = [0u8; 20];
    f[..5].copy_from_slice(&[0x33, 0x05, 0x15, 0x02, percent.min(100)]);
    put_mask(&mut f, 5, mask);
    finish(f)
}

/// Approximate sRGB of a black body (Tanner Helland's fit). Only used as the
/// tint Govee expects next to the kelvin value.
pub fn kelvin_rgb(kelvin: u16) -> Rgb {
    let t = kelvin as f32 / 100.0;
    let r = if t <= 66.0 {
        255.0
    } else {
        329.698_73 * (t - 60.0).powf(-0.133_204_76)
    };
    let g = if t <= 66.0 {
        99.470_8 * t.ln() - 161.119_57
    } else {
        288.122_17 * (t - 60.0).powf(-0.075_514_85)
    };
    let b = if t >= 66.0 {
        255.0
    } else if t <= 19.0 {
        0.0
    } else {
        138.517_73 * (t - 10.0).ln() - 305.044_8
    };
    [r, g, b].map(|v| v.clamp(0.0, 255.0).round() as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(f: &Frame) -> String {
        f.iter().map(|b| format!("{b:02x}")).collect()
    }

    // Frames captured from the Govee app, govee2mqtt #105.
    #[test]
    fn matches_captured_frames() {
        assert_eq!(
            hex(&segment_color([0xff, 0, 0], 1)),
            concat!("33051501ff0000", "0000000000", "01000000000000", "dc")
        );
        assert_eq!(
            hex(&segment_white(2100, [0xff, 0x92, 0x1d], 1)),
            concat!("33051501ffffff", "0834ff921d", "01000000000000", "90")
        );
        assert_eq!(
            hex(&segment_brightness(0x54, 1)),
            concat!("3305150254", "0100000000000000000000000000", "74")
        );
    }

    #[test]
    fn mask_is_little_endian_bits() {
        let f = segment_color([0; 3], 1 << 9 | 1 << 49);
        assert_eq!(f[12..19], [0, 0x02, 0, 0, 0, 0, 0x02]);
    }

    #[test]
    fn kelvin_tint_is_close_to_govee() {
        let t = kelvin_rgb(2100);
        let govee = [0xff, 0x92, 0x1d];
        assert!((0..3).all(|i| t[i].abs_diff(govee[i]) <= 8), "{t:?}");
        assert_eq!(kelvin_rgb(6600), [255, 255, 255]);
    }
}

/// Probes for real hardware. Set `GOVEE_IP`, then e.g.
/// `cargo test -- --ignored live_pt_split --nocapture`
#[cfg(test)]
mod live {
    use super::*;
    use crate::govee::{control_addr, Sender};
    use std::time::Duration;

    fn addr() -> std::net::SocketAddr {
        let ip = std::env::var("GOVEE_IP").expect("set GOVEE_IP");
        control_addr(&ip).expect("bad GOVEE_IP")
    }

    fn pause() {
        std::thread::sleep(Duration::from_secs(4));
    }

    /// Walks one lit segment along the strip, 1 s per step. Count the steps to
    /// check `segments`. Blue is the second frame, so seeing it also shows
    /// multi-frame messages work. `GOVEE_WALK` sets how far (default 20).
    #[test]
    #[ignore]
    fn live_pt_walk() {
        let a = addr();
        let steps: u32 = std::env::var("GOVEE_WALK").map_or(20, |v| v.parse().unwrap());
        let mut s = Sender::new().unwrap();
        s.turn(a, true);
        let all = u64::MAX >> 8;
        s.pt_real(
            a,
            &[segment_color([0; 3], all), segment_brightness(100, all)],
        );
        std::thread::sleep(Duration::from_secs(2));
        for i in 0..steps.min(56) {
            println!("segment {i}");
            s.pt_real(
                a,
                &[
                    segment_color([0, 0, 0], all & !(1 << i)),
                    segment_color([0, 80, 255], 1 << i),
                ],
            );
            std::thread::sleep(Duration::from_secs(1));
        }
    }

    /// Frame and rate limits. Each phase resets to white, then sends six
    /// whole-strip colors: red, green, blue, yellow, magenta, cyan. The color it
    /// settles on is the last frame the device took.
    ///   1. one message, six frames
    ///   2. six messages, 100 ms apart
    ///   3. six messages, 400 ms apart
    #[test]
    #[ignore]
    fn live_pt_limits() {
        let a = addr();
        let mut s = Sender::new().unwrap();
        s.turn(a, true);
        let all = u64::MAX >> 8;
        let colors: Vec<Frame> = [
            [255, 0, 0],
            [0, 255, 0],
            [0, 0, 255],
            [255, 255, 0],
            [255, 0, 255],
            [0, 255, 255],
        ]
        .map(|c| segment_color(c, all))
        .into();
        let reset = |s: &mut Sender| {
            s.pt_real(a, &[segment_white(6500, kelvin_rgb(6500), all)]);
            std::thread::sleep(Duration::from_secs(3));
        };
        let hold = || std::thread::sleep(Duration::from_secs(6));

        println!("phase 1: one message, six frames");
        reset(&mut s);
        s.pt_real(a, &colors);
        hold();
        for gap in [100, 400] {
            println!("phase: six messages, {gap} ms apart");
            reset(&mut s);
            for f in &colors {
                s.pt_real(a, &[*f]);
                std::thread::sleep(Duration::from_millis(gap));
            }
            hold();
        }
    }

    /// Static ruler to count segments: 0-4 red, 5-9 green, 10-14 blue,
    /// 15-19 white, 20+ dark.
    #[test]
    #[ignore]
    fn live_pt_ruler() {
        let a = addr();
        let mut s = Sender::new().unwrap();
        s.turn(a, true);
        let all = u64::MAX >> 8;
        // One frame per message: a 6-frame message dropped the last frames.
        for f in [
            segment_brightness(100, all),
            segment_color([0; 3], all),
            segment_color([255, 0, 0], 0x1f),
            segment_color([0, 255, 0], 0x1f << 5),
            segment_color([0, 0, 255], 0x1f << 10),
            segment_white(6500, kelvin_rgb(6500), 0x1f << 15),
        ] {
            s.pt_real(a, &[f]);
            std::thread::sleep(Duration::from_millis(100));
        }
        std::thread::sleep(Duration::from_secs(20));
    }

    /// Does the device apply every frame in one `ptReal` message, or only the
    /// first? Dark strip, then one message: segments 0-9 blue, 20-29 green.
    #[test]
    #[ignore]
    fn live_pt_multi() {
        let a = addr();
        let mut s = Sender::new().unwrap();
        s.turn(a, true);
        let all = u64::MAX >> 8;
        s.pt_real(
            a,
            &[segment_color([0; 3], all), segment_brightness(100, all)],
        );
        std::thread::sleep(Duration::from_secs(3));
        println!("one message: first 10 blue, 20-29 green");
        s.pt_real(
            a,
            &[
                segment_color([0, 0, 255], 0x3ff),
                segment_color([0, 255, 0], 0x3ff << 20),
            ],
        );
        std::thread::sleep(Duration::from_secs(5));
        println!("separate messages: 30-39 red, 40-49 white");
        s.pt_real(a, &[segment_color([255, 0, 0], 0x3ff << 30)]);
        s.pt_real(a, &[segment_white(6500, kelvin_rgb(6500), 0x3ff << 40)]);
        std::thread::sleep(Duration::from_secs(5));
    }

    /// True tandem? White mode, but with a color in the RGB bytes. If the
    /// segments look tinted, the firmware lights RGB and white together.
    #[test]
    #[ignore]
    fn live_pt_tandem() {
        let a = addr();
        let mut s = Sender::new().unwrap();
        s.turn(a, true);
        let all = u64::MAX >> 8;
        let mut f = segment_white(4000, kelvin_rgb(4000), all);
        f[4..7].copy_from_slice(&[255, 0, 0]);
        println!("white 4000 K with red RGB bytes");
        s.pt_real(a, &[finish(f), segment_brightness(100, all)]);
        pause();
        println!("plain white 4000 K, to compare");
        s.pt_real(a, &[segment_white(4000, kelvin_rgb(4000), all)]);
        pause();
    }
}
