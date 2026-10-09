import { bandRegions, resolvePath, splitPath } from "../../../packages/light-core/src/path.js";
import type { Frame, Path, Rgb, Setup } from "./types.js";

export const rgb = (hex: string): Rgb => {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error("Invalid color");
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
};

const linear = Array.from({ length: 256 }, (_, i) => {
  const x = i / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
});
const srgb = (x: number) =>
  x <= 0.0031308 ? x * 12.92 : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055;
const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x + 1e-7)));

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function contentRect(frame: Frame): Rect {
  const { width: w, height: h, bgra } = frame;
  let x0 = 0,
    y0 = 0,
    x1 = w,
    y1 = h;
  const black = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return Math.max(bgra[i] ?? 0, bgra[i + 1] ?? 0, bgra[i + 2] ?? 0) <= 14;
  };
  const row = (y: number) => {
    let dark = 0;
    for (let x = 0; x < w; x++) dark += Number(black(x, y));
    return dark >= w * 0.9;
  };
  const col = (x: number) => {
    let dark = 0;
    for (let y = y0; y < y1; y++) dark += Number(black(x, y));
    return dark >= (y1 - y0) * 0.9;
  };
  while (y0 < Math.floor(h * 0.25) && row(y0)) y0++;
  while (h - y1 < Math.floor(h * 0.25) && row(y1 - 1)) y1--;
  while (x0 < Math.floor(w * 0.25) && col(x0)) x0++;
  while (w - x1 < Math.floor(w * 0.25) && col(x1 - 1)) x1--;
  return { x0, y0, x1, y1 };
}

const contains = (points: readonly [number, number][], x: number, y: number) => {
  let inside = false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as [number, number],
      b = points[(i + 1) % points.length] as [number, number];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
};

/** Sample exactly the same mitered segment bands drawn by the editor. */
export function samplePath(
  frame: Frame,
  path: Path,
  count: number,
  tuning: Setup["tuning"],
): Rgb[] {
  const rect = contentRect(frame);
  const n = Math.max(1, Math.min(100, count));
  const w = rect.x1 - rect.x0,
    h = rect.y1 - rect.y0;
  const placed = resolvePath(path, w / Math.max(1, h));
  const points = placed.points.map(
    ([x, y]) =>
      [rect.x0 + Math.max(0, Math.min(1, x)) * w, rect.y0 + Math.max(0, Math.min(1, y)) * h] as [
        number,
        number,
      ],
  );
  const regions = bandRegions(points, path.closed, Math.max(path.width * h, 1.42), n);
  const sums = Array.from({ length: n }, () => ({
    r: 0,
    g: 0,
    b: 0,
    weight: 0,
    value: 0,
    weightedValue: 0,
    pixels: 0,
  }));
  const add = (segment: number, x: number, y: number) => {
    const sum = sums[segment];
    if (!sum) return;
    const i = (y * frame.width + x) * 4;
    const r = frame.bgra[i + 2] ?? 0,
      g = frame.bgra[i + 1] ?? 0,
      b = frame.bgra[i] ?? 0;
    const hi = Math.max(r, g, b),
      lo = Math.min(r, g, b),
      v = hi / 255;
    const weight = hi === 0 ? 0 : v * v + 2 * ((hi - lo) / hi) * v;
    sum.r += (linear[r] ?? 0) * weight;
    sum.g += (linear[g] ?? 0) * weight;
    sum.b += (linear[b] ?? 0) * weight;
    sum.weight += weight;
    sum.value += linear[hi] ?? 0;
    sum.weightedValue += (linear[hi] ?? 0) * weight;
    sum.pixels++;
  };
  for (let y = rect.y0; y < rect.y1; y++)
    for (let x = rect.x0; x < rect.x1; x++) {
      const region = regions.find((r) =>
        contains(r.points as [number, number][], x + 0.5, y + 0.5),
      );
      if (!region) continue;
      add(region.segment, x, y);
    }
  // A short segment may cover no pixel centers. Match the desktop sampler by
  // taking the pixel beneath its midpoint so every segment has a color.
  const halfSegments = splitPath(points, path.closed, n * 2);
  for (let segment = 0; segment < n; segment++) {
    if (sums[segment]?.pixels) continue;
    const midpoint = halfSegments[segment * 2]?.at(-1);
    if (!midpoint) continue;
    const x = Math.max(0, Math.min(frame.width - 1, Math.floor(midpoint[0])));
    const y = Math.max(0, Math.min(frame.height - 1, Math.floor(midpoint[1])));
    add(segment, x, y);
  }
  return sums.map((s) => {
    if (!s.pixels || !s.weight) return [0, 0, 0];
    const c = [srgb(s.r / s.weight), srgb(s.g / s.weight), srgb(s.b / s.weight)];
    const peak = Math.max(...c);
    if (!peak) return [0, 0, 0];
    const target = srgb((0.7 * s.value) / s.pixels + (0.3 * s.weightedValue) / s.weight);
    return c.map((v) =>
      byte(
        Math.max(0, target - (target - (v * target) / peak) * tuning.saturation) *
          tuning.brightness *
          255,
      ),
    ) as Rgb;
  });
}

export function calibrate(
  color: Rgb,
  calibration: Record<string, string | number> | undefined,
): Rgb {
  if (!calibration) return color;
  const gamma =
    typeof calibration.gamma === "number" && calibration.gamma > 0 ? calibration.gamma : 1;
  const v = color.map((c) => (c / 255) ** gamma);
  const order = [0, 1, 2].sort((a, b) => (v[b] ?? 0) - (v[a] ?? 0));
  const [hi, mid, lo] = order as [number, number, number];
  const standard: Record<string, string> = {
    white: "#ffffff",
    red: "#ff0000",
    green: "#00ff00",
    blue: "#0000ff",
    yellow: "#ffff00",
    cyan: "#00ffff",
    magenta: "#ff00ff",
  };
  const corner = (name: string) =>
    rgb(
      typeof calibration[name] === "string"
        ? (calibration[name] as string)
        : (standard[name] as string),
    );
  const primary = corner(["red", "green", "blue"][hi] as string);
  const secondary = corner(
    ({ 1: "yellow", 2: "magenta", 3: "cyan" } as Record<number, string>)[hi + mid] as string,
  );
  const white = corner("white");
  const weights: Rgb = [(v[hi] ?? 0) - (v[mid] ?? 0), (v[mid] ?? 0) - (v[lo] ?? 0), v[lo] ?? 0];
  return [0, 1, 2].map((i) =>
    byte(
      weights[0] * (primary[i] ?? 0) +
        weights[1] * (secondary[i] ?? 0) +
        weights[2] * (white[i] ?? 0),
    ),
  ) as Rgb;
}

export function scale(color: Rgb, multiplier: number): Rgb {
  const peak = Math.max(...color);
  const k = peak ? Math.min(Math.max(multiplier, 0), 255 / peak) : 0;
  return color.map((v) => byte(v * k)) as Rgb;
}
