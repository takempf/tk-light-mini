//! Canvases the lights can follow besides the screen: scenes the app paints
//! itself, and the screen run through a filter.
//!
//! Everything is tiny (128px wide, in the monitor's shape) and drawn from a
//! handful of palette colors with ordered dithering. It looks lo-fi on
//! purpose, and a frame costs well under a millisecond. The lights average
//! whole regions, so dithered pixels blend into smooth in-between colors.

use serde::Deserialize;

use crate::color::{Frame, Rgb};

/// What the lights follow. From JSON as its camelCase name.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Canvas {
    #[default]
    Screen,
    /// The screen in four dithered shades of phthalo green.
    Phthalo,
    /// Clouds drifting over a dark pine forest at night.
    Forest,
    Sunset,
    Aurora,
    /// Light rays and caustics under water.
    Sea,
    Lava,
    Fire,
}

impl Canvas {
    /// Needs screen capture.
    pub fn uses_screen(self) -> bool {
        matches!(self, Canvas::Screen | Canvas::Phthalo)
    }
}

/// Painted canvases are this wide.
const WIDTH: usize = 128;

/// Size of a painted canvas for a screen `aspect` (width over height) wide.
pub fn canvas_size(aspect: f32) -> (usize, usize) {
    let aspect = if aspect.is_finite() && aspect > 0.0 {
        aspect
    } else {
        16.0 / 9.0
    };
    let h = (WIDTH as f32 / aspect).round().clamp(24.0, 256.0) as usize;
    (WIDTH, h)
}

const fn hex(c: u32) -> Rgb {
    [(c >> 16) as u8, (c >> 8) as u8, c as u8]
}

const PHTHALO: [Rgb; 4] = [hex(0x06140f), hex(0x123524), hex(0x1f6b50), hex(0x8fd4b5)];

const NIGHT: [Rgb; 8] = [
    hex(0x080a12),
    hex(0x0e1422),
    hex(0x172036),
    hex(0x222e4a),
    hex(0x34425f),
    hex(0x4e5c7a),
    hex(0x7582a0),
    hex(0xaab4c8),
];
const PINE: [Rgb; 5] = [
    hex(0x030504),
    hex(0x070c0b),
    hex(0x0c1614),
    hex(0x13211f),
    hex(0x1c2e2c),
];
const FIREFLY: Rgb = hex(0xd4e46e);

const DUSK: [Rgb; 10] = [
    hex(0x1a0f2e),
    hex(0x2d1543),
    hex(0x4d1b56),
    hex(0x7a2160),
    hex(0xa8305e),
    hex(0xd34d52),
    hex(0xef7b45),
    hex(0xf9a94b),
    hex(0xffd57e),
    hex(0xfff2c2),
];
const TIDE: [Rgb; 8] = [
    hex(0x0b0616),
    hex(0x1a0f2e),
    hex(0x2d1543),
    hex(0x4d1b56),
    hex(0x7a2160),
    hex(0xd34d52),
    hex(0xf9a94b),
    hex(0xffd57e),
];

const POLAR: [Rgb; 8] = [
    hex(0x03050b),
    hex(0x071322),
    hex(0x0b2a33),
    hex(0x0f4d45),
    hex(0x178057),
    hex(0x2fb56c),
    hex(0x7fe39a),
    hex(0xd8ffc8),
];
const VIOLET: [Rgb; 5] = [
    hex(0x03050b),
    hex(0x0d0b24),
    hex(0x1f1440),
    hex(0x3a1d5e),
    hex(0x62307e),
];
const SNOW: [Rgb; 5] = [
    hex(0x070b16),
    hex(0x0e1828),
    hex(0x172a3c),
    hex(0x24424e),
    hex(0x3b6a68),
];
const STAR: Rgb = hex(0xc8d4f0);

const DEEP: [Rgb; 9] = [
    hex(0x020a12),
    hex(0x04192a),
    hex(0x062a3f),
    hex(0x0a3f55),
    hex(0x0f5a6b),
    hex(0x1a7a80),
    hex(0x34a39a),
    hex(0x7fd3c0),
    hex(0xd4fff0),
];

const LAVA: [Rgb; 9] = [
    hex(0x12061c),
    hex(0x2a0b33),
    hex(0x4d1040),
    hex(0x7c1a45),
    hex(0xb32c3f),
    hex(0xe0503a),
    hex(0xf78a3d),
    hex(0xffc15e),
    hex(0xfff0a8),
];

