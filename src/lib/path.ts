import type { LightPath } from "./types";

type Pt = [number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const clampPoint = ([x, y]: Pt): Pt => [clamp01(x), clamp01(y)];

/**
 * Split a path (in pixels) into `n` pieces of equal length, the way the engine
 * assigns segments. Each piece is its own polyline.
 */
export function splitPath(points: readonly Pt[], closed: boolean, n: number): Pt[][] {
  const pts = closed && points.length > 2 ? [...points, points[0] as Pt] : [...points];
  if (pts.length < 2 || n < 1) return [];
  const lens = [0];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1] as Pt, pts[i] as Pt];
    lens.push((lens[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = lens[lens.length - 1] as number;
  if (total <= 0) return [];
  const at = (d: number): Pt => {
    for (let i = 1; i < pts.length; i++) {
      const end = lens[i] as number;
      if (end >= d) {
        const start = lens[i - 1] as number;
        const u = end > start ? (d - start) / (end - start) : 0;
        const [a, b] = [pts[i - 1] as Pt, pts[i] as Pt];
        return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      }
    }
    return pts[pts.length - 1] as Pt;
  };
  return Array.from({ length: n }, (_, s) => {
    const [from, to] = [(s / n) * total, ((s + 1) / n) * total];
    const inner = pts.filter((_, i) => (lens[i] as number) > from && (lens[i] as number) < to);
    return [at(from), ...inner, at(to)];
  });
}

/**
 * A closed loop just inside the screen edges, `width` thick, starting at the
 * bottom right and going up the right side.
 */
export function edgeLoop(aspect: number, width: number): LightPath {
  const iy = width / 2;
  const ix = iy / aspect;
  return {
    points: [
      [1 - ix, 1 - iy],
      [1 - ix, iy],
      [ix, iy],
      [ix, 1 - iy],
    ],
    width,
    closed: true,
  };
}

/** The same path, run the other way. A closed loop keeps its start. */
export function reversePath(p: LightPath): LightPath {
  const [first, ...rest] = p.points;
  const points = p.closed && first ? [first, ...rest.reverse()] : [...p.points].reverse();
  return { ...p, points };
}
