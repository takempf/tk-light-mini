//! Sampling paths: a line with a thickness, drawn over the screen, split along
//! its length into one region per light segment.
//!
//! Each pixel within half the thickness of the path goes to the nearest point
//! on it. How far along the path that point is picks the segment, so pixels at
//! a corner count once, for the nearer leg.

use serde::Deserialize;

use crate::zones::{read_px, Acc, Frame, Rgb, Tuning};

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathConfig {
    /// Screen fractions (0..1), from where the strip starts.
    pub points: Vec<[f32; 2]>,
    /// Thickness, as a fraction of the screen height.
    pub width: f32,
    /// Joins the last point back to the first.
    #[serde(default)]
    pub closed: bool,
}

/// Where the path runs, in pixels, with the length up to each point.
struct Geometry {
    pts: Vec<[f32; 2]>,
    /// `lens[i]` = length along the path to `pts[i]`.
    lens: Vec<f32>,
}

impl Geometry {
    fn new(p: &PathConfig, w: usize, h: usize) -> Self {
        let mut pts: Vec<[f32; 2]> = p
            .points
            .iter()
            .map(|[x, y]| [x.clamp(0.0, 1.0) * w as f32, y.clamp(0.0, 1.0) * h as f32])
            .collect();
        if p.closed && pts.len() > 2 {
            pts.push(pts[0]);
        }
        let mut lens = Vec::with_capacity(pts.len());
        let mut total = 0.0;
        for (i, q) in pts.iter().enumerate() {
            if i > 0 {
                total += dist(pts[i - 1], *q);
            }
            lens.push(total);
        }
        Self { pts, lens }
    }

    fn total(&self) -> f32 {
        self.lens.last().copied().unwrap_or(0.0)
    }

    /// Squared distance from `c` to the path, and how far along it the nearest
    /// point is.
    fn nearest(&self, c: [f32; 2]) -> (f32, f32) {
        match self.pts.len() {
            0 => (f32::MAX, 0.0),
            1 => (dist2(c, self.pts[0]), 0.0),
            _ => self
                .pts
                .windows(2)
                .zip(&self.lens)
                .map(|(ab, &start)| {
                    let (a, b) = (ab[0], ab[1]);
                    let ab = [b[0] - a[0], b[1] - a[1]];
                    let len2 = ab[0] * ab[0] + ab[1] * ab[1];
                    let u = if len2 > 0.0 {
                        (((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1]) / len2).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };
                    let q = [a[0] + ab[0] * u, a[1] + ab[1] * u];
                    (dist2(c, q), start + u * len2.sqrt())
                })
                .fold(
                    (f32::MAX, 0.0),
                    |best, x| if x.0 < best.0 { x } else { best },
                ),
        }
    }

    /// The point `at` along the path.
    fn point_at(&self, at: f32) -> Option<[f32; 2]> {
        for i in 1..self.pts.len() {
            if self.lens[i] >= at {
                let (a, b) = (self.pts[i - 1], self.pts[i]);
                let span = self.lens[i] - self.lens[i - 1];
                let u = if span > 0.0 {
                    ((at - self.lens[i - 1]) / span).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                return Some([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
            }
        }
        self.pts.last().copied()
    }
}

fn dist2(a: [f32; 2], b: [f32; 2]) -> f32 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)
}

fn dist(a: [f32; 2], b: [f32; 2]) -> f32 {
    dist2(a, b).sqrt()
}

/// Which pixels feed which segment, for one path, segment count and frame size.
pub struct PathSampler {
    w: usize,
    h: usize,
    segments: usize,
    /// `(x, y, segment)`, in row order.
    pixels: Vec<(u16, u16, u16)>,
    acc: Vec<Acc>,
}

impl PathSampler {
    pub fn new(p: &PathConfig, segments: usize, w: usize, h: usize) -> Self {
        let n = segments.max(1);
        let g = Geometry::new(p, w, h);
        let total = g.total();
        // At least one pixel wide, so thin paths still hit something.
        let r = (p.width.max(0.0) * h as f32 / 2.0).max(0.71);
        let mut pixels = Vec::new();
        let mut hit = vec![false; n];
        if !g.pts.is_empty() {
            for y in 0..h {
                for x in 0..w {
                    let (d2, at) = g.nearest([x as f32 + 0.5, y as f32 + 0.5]);
                    if d2 <= r * r {
                        let s = segment_at(at, total, n);
                        hit[s] = true;
                        pixels.push((x as u16, y as u16, s as u16));
                    }
                }
            }
            // A segment too short to own a pixel takes the one under its middle.
            for (s, _) in hit.iter().enumerate().filter(|(_, h)| !**h) {
                if let Some([px, py]) = g.point_at((s as f32 + 0.5) / n as f32 * total) {
                    let x = (px as usize).min(w.saturating_sub(1));
                    let y = (py as usize).min(h.saturating_sub(1));
                    pixels.push((x as u16, y as u16, s as u16));
                }
            }
        }
        Self {
            w,
            h,
            segments: n,
            pixels,
            acc: vec![Acc::default(); n],
        }
    }