const EMBER: [Rgb; 10] = [
    hex(0x070203),
    hex(0x1f0705),
    hex(0x3d0c06),
    hex(0x661605),
    hex(0x962508),
    hex(0xc43d0a),
    hex(0xe8650f),
    hex(0xf7931e),
    hex(0xffc24a),
    hex(0xffe89a),
];

/// 4x4 Bayer matrix: where in 0..1 a pixel flips to the next color.
#[inline(always)]
fn threshold(x: usize, y: usize) -> f32 {
    const BAYER: [[u8; 4]; 4] = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    (BAYER[y & 3][x & 3] as f32 + 0.5) / 16.0
}

/// `v` (0..1) along `pal`, dithered between the two nearest colors.
#[inline(always)]
fn ramp(pal: &[Rgb], v: f32, x: usize, y: usize) -> Rgb {
    let top = pal.len() - 1;
    let p = v.clamp(0.0, 1.0) * top as f32;
    let i = p as usize;
    let i = if p - i as f32 > threshold(x, y) {
        i + 1
    } else {
        i
    };
    pal[i.min(top)]
}

#[inline(always)]
fn hash(x: i32, y: i32) -> f32 {
    let mut h = (x as u32).wrapping_mul(0x8da6_b343) ^ (y as u32).wrapping_mul(0xd816_3841);
    h = (h ^ (h >> 13)).wrapping_mul(0xcb1a_b31f);
    h ^= h >> 16;
    (h >> 8) as f32 / (1u32 << 24) as f32
}

#[inline(always)]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[inline(always)]
fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Smooth value noise in 0..1.
fn noise(x: f32, y: f32) -> f32 {
    let (xf, yf) = (x.floor(), y.floor());
    let (fx, fy) = (x - xf, y - yf);
    let (xi, yi) = (xf as i32, yf as i32);
    let sx = fx * fx * (3.0 - 2.0 * fx);
    let sy = fy * fy * (3.0 - 2.0 * fy);
    let top = lerp(hash(xi, yi), hash(xi + 1, yi), sx);
    let bottom = lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), sx);
    lerp(top, bottom, sy)
}

/// Layered noise in 0..1, bunched around 0.5.
fn fbm(mut x: f32, mut y: f32, octaves: u32) -> f32 {
    let (mut sum, mut amp, mut norm) = (0.0, 0.5, 0.0);
    for _ in 0..octaves {
        sum += amp * noise(x, y);
        norm += amp;
        amp *= 0.5;
        x = x * 2.0 + 17.3;
        y = y * 2.0 + 5.1;
    }
    sum / norm
}

/// A row of pines, in units where the canvas is 72 tall.
struct Pines {
    spacing: f32,
    min: f32,
    max: f32,
    seed: i32,
}

impl Pines {
    /// `(x, y)` is in a tree, or in the ground below `base`.
    fn hit(&self, x: f32, y: f32, base: f32) -> bool {
        if y >= base {
            return true;
        }
        let i = (x / self.spacing).floor() as i32;
        (i - 2..=i + 2).any(|k| {
            let height = lerp(self.min, self.max, hash(k, self.seed));
            let top = base - height;
            if y < top {
                return false;
            }
            let cx = (k as f32 + 0.2 + 0.6 * hash(k, self.seed + 1)) * self.spacing;
            // Widens toward the ground, stepping back in at each tier.
            let down = y - top;
            let tier = (down / (height * 0.2).max(2.0)).fract();
            (x - cx).abs() <= down * 0.3 * (0.65 + 0.35 * tier) + 0.3
        })
    }
}

/// A BGRA canvas being painted.
struct Img<'a> {
    out: &'a mut [u8],
    w: usize,
    h: usize,
    /// Scale to units where the canvas is 72 tall, so scenes look alike on
    /// any screen shape.
    k: f32,
}

impl Img<'_> {
    #[inline(always)]
    fn put(&mut self, x: usize, y: usize, c: Rgb) {
        let i = (y * self.w + x) * 4;
        self.out[i..i + 4].copy_from_slice(&[c[2], c[1], c[0], 255]);
    }

    /// Paint every pixel from `f(x, y, u, v)`, with `u, v` in 72-tall units.
    fn fill(&mut self, mut f: impl FnMut(usize, usize, f32, f32) -> Rgb) {
        for y in 0..self.h {
            let v = y as f32 * self.k;
            for x in 0..self.w {
                let c = f(x, y, x as f32 * self.k, v);
                self.put(x, y, c);
            }
        }
    }

    /// Canvas width in 72-tall units.
    fn width(&self) -> f32 {
        self.w as f32 * self.k
    }
}

