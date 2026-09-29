//! Turns screen pixels into "wall paint" colors.
//!
//! Goals: the light should look like the screen is spilling onto the wall.
//! - Ignore letterbox / pillarbox bars (see `content_rect`).
//! - Average in linear light, so mixes look right.
//! - Weight saturated and bright pixels more, so a dim background does not
//!   wash out the dominant hue.
//! - Keep overall brightness tied to how bright the region really is.

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub type Rgb = [u8; 3];

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Tuning {
    /// Chroma multiplier. 1.0 = unchanged.
    pub saturation: f32,
    /// Output multiplier. 1.0 = unchanged.
    pub brightness: f32,
    /// 0 = instant, 1 = very slow fades.
    pub smoothing: f32,
}

impl Default for Tuning {
    fn default() -> Self {
        Self {
            saturation: 1.3,
            brightness: 1.0,
            smoothing: 0.5,
        }
    }
}

/// A BGRA8 frame view.
pub struct Frame<'a> {
    pub data: &'a [u8],
    pub width: usize,
    pub height: usize,
    /// Bytes per row.
    pub stride: usize,
}

/// A pixel counts as "bar black" at or below this max-channel value.
const BAR_BLACK: u8 = 14;
/// Fraction of a row/col that must be black to be a bar (allows subtitles).
const BAR_FRACTION: f32 = 0.9;
/// Never crop more than this fraction from any side.
const MAX_BAR: f32 = 0.25;

fn srgb_to_linear_lut() -> &'static [f32; 256] {
    static LUT: OnceLock<[f32; 256]> = OnceLock::new();
    LUT.get_or_init(|| {
        let mut t = [0f32; 256];
        for (i, v) in t.iter_mut().enumerate() {
            let c = i as f32 / 255.0;
            *v = if c <= 0.04045 {
                c / 12.92
            } else {
                ((c + 0.055) / 1.055).powf(2.4)
            };
        }
        t
    })
}