    /// Still valid for this segment count and frame size.
    pub fn fits(&self, segments: usize, w: usize, h: usize) -> bool {
        self.segments == segments.max(1) && self.w == w && self.h == h
    }

    /// One color per segment. `out` is resized to the segment count.
    pub fn sample(&mut self, frame: &Frame, t: &Tuning, out: &mut Vec<Rgb>) {
        self.acc.fill(Acc::default());
        if frame.width == self.w && frame.height == self.h {
            for &(x, y, s) in &self.pixels {
                self.acc[s as usize].add(read_px(frame, x as usize, y as usize));
            }
        }
        out.clear();
        out.extend(self.acc.iter().map(|a| a.finish(t)));
    }
}

fn segment_at(at: f32, total: f32, n: usize) -> usize {
    if total <= 0.0 {
        return 0;
    }
    ((at / total * n as f32) as usize).min(n - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NEUTRAL: Tuning = Tuning {
        saturation: 1.0,
        brightness: 1.0,
        depth: 0.2,
        smoothing: 0.0,
    };

    /// BGRA frame, filled by `f(x, y) -> rgb`.
    fn frame_data(w: usize, h: usize, f: impl Fn(usize, usize) -> Rgb) -> Vec<u8> {
        let mut d = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let [r, g, b] = f(x, y);
                d.extend_from_slice(&[b, g, r, 255]);
            }
        }
        d
    }