/// Paints scenes. Holds what a scene carries from frame to frame.
#[derive(Default)]
pub struct Painter {
    /// Fire: heat per pixel, and the time it last stepped.
    heat: Vec<u8>,
    clock: f32,
    rng: u32,
}

impl Painter {
    /// Paint `canvas` at `t` seconds into `out`, `w`x`h` BGRA. The screen
    /// canvases aren't painted: `out` is left as is.
    pub fn paint(&mut self, canvas: Canvas, t: f32, w: usize, h: usize, out: &mut Vec<u8>) {
        out.resize(w * h * 4, 0);
        let mut img = Img {
            out,
            w,
            h,
            k: 72.0 / h.max(1) as f32,
        };
        match canvas {
            Canvas::Screen | Canvas::Phthalo => {}
            Canvas::Forest => forest(&mut img, t),
            Canvas::Sunset => sunset(&mut img, t),
            Canvas::Aurora => aurora(&mut img, t),
            Canvas::Sea => sea(&mut img, t),
            Canvas::Lava => lava(&mut img, t),
            Canvas::Fire => self.fire(&mut img, t),
        }
    }

    fn next(&mut self) -> u32 {
        // xorshift32
        let mut x = self.rng.max(1);
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.rng = x;
        x
    }

    /// Doom's fire: heat rises a row at a time, cooling and drifting sideways
    /// at random. Steps 30 times a second whatever the frame rate.
    fn fire(&mut self, img: &mut Img, t: f32) {
        const STEP: f32 = 1.0 / 30.0;
        let (w, h) = (img.w, img.h);
        // Flames reach about 70% of the way up.
        let max = (h as f32 * 0.36).clamp(8.0, 255.0) as u8;
        if self.heat.len() != w * h {
            self.heat = vec![0; w * h];
            self.clock = t;
        }
        if t - self.clock > 4.0 * STEP {
            self.clock = t - 4.0 * STEP;
        }
        while self.clock < t {
            self.clock += STEP;
            // The logs glow unevenly and breathe.
            let base = (h - 1) * w;
            for x in 0..w {
                let glow = 0.75 + 0.25 * noise(x as f32 * 0.12, self.clock * 0.7);
                self.heat[base + x] = (max as f32 * glow) as u8;
            }
            for y in 1..h {
                for x in 0..w {
                    // As in Doom: one roll both cools and drifts, which
                    // shapes the tongues.
                    let r = self.next() & 3;
                    let to = (x as i32 - r as i32 + 1).rem_euclid(w as i32) as usize;
                    self.heat[(y - 1) * w + to] = self.heat[y * w + x].saturating_sub(r as u8 & 1);
                }
            }
        }
        let heat = &self.heat;
        let inv_h = 1.0 / h as f32;
        img.fill(|x, y, _, _| {
            let v = heat[y * w + x] as f32 / max as f32;
            // A faint warm glow on the room behind the flames.
            let room = 0.2 * (y as f32 * inv_h).powf(1.5);
            ramp(&EMBER, v.max(room), x, y)
        });
    }
}