pub(crate) fn linear_to_srgb(c: f32) -> f32 {
    let c = c.clamp(0.0, 1.0);
    if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

/// Weighted color average for one region.
#[derive(Default, Clone, Copy)]
pub(crate) struct Acc {
    r: f32,
    g: f32,
    b: f32,
    w: f32,
    v: f32,
    wv: f32,
    n: u32,
}

impl Acc {
    #[inline(always)]
    pub(crate) fn add(&mut self, px: Px) {
        let Px { lin, v_lin, w } = px;
        self.r += lin[0] * w;
        self.g += lin[1] * w;
        self.b += lin[2] * w;
        self.w += w;
        self.v += v_lin;
        self.wv += v_lin * w;
        self.n += 1;
    }

    pub(crate) fn finish(&self, t: &Tuning) -> Rgb {
        if self.n == 0 || self.w < 1e-6 {
            return [0, 0, 0];
        }
        let c = [
            linear_to_srgb(self.r / self.w),
            linear_to_srgb(self.g / self.w),
            linear_to_srgb(self.b / self.w),
        ];
        let cmax = c[0].max(c[1]).max(c[2]);
        if cmax <= 1e-6 {
            return [0, 0, 0];
        }
        // Brightness mostly follows the region mean, nudged toward highlights.
        let mean_v = self.v / self.n as f32;
        let hi_v = self.wv / self.w;
        let target = linear_to_srgb(0.7 * mean_v + 0.3 * hi_v);
        let scale = target / cmax;
        let m = target;
        let sat = t.saturation.max(0.0);
        let bri = t.brightness.max(0.0);
        let mut out = [0u8; 3];
        for i in 0..3 {
            let ch = c[i] * scale;
            let ch = (m - (m - ch) * sat).max(0.0) * bri;
            out[i] = (ch.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        }
        out
    }
}

/// One pixel, ready to accumulate.
#[derive(Clone, Copy)]
pub(crate) struct Px {
    /// Linear RGB.
    lin: [f32; 3],
    /// Linear brightness (max channel).
    v_lin: f32,
    /// Weight: bright, saturated pixels count more.
    w: f32,
}

/// Read pixel `(x, y)` of a BGRA frame.
#[inline(always)]
pub(crate) fn read_px(frame: &Frame, x: usize, y: usize) -> Px {
    let lut = srgb_to_linear_lut();
    let i = y * frame.stride + x * 4;
    let (b, g, r) = (frame.data[i], frame.data[i + 1], frame.data[i + 2]);
    let hi = r.max(g).max(b);
    let lo = r.min(g).min(b);
    let w = if hi == 0 {
        0.0
    } else {
        let v = hi as f32 / 255.0;
        let sat = (hi - lo) as f32 / hi as f32;
        v * v + 2.0 * sat * v
    };
    Px {
        lin: [lut[r as usize], lut[g as usize], lut[b as usize]],
        v_lin: lut[hi as usize],
        w,
    }
}

#[inline(always)]
fn px(frame: &Frame, x: usize, y: usize) -> (u8, u8, u8) {
    let i = y * frame.stride + x * 4;
    let d = frame.data;
    (d[i + 2], d[i + 1], d[i])
}

fn row_is_bar(frame: &Frame, y: usize, x0: usize, x1: usize) -> bool {
    let limit = ((x1 - x0) as f32 * (1.0 - BAR_FRACTION)) as usize;
    let mut bright = 0;
    for x in x0..x1 {
        let (r, g, b) = px(frame, x, y);
        if r.max(g).max(b) > BAR_BLACK {
            bright += 1;
            if bright > limit {
                return false;
            }
        }
    }
    true
}

fn col_is_bar(frame: &Frame, x: usize, y0: usize, y1: usize) -> bool {
    let limit = ((y1 - y0) as f32 * (1.0 - BAR_FRACTION)) as usize;
    let mut bright = 0;
    for y in y0..y1 {
        let (r, g, b) = px(frame, x, y);
        if r.max(g).max(b) > BAR_BLACK {
            bright += 1;
            if bright > limit {
                return false;
            }
        }
    }
    true
}

/// The picture inside a frame, in pixels: `x0..x1` by `y0..y1`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x0: usize,
    pub y0: usize,
    pub x1: usize,
    pub y1: usize,
}

/// The frame with black letterbox and pillarbox bars removed.
pub fn content_rect(frame: &Frame) -> Rect {
    let (w, h) = (frame.width, frame.height);
    if w == 0 || h == 0 {
        return Rect {
            x0: 0,
            y0: 0,
            x1: w,
            y1: h,
        };
    }
    let max_y = ((h as f32) * MAX_BAR) as usize;
    let max_x = ((w as f32) * MAX_BAR) as usize;
    let mut y0 = 0;
    while y0 < max_y && row_is_bar(frame, y0, 0, w) {
        y0 += 1;
    }
    let mut y1 = h;
    while h - y1 < max_y && row_is_bar(frame, y1 - 1, 0, w) {
        y1 -= 1;
    }
    let mut x0 = 0;
    while x0 < max_x && col_is_bar(frame, x0, y0, y1) {
        x0 += 1;
    }
    let mut x1 = w;
    while w - x1 < max_x && col_is_bar(frame, x1 - 1, y0, y1) {
        x1 -= 1;
    }
    Rect { x0, y0, x1, y1 }
}

/// Frame-rate independent exponential smoothing for a list of colors.
#[derive(Clone, Debug, Default)]
pub struct Smoother {
    state: Vec<[f32; 3]>,
    out: Vec<Rgb>,
}

impl Smoother {
    /// `smoothing` in 0..1 maps to a time constant of 0..0.6s. The first
    /// update, or one with a new length, jumps straight to `target`.
    pub fn update(&mut self, target: &[Rgb], dt: f32, smoothing: f32) -> &[Rgb] {
        let tau = smoothing.clamp(0.0, 1.0) * 0.6;
        let alpha = if self.state.len() != target.len() || tau <= 1e-4 {
            self.state.resize(target.len(), [0.0; 3]);
            self.out.resize(target.len(), [0; 3]);
            1.0
        } else {
            1.0 - (-dt.max(0.0) / tau).exp()
        };
        for ((s, t), o) in self.state.iter_mut().zip(target).zip(&mut self.out) {
            for c in 0..3 {
                s[c] += (t[c] as f32 - s[c]) * alpha;
                o[c] = (s[c] + 0.5).clamp(0.0, 255.0) as u8;
            }
        }
        &self.out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Img {
        w: usize,
        h: usize,
        data: Vec<u8>,
    }

    impl Img {
        fn new(w: usize, h: usize, rgb: Rgb) -> Self {
            let mut data = Vec::with_capacity(w * h * 4);
            for _ in 0..w * h {
                data.extend_from_slice(&[rgb[2], rgb[1], rgb[0], 255]);
            }
            Self { w, h, data }
        }
        fn fill(&mut self, x0: usize, y0: usize, x1: usize, y1: usize, rgb: Rgb) {
            for y in y0..y1 {
                for x in x0..x1 {
                    let i = (y * self.w + x) * 4;
                    self.data[i..i + 3].copy_from_slice(&[rgb[2], rgb[1], rgb[0]]);
                }
            }
        }
        fn frame(&self) -> Frame<'_> {
            Frame {
                data: &self.data,
                width: self.w,
                height: self.h,
                stride: self.w * 4,
            }
        }
    }

    const NEUTRAL: Tuning = Tuning {
        saturation: 1.0,
        brightness: 1.0,
        smoothing: 0.0,
    };

    /// The whole picture as one color.
    fn average(f: &Frame, t: &Tuning) -> Rgb {
        let r = content_rect(f);
        let mut acc = Acc::default();
        for y in r.y0..r.y1 {
            for x in r.x0..r.x1 {
                acc.add(read_px(f, x, y));
            }
        }
        acc.finish(t)
    }

    fn near(a: Rgb, b: Rgb, tol: i32) -> bool {
        (0..3).all(|i| (a[i] as i32 - b[i] as i32).abs() <= tol)
    }

    #[test]
    fn solid_color_passes_through() {
        let img = Img::new(64, 36, [200, 40, 10]);
        let c = average(&img.frame(), &NEUTRAL);
        assert!(near(c, [200, 40, 10], 2), "{c:?}");
    }

    #[test]
    fn black_is_black() {
        let img = Img::new(64, 36, [0, 0, 0]);
        assert_eq!(average(&img.frame(), &NEUTRAL), [0, 0, 0]);
    }

    #[test]
    fn gray_stays_gray_even_with_boost() {
        let img = Img::new(64, 36, [128, 128, 128]);
        let t = Tuning {
            saturation: 2.0,
            ..NEUTRAL
        };
        let c = average(&img.frame(), &t);
        assert!(near(c, [128, 128, 128], 1), "{c:?}");
    }

    #[test]
    fn letterbox_bars_are_cropped() {
        let mut img = Img::new(64, 40, [0, 0, 0]);
        img.fill(0, 6, 64, 34, [220, 30, 30]);
        let r = content_rect(&img.frame());
        assert_eq!(
            r,
            Rect {
                x0: 0,
                y0: 6,
                x1: 64,
                y1: 34
            }
        );
        assert!(average(&img.frame(), &NEUTRAL)[0] > 180);
    }

    #[test]
    fn pillarbox_bars_are_cropped() {
        let mut img = Img::new(64, 40, [0, 0, 0]);
        img.fill(8, 0, 56, 40, [30, 220, 30]);
        let r = content_rect(&img.frame());
        assert_eq!((r.x0, r.x1, r.y0, r.y1), (8, 56, 0, 40));
    }

    #[test]
    fn saturated_pixels_dominate_hue() {
        // 70% dull gray, 30% vivid blue: hue should lean clearly blue.
        let mut img = Img::new(100, 10, [90, 90, 90]);
        img.fill(0, 0, 30, 10, [20, 40, 255]);
        let c = average(&img.frame(), &NEUTRAL);
        assert!(c[2] as i32 - c[0] as i32 > 40, "{c:?}");
    }

    #[test]
    fn brightness_scales_output() {
        let img = Img::new(32, 18, [200, 100, 50]);
        let t = Tuning {
            brightness: 0.5,
            ..NEUTRAL
        };
        let c = average(&img.frame(), &t);
        assert!(near(c, [100, 50, 25], 2), "{c:?}");
    }

    #[test]
    fn respects_stride_padding() {
        let (w, h, stride) = (16, 8, 16 * 4 + 32);
        let mut data = vec![0u8; stride * h];
        for y in 0..h {
            for x in 0..w {
                let i = y * stride + x * 4;
                data[i..i + 4].copy_from_slice(&[0, 0, 255, 255]);
            }
            // Garbage in padding.
            for p in &mut data[y * stride + w * 4..(y + 1) * stride] {
                *p = 0xAB;
            }
        }
        let f = Frame {
            data: &data,
            width: w,
            height: h,
            stride,
        };
        assert!(near(average(&f, &NEUTRAL), [255, 0, 0], 1));
    }

    #[test]
    fn smoother_instant_when_zero() {
        let mut s = Smoother::default();
        let a = [[0u8; 3]; 6];
        let b = [[255u8; 3]; 6];
        s.update(&a, 0.033, 0.0);
        assert_eq!(s.update(&b, 0.033, 0.0), b);
    }

    #[test]
    fn smoother_converges() {
        let mut s = Smoother::default();
        s.update(&[[0; 3]; 6], 0.033, 0.5);
        let target = [[255; 3]; 6];
        let first = s.update(&target, 0.033, 0.5)[0][0];
        assert!(first > 0 && first < 255);
        let mut last = first;
        for _ in 0..200 {
            last = s.update(&target, 0.033, 0.5)[0][0];
        }
        assert_eq!(last, 255);
    }
}