    fn frame(d: &[u8], w: usize, h: usize) -> Frame<'_> {
        Frame {
            data: d,
            width: w,
            height: h,
            stride: w * 4,
        }
    }

    fn line(points: &[[f32; 2]], width: f32, closed: bool) -> PathConfig {
        PathConfig {
            points: points.to_vec(),
            width,
            closed,
        }
    }

    #[test]
    fn splits_a_line_into_equal_segments() {
        // Left half red, right half blue; a line across the middle, 2 segments.
        let (w, h) = (100, 50);
        let d = frame_data(w, h, |x, _| if x < 50 { [255, 0, 0] } else { [0, 0, 255] });
        let p = line(&[[0.0, 0.5], [1.0, 0.5]], 0.2, false);
        let mut s = PathSampler::new(&p, 2, w, h);
        let mut out = Vec::new();
        s.sample(&frame(&d, w, h), &NEUTRAL, &mut out);
        assert_eq!(out, [[255, 0, 0], [0, 0, 255]]);
    }

    #[test]
    fn direction_follows_point_order() {
        let (w, h) = (100, 50);
        let d = frame_data(w, h, |x, _| if x < 50 { [255, 0, 0] } else { [0, 0, 255] });
        let p = line(&[[1.0, 0.5], [0.0, 0.5]], 0.2, false);
        let mut out = Vec::new();
        PathSampler::new(&p, 2, w, h).sample(&frame(&d, w, h), &NEUTRAL, &mut out);
        assert_eq!(out, [[0, 0, 255], [255, 0, 0]]);
    }

    #[test]
    fn samples_only_within_the_thickness() {
        // Green band at the top, a path along the bottom: sees none of it.
        let (w, h) = (100, 100);
        let d = frame_data(w, h, |_, y| if y < 20 { [0, 255, 0] } else { [40, 40, 40] });
        let p = line(&[[0.0, 0.9], [1.0, 0.9]], 0.1, false);
        let mut out = Vec::new();
        PathSampler::new(&p, 1, w, h).sample(&frame(&d, w, h), &NEUTRAL, &mut out);
        assert_eq!(out, [[40, 40, 40]]);
    }

    #[test]
    fn closed_loop_covers_all_four_edges_once() {
        let (w, h) = (80, 40);
        let p = line(
            &[[0.95, 0.9], [0.95, 0.1], [0.05, 0.1], [0.05, 0.9]],
            0.15,
            true,
        );
        let s = PathSampler::new(&p, 8, w, h);
        let mut seen = std::collections::HashSet::new();
        for &(x, y, seg) in &s.pixels {
            assert!(seen.insert((x, y)), "pixel counted twice");
            assert!((seg as usize) < 8);
        }
        let segs: std::collections::HashSet<u16> = s.pixels.iter().map(|p| p.2).collect();
        assert_eq!(segs.len(), 8, "every segment has pixels");
        // The middle of the screen is outside the path.
        assert!(!seen.contains(&(40, 20)));
    }

    #[test]
    fn tiny_segments_still_get_a_pixel() {
        let (w, h) = (20, 10);
        let p = line(&[[0.0, 0.5], [1.0, 0.5]], 0.0, false);
        let s = PathSampler::new(&p, 60, w, h);
        let segs: std::collections::HashSet<u16> = s.pixels.iter().map(|p| p.2).collect();
        assert_eq!(segs.len(), 60);
    }

    #[test]
    fn empty_path_is_black() {
        let (w, h) = (10, 10);
        let d = frame_data(w, h, |_, _| [200, 200, 200]);
        let p = line(&[], 0.1, false);
        let mut out = Vec::new();
        PathSampler::new(&p, 3, w, h).sample(&frame(&d, w, h), &NEUTRAL, &mut out);
        assert_eq!(out, [[0, 0, 0]; 3]);
    }

    #[test]
    fn refits_on_size_or_count_change() {
        let p = line(&[[0.0, 0.5], [1.0, 0.5]], 0.1, false);
        let s = PathSampler::new(&p, 4, 100, 50);
        assert!(s.fits(4, 100, 50));
        assert!(!s.fits(5, 100, 50));
        assert!(!s.fits(4, 120, 50));
    }

    /// Real desktop: an edge loop of 10 segments over a captured frame, with
    /// timings. `cargo test -- --ignored live_path --nocapture`
    #[test]
    #[ignore]
    fn live_path() {
        use crate::capture::Capturer;
        use std::time::{Duration, Instant};
        let mut c = Capturer::new(0).expect("create capturer");
        let loop_ = line(
            &[[0.95, 0.9], [0.95, 0.1], [0.05, 0.1], [0.05, 0.9]],
            0.12,
            true,
        );
        for _ in 0..60 {
            let r = c
                .poll(|f| {
                    let t0 = Instant::now();
                    let mut s = PathSampler::new(&loop_, 10, f.width, f.height);
                    let built = t0.elapsed();
                    let t1 = Instant::now();
                    let mut out = Vec::new();
                    s.sample(f, &Tuning::default(), &mut out);
                    (f.width, f.height, s.pixels.len(), built, t1.elapsed(), out)
                })
                .unwrap();
            if let Some((w, h, px, built, sampled, out)) = r {
                println!("{w}x{h}, {px} path pixels, built in {built:?}, sampled in {sampled:?}");
                for (i, c) in out.iter().enumerate() {
                    println!("segment {}: {c:?}", i + 1);
                }
                assert_eq!(out.len(), 10);
                return;
            }
            std::thread::sleep(Duration::from_millis(33));
        }
        panic!("no frame within 2s");
    }
}