/// Clouds drift past a hidden moon over three rows of pines, the nearest
/// sliding by fastest. A few fireflies blink in the dark.
fn forest(img: &mut Img, t: f32) {
    let width = img.width();
    let (moon_x, moon_y, moon_r) = (width * 0.74, 14.0, 4.0);
    let rows = [
        (
            Pines {
                spacing: 13.0,
                min: 26.0,
                max: 44.0,
                seed: 3,
            },
            64.0,
            2.4,
            0.02,
        ),
        (
            Pines {
                spacing: 8.0,
                min: 13.0,
                max: 24.0,
                seed: 2,
            },
            54.0,
            1.2,
            0.45,
        ),
        (
            Pines {
                spacing: 5.0,
                min: 8.0,
                max: 15.0,
                seed: 1,
            },
            47.0,
            0.6,
            0.85,
        ),
    ];
    img.fill(|x, y, u, v| {
        for (i, (pines, base, speed, shade)) in rows.iter().enumerate() {
            let wx = u + t * speed;
            let ground = base + 3.0 * (noise(wx * 0.04, i as f32 * 7.0) - 0.5);
            if pines.hit(wx, v, ground) {
                // Mist pools low between the far rows.
                let mist = if i == 0 {
                    0.0
                } else {
                    0.35 * smoothstep(ground - 10.0, ground + 4.0, v)
                        * fbm(u * 0.05 + t * 0.03, v * 0.2 + i as f32, 2)
                };
                return ramp(&PINE, shade + mist, x, y);
            }
        }
        let dm = ((u - moon_x).powi(2) + (v - moon_y).powi(2)).sqrt();
        let glow = (-dm * dm / 500.0).exp();
        let cloud = fbm(u * 0.035 + t * 0.012, v * 0.08 - t * 0.003, 4);
        let cover = smoothstep(0.42, 0.62, cloud);
        // Lighter toward the horizon; clouds dark except where the moon lights them.
        let sky = 0.2 + 0.25 * (v / 50.0) + 0.45 * glow;
        let lit = 0.08 + 0.75 * glow + 0.3 * (cloud - 0.5);
        let mut s = lerp(sky, lit, cover);
        if dm < moon_r && cover < 0.6 {
            s = 1.0;
        }
        ramp(&NIGHT, s, x, y)
    });
    for i in 0..6 {
        let blink = (t * 0.8 + i as f32 * 1.7).sin();
        if blink < 0.4 {
            continue;
        }
        let fx = hash(i, 90) * width + 4.0 * (t * 0.21 + i as f32).sin();
        let fy = 58.0 + 10.0 * hash(i, 91) + 2.0 * (t * 0.17 + i as f32 * 2.0).sin();
        let (px, py) = ((fx / img.k) as i32, (fy / img.k) as i32);
        if (0..img.w as i32).contains(&px) && (0..img.h as i32).contains(&py) {
            img.put(px as usize, py as usize, FIREFLY);
        }
    }
}

/// A low sun over the sea, streaks of cloud and a shimmering path of light.
fn sunset(img: &mut Img, t: f32) {
    let width = img.width();
    let horizon = 44.0;
    let (sun_x, sun_y, sun_r) = (width * 0.6, horizon - 5.0 + 1.5 * (t * 0.05).sin(), 7.0);
    img.fill(|x, y, u, v| {
        let dx = u - sun_x;
        if v < horizon {
            let d = (dx * dx + (v - sun_y).powi(2)).sqrt();
            if d < sun_r {
                return ramp(&DUSK, 0.9 + 0.1 * (1.0 - d / sun_r), x, y);
            }
            let glow = (-d * d / 900.0).exp();
            let s = 0.85 * (v / horizon).powf(1.6) + 0.35 * glow;
            // Long thin clouds, dark on top and lit from below near the sun.
            let n = fbm(u * 0.025 + t * 0.01, v * 0.22, 4);
            let cover = smoothstep(0.52, 0.64, n) * smoothstep(4.0, 12.0, v);
            let cloud = 0.12 + 0.2 * (v / horizon) + 0.55 * glow;
            return ramp(&DUSK, lerp(s, cloud, cover), x, y);
        }
        let depth = (v - horizon) / (72.0 - horizon);
        // The sky's reflection, darker, with ripples.
        let ripple = fbm(u * 0.05, (v - horizon) * 0.6 - t * 0.25, 2);
        let mut s = 0.6 * (1.0 - depth).powi(2) + 0.1 * (ripple - 0.5);
        let spread = sun_r * (1.0 + depth * 3.0);
        let path = (-dx * dx / (spread * spread)).exp();
        let glint = fbm(u * 0.12 + t * 0.05, (v - horizon) * 1.1 - t * 0.6, 2);
        s += path * (0.25 + 0.7 * smoothstep(0.45, 0.65, glint)) * (1.0 - 0.5 * depth);
        ramp(&TIDE, s, x, y)
    });
}

