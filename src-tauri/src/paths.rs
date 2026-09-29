//! Sampling paths: a line with a thickness, drawn over the screen, split along
//! its length into one region per light segment.
//!
//! Mitered bands share a diagonal at corners, including the outer corner pixels.
//! Each leg's joined edges are split into segment regions, matching the preview.
//! A pixel belongs to only one region. An open path's ends are cut square,
//! the way it's drawn: nothing past its first or last point counts.
//!
//! Paths are drawn over the whole screen but laid over the picture: with
//! letterbox bars, a path along the screen edge follows the picture's edge.

use serde::Deserialize;

use crate::color::{read_px, Acc, Frame, Rect, Rgb, Tuning};

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
    /// Has ends, cut square.
    open: bool,
}

impl Geometry {
    fn new(p: &PathConfig, r: Rect) -> Self {
        let (w, h) = ((r.x1 - r.x0) as f32, (r.y1 - r.y0) as f32);
        let mut pts: Vec<[f32; 2]> = p
            .points
            .iter()
            .map(|[x, y]| {
                [
                    r.x0 as f32 + x.clamp(0.0, 1.0) * w,
                    r.y0 as f32 + y.clamp(0.0, 1.0) * h,
                ]
            })
            .collect();
        pts.dedup();
        if p.closed && pts.len() > 1 && pts.first() == pts.last() {
            pts.pop();
        }
        let open = !(p.closed && pts.len() > 2);
        if !open {
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
        Self { pts, lens, open }
    }

    fn total(&self) -> f32 {
        self.lens.last().copied().unwrap_or(0.0)
    }

    /// Same joined quadrilaterals as `bandRegions` in the frontend.
    fn regions(&self, r: f32, count: usize) -> Vec<(usize, [[f32; 2]; 4])> {
        let n = self.pts.len() - usize::from(!self.open);
        if n < 2 {
            return Vec::new();
        }
        let normal = |a: [f32; 2], b: [f32; 2]| {
            let len = dist(a, b);
            if len > 0.0 {
                [-(b[1] - a[1]) / len, (b[0] - a[0]) / len]
            } else {
                [0.0, 0.0]
            }
        };
        let offsets: Vec<[f32; 2]> = (0..n)
            .map(|i| {
                let before = if !self.open || i > 0 {
                    Some(normal(self.pts[(i + n - 1) % n], self.pts[i]))
                } else {
                    None
                };
                let after = if !self.open || i < n - 1 {
                    Some(normal(self.pts[i], self.pts[(i + 1) % n]))
                } else {
                    None
                };
                let a = before.or(after).unwrap_or([0.0, 1.0]);
                let b = after.or(before).unwrap_or([0.0, 1.0]);
                let sum = [a[0] + b[0], a[1] + b[1]];
                let len = dist([0.0, 0.0], sum);
                if len < 1e-6 {
                    return [b[0] * r, b[1] * r];
                }
                let unit = [sum[0] / len, sum[1] / len];
                let size = (r / (unit[0] * b[0] + unit[1] * b[1]).max(1e-6)).min(4.0 * r);
                [unit[0] * size, unit[1] * size]
            })
            .collect();
        let mut regions = Vec::new();
        for i in 0..self.pts.len().saturating_sub(1) {
            let j = (i + 1) % n;
            let (a, b) = (self.pts[i], self.pts[i + 1]);
            let length = self.lens[i + 1] - self.lens[i];
            if length <= 0.0 {
                continue;
            }
            let edge = |t: f32, side: f32| {
                std::array::from_fn(|axis| {
                    a[axis]
                        + (b[axis] - a[axis]) * t
                        + side * (offsets[i][axis] + (offsets[j][axis] - offsets[i][axis]) * t)
                })
            };
            for segment in 0..count {
                let from = self.lens[i].max(segment as f32 * self.total() / count as f32);
                let to = self.lens[i + 1].min((segment + 1) as f32 * self.total() / count as f32);
                if to <= from {
                    continue;
                }
                let lo = (from - self.lens[i]) / length;
                let hi = (to - self.lens[i]) / length;
                regions.push((
                    segment,
                    [edge(lo, 1.0), edge(hi, 1.0), edge(hi, -1.0), edge(lo, -1.0)],
                ));
            }
        }
        regions
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

fn contains(points: &[[f32; 2]; 4], c: [f32; 2]) -> bool {
    let mut inside = false;
    for i in 0..4 {
        let (a, b) = (points[i], points[(i + 1) % 4]);
        if (a[1] > c[1]) != (b[1] > c[1])
            && c[0] < (b[0] - a[0]) * (c[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
    }
    inside
}

/// Which pixels feed which segment, for one path, segment count, frame size
/// and picture rect.
pub struct PathSampler {
    w: usize,
    h: usize,
    rect: Rect,
    segments: usize,
    /// `(x, y, segment)`, in row order.
    pixels: Vec<(u16, u16, u16)>,
    acc: Vec<Acc>,
}

impl PathSampler {
    /// `rect` is the picture within the `w`x`h` frame.
    pub fn new(p: &PathConfig, segments: usize, w: usize, h: usize, rect: Rect) -> Self {
        let n = segments.max(1);
        let g = Geometry::new(p, rect);
        let total = g.total();
        // At least one pixel wide, so thin paths still hit something.
        let r = (p.width.max(0.0) * (rect.y1 - rect.y0) as f32 / 2.0).max(0.71);
        let regions = g.regions(r, n);
        let mut pixels = Vec::new();
        let mut hit = vec![false; n];
        if !g.pts.is_empty() {
            for y in rect.y0..rect.y1 {
                for x in rect.x0..rect.x1 {
                    let c = [x as f32 + 0.5, y as f32 + 0.5];
                    if let Some(&(s, _)) = regions.iter().find(|(_, points)| contains(points, c)) {
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
            rect,
            segments: n,
            pixels,
            acc: vec![Acc::default(); n],
        }
    }

    /// Still valid for this segment count, frame size and picture rect.
    pub fn fits(&self, segments: usize, w: usize, h: usize, rect: Rect) -> bool {
        self.segments == segments.max(1) && self.w == w && self.h == h && self.rect == rect
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

#[cfg(test)]
mod tests {
    use super::*;

    const NEUTRAL: Tuning = Tuning {
        saturation: 1.0,
        brightness: 1.0,
        smoothing: 0.0,
    };

    fn full(w: usize, h: usize) -> Rect {
        Rect {
            x0: 0,
            y0: 0,
            x1: w,
            y1: h,
        }
    }

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
        let mut s = PathSampler::new(&p, 2, w, h, full(w, h));
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
        PathSampler::new(&p, 2, w, h, full(w, h)).sample(&frame(&d, w, h), &NEUTRAL, &mut out);
        assert_eq!(out, [[0, 0, 255], [255, 0, 0]]);
    }

    #[test]
    fn samples_only_within_the_thickness() {
        // Green band at the top, a path along the bottom: sees none of it.
        let (w, h) = (100, 100);
        let d = frame_data(w, h, |_, y| if y < 20 { [0, 255, 0] } else { [40, 40, 40] });
        let p = line(&[[0.0, 0.9], [1.0, 0.9]], 0.1, false);
        let mut out = Vec::new();
        PathSampler::new(&p, 1, w, h, full(w, h)).sample(&frame(&d, w, h), &NEUTRAL, &mut out);
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
        let s = PathSampler::new(&p, 8, w, h, full(w, h));
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
    fn open_ends_are_cut_square() {
        // A thick line across the middle, from 0.2 to 0.8 of the width.
        let (w, h) = (100, 50);
        let p = line(&[[0.2, 0.5], [0.8, 0.5]], 0.8, false);
        let s = PathSampler::new(&p, 1, w, h, full(w, h));
        let xs: Vec<u16> = s.pixels.iter().map(|p| p.0).collect();
        assert_eq!(xs.iter().min(), Some(&20));
        assert_eq!(xs.iter().max(), Some(&79));
        // A loop has no ends: its mitered corners extend past the centerline.
        let square = line(&[[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]], 0.2, true);
        let s = PathSampler::new(&square, 1, w, h, full(w, h));
        assert!(s.pixels.iter().any(|p| p.0 < 30));
    }

    #[test]
    fn square_corners_are_sampled_once_including_the_loop_seam() {
        let p = line(&[[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], 0.4, true);
        let mut sampler = PathSampler::new(&p, 4, 20, 20, full(20, 20));
        let seen: std::collections::HashSet<_> =
            sampler.pixels.iter().map(|p| (p.0, p.1)).collect();
        assert_eq!(
            seen.len(),
            sampler.pixels.len(),
            "no double counting at joins"
        );
        assert_eq!(seen.len(), 20 * 20 - 4 * 4);
        for corner in [(0, 0), (19, 0), (19, 19), (0, 19)] {
            assert!(seen.contains(&corner), "missing outer corner {corner:?}");
        }
        let regions = Geometry::new(&p, full(20, 20)).regions(4.0, 4);
        let expected = [[8.0, 8.0], [12.0, 8.0], [20.0, 0.0], [0.0, 0.0]];
        for (actual, expected) in regions[0].1.iter().flatten().zip(expected.iter().flatten()) {
            assert!((actual - expected).abs() < 1e-5);
        }
        // Color only the extreme corners that rounded bands previously missed.
        let data = frame_data(20, 20, |x, y| {
            if !(2..18).contains(&x) && !(2..18).contains(&y) {
                [255, 0, 0]
            } else {
                [0, 0, 0]
            }
        });
        let mut out = Vec::new();
        sampler.sample(&frame(&data, 20, 20), &NEUTRAL, &mut out);
        assert!(out.iter().all(|c| c[0] > 0 && c[1] == 0 && c[2] == 0));
    }

    #[test]
    fn tiny_segments_still_get_a_pixel() {
        let (w, h) = (20, 10);
        let p = line(&[[0.0, 0.5], [1.0, 0.5]], 0.0, false);
        let s = PathSampler::new(&p, 60, w, h, full(w, h));
        let segs: std::collections::HashSet<u16> = s.pixels.iter().map(|p| p.2).collect();
        assert_eq!(segs.len(), 60);
    }

    #[test]
    fn empty_path_is_black() {
        let (w, h) = (10, 10);
        let d = frame_data(w, h, |_, _| [200, 200, 200]);
        let p = line(&[], 0.1, false);
        let mut out = Vec::new();
        PathSampler::new(&p, 3, w, h, full(w, h)).sample(&frame(&d, w, h), &NEUTRAL, &mut out);
        assert_eq!(out, [[0, 0, 0]; 3]);
    }

    #[test]
    fn refits_on_size_or_count_change() {
        let p = line(&[[0.0, 0.5], [1.0, 0.5]], 0.1, false);
        let s = PathSampler::new(&p, 4, 100, 50, full(100, 50));
        assert!(s.fits(4, 100, 50, full(100, 50)));
        assert!(!s.fits(5, 100, 50, full(100, 50)));
        assert!(!s.fits(4, 120, 50, full(120, 50)));
        let boxed = Rect {
            y0: 5,
            y1: 45,
            ..full(100, 50)
        };
        assert!(!s.fits(4, 100, 50, boxed));
    }

    #[test]
    fn follows_the_picture_inside_letterbox_bars() {
        // Bars 10px top and bottom; the picture is red on top, blue below.
        let (w, h) = (100, 60);
        let d = frame_data(w, h, |_, y| match y {
            10..30 => [255, 0, 0],
            30..50 => [0, 0, 255],
            _ => [0, 0, 0],
        });
        let rect = Rect {
            y0: 10,
            y1: 50,
            ..full(w, h)
        };
        // Along the top edge: the picture's top, not the bar.
        let top = line(&[[0.0, 0.05], [1.0, 0.05]], 0.1, false);
        let mut s = PathSampler::new(&top, 1, w, h, rect);
        assert!(s.pixels.iter().all(|&(_, y, _)| (10..50).contains(&y)));
        let mut out = Vec::new();
        s.sample(&frame(&d, w, h), &NEUTRAL, &mut out);
        assert_eq!(out, [[255, 0, 0]]);
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
                    let rect = crate::color::content_rect(f);
                    let mut s = PathSampler::new(&loop_, 10, f.width, f.height, rect);
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