/// Curtains of green and violet wave over snowy hills and a few pines.
fn aurora(img: &mut Img, t: f32) {
    let width = img.width();
    let pines = Pines {
        spacing: 7.0,
        min: 5.0,
        max: 13.0,
        seed: 11,
    };
    img.fill(|x, y, u, v| {
        // Two curtains, each a wavy lower edge that fades upward in rays.
        let (mut green, mut violet) = (0.0f32, 0.0f32);
        for j in 0..2 {
            let jf = j as f32;
            let phase = u / width * std::f32::consts::TAU * (0.7 + 0.3 * jf);
            let edge = 30.0
                + 8.0 * jf
                + 6.0 * (phase + t * (0.06 + 0.03 * jf)).sin()
                + 8.0 * (noise(u * 0.03 + t * 0.04, jf * 10.0) - 0.5);
            let up = edge - v;
            if up < -3.0 {
                continue;
            }
            let fall = if up < 0.0 {
                (up * 1.2).exp()
            } else {
                (-up / 16.0).exp()
            };
            let rays = 0.45 + 0.55 * noise(u * 0.35 + t * 0.15, t * 0.1 + jf * 4.0);
            let reach = smoothstep(0.3, 0.7, noise(u * 0.02 - t * 0.02, jf * 3.0 + 1.0));
            let a = fall * rays * reach;
            green += a * (1.0 - smoothstep(6.0, 22.0, up));
            violet += 0.4 * a * smoothstep(10.0, 26.0, up);
        }
        let hill = 60.0 + 4.0 * (noise(u * 0.05, 5.0) - 0.5);
        if v >= hill || pines.hit(u, v, hill + 1.5) {
            if v < hill {
                return PINE[0];
            }
            // Snow catches the glow above.
            let depth = (v - hill) / (72.0 - hill);
            return ramp(&SNOW, 0.35 + 0.4 * green.min(1.0) - 0.3 * depth, x, y);
        }
        if green + violet < 0.08 && hash(x as i32, y as i32) > 0.985 {
            let twinkle = (t * 1.5 + hash(y as i32, x as i32) * 40.0).sin();
            return if twinkle > -0.3 { STAR } else { VIOLET[2] };
        }
        if green > 0.1 && green >= violet {
            ramp(&POLAR, 0.08 + green * 0.9, x, y)
        } else {
            // A dark sky, lighter toward the hills.
            let sky = 0.14 + 0.24 * (v / hill).powi(2);
            ramp(&VIOLET, sky + violet, x, y)
        }
    });
}

/// Sunlight slanting down through the water, a web of caustics near the
/// surface and flecks drifting in the dark below.
fn sea(img: &mut Img, t: f32) {
    img.fill(|x, y, u, v| {
        let d = v / 72.0;
        let mut s = 0.62 * (1.0 - d).powf(1.5);
        let ray = noise((u + v * 0.45) * 0.07 + t * 0.03, t * 0.05);
        s += 0.3 * smoothstep(0.55, 0.8, ray) * (1.0 - d);
        let a = noise(u * 0.12 + t * 0.12, v * 0.16 - t * 0.07);
        let b = noise(u * 0.1 - t * 0.09, v * 0.13 + t * 0.1);
        let web = (1.0 - (a - b).abs() * 6.0).max(0.0).powi(3);
        s += 0.45 * web * (1.0 - d).powi(3);
        // Marine snow, sinking slowly.
        let flake = hash(x as i32, (v - t * 1.2).floor() as i32);
        if flake > 0.994 && d > 0.3 {
            s += 0.25;
        }
        ramp(&DEEP, s, x, y)
    });
}

/// Warm blobs rising and sinking slowly, merging where they meet.
fn lava(img: &mut Img, t: f32) {
    let width = img.width();
    let blobs: [(f32, f32, f32); 7] = std::array::from_fn(|i| {
        let fi = i as f32;
        let x = width * (0.5 + 0.4 * (t * (0.031 + 0.011 * fi) + fi * 2.1).sin());
        let y = 36.0 + 30.0 * (t * (0.043 + 0.009 * fi) + fi * 1.3).sin();
        let r = 7.0 + 5.0 * hash(i as i32, 40);
        (x, y, r * r)
    });
    img.fill(|x, y, u, v| {
        let f: f32 = blobs
            .iter()
            .map(|&(bx, by, r2)| r2 / ((u - bx).powi(2) + (v - by).powi(2) + 1.0))
            .sum();
        // Hotter at the bottom, where the lamp heats it.
        let bg = 0.05 + 0.12 * (v / 72.0).powi(2);
        let s = if f < 1.0 {
            bg + 0.3 * f * f
        } else {
            0.5 + 0.5 * smoothstep(1.0, 4.0, f)
        };
        ramp(&LAVA, s, x, y)
    });
}

/// The screen in four shades of phthalo green, by brightness, dithered.
pub fn phthalo(src: &Frame, out: &mut Vec<u8>) {
    out.clear();
    out.reserve(src.width * src.height * 4);
    for y in 0..src.height {
        let row = &src.data[y * src.stride..y * src.stride + src.width * 4];
        for (x, p) in row.as_chunks::<4>().0.iter().enumerate() {
            let luma = (0.0722 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.2126 * p[2] as f32) / 255.0;
            // A little contrast, so a normal picture uses all four.
            let v = (luma - 0.05) / 0.75;
            let [r, g, b] = ramp(&PHTHALO, v, x, y);
            out.extend_from_slice(&[b, g, r, 255]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCENES: [Canvas; 6] = [
        Canvas::Forest,
        Canvas::Sunset,
        Canvas::Aurora,
        Canvas::Sea,
        Canvas::Lava,
        Canvas::Fire,
    ];

    #[test]
    fn canvases_deserialize() {
        let c: Canvas = serde_json::from_str("\"forest\"").unwrap();
        assert_eq!(c, Canvas::Forest);
        assert!(Canvas::Phthalo.uses_screen());
        assert!(!Canvas::Sea.uses_screen());
        assert!(serde_json::from_str::<Canvas>("\"nope\"").is_err());
    }

    #[test]
    fn size_follows_the_screen_shape() {
        assert_eq!(canvas_size(16.0 / 9.0), (128, 72));
        assert_eq!(canvas_size(21.0 / 9.0), (128, 55));
        assert_eq!(canvas_size(0.0), (128, 72));
        assert_eq!(canvas_size(100.0), (128, 24));
    }

    #[test]
    fn scenes_paint_every_pixel_from_their_palette() {
        let (w, h) = (128, 72);
        for scene in SCENES {
            let mut p = Painter::default();
            let mut out = Vec::new();
            for t in [0.0, 12.5, 3600.0] {
                p.paint(scene, t, w, h, &mut out);
            }
            assert_eq!(out.len(), w * h * 4, "{scene:?}");
            assert!(out.chunks(4).all(|px| px[3] == 255), "{scene:?} opaque");
            assert!(
                out.chunks(4).any(|px| px[..3] != out[..3]),
                "{scene:?} not flat"
            );
        }
    }

    #[test]
    fn scenes_move() {
        for scene in SCENES {
            let mut p = Painter::default();
            let (mut a, mut b) = (Vec::new(), Vec::new());
            p.paint(scene, 10.0, 128, 72, &mut a);
            p.paint(scene, 20.0, 128, 72, &mut b);
            assert_ne!(a, b, "{scene:?}");
        }
    }

    #[test]
    fn phthalo_uses_four_greens() {
        let (w, h) = (16, 16);
        let data: Vec<u8> = (0..w * h)
            .flat_map(|i| {
                let v = (i * 255 / (w * h)) as u8;
                [v, v, v, 255]
            })
            .collect();
        let f = Frame {
            data: &data,
            width: w,
            height: h,
            stride: w * 4,
        };
        let mut out = Vec::new();
        phthalo(&f, &mut out);
        let colors: std::collections::HashSet<_> =
            out.chunks(4).map(|p| [p[2], p[1], p[0]]).collect();
        assert_eq!(colors.len(), 4);
        assert!(colors.iter().all(|c| PHTHALO.contains(c)));
        assert_eq!(&out[..3], &[0x0f, 0x14, 0x06], "black is the darkest");
    }

    /// Writes each scene as a PPM, for looking at:
    /// `cargo test -- --ignored render_canvases --nocapture`
    #[test]
    #[ignore]
    fn render_canvases() {
        let dir = std::env::temp_dir().join("tk-light-canvases");
        std::fs::create_dir_all(&dir).unwrap();
        let (w, h) = (128, 72);
        for scene in SCENES {
            let mut p = Painter::default();
            let mut out = Vec::new();
            for (n, t) in [5.0f32, 40.0].iter().enumerate() {
                // Warm up stateful scenes.
                for k in 0..30 {
                    p.paint(scene, t - 1.0 + k as f32 / 30.0, w, h, &mut out);
                }
                let mut ppm = format!("P6 {w} {h} 255\n").into_bytes();
                ppm.extend(out.chunks(4).flat_map(|px| [px[2], px[1], px[0]]));
                let path = dir.join(format!("{scene:?}-{n}.ppm").to_lowercase());
                std::fs::write(&path, ppm).unwrap();
                println!("{}", path.display());
            }
        }
    }
}
