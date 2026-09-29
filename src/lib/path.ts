import type { Fit, LightPath } from "./types";

type Pt = [number, number];

interface DirectionMark {
  triangle: [Pt, Pt, Pt];
  tail: [Pt, Pt];
}

/** Short arrows alternate sides along an ordered path, in screen pixels. */
export function directionMarks(points: readonly Pt[], closed: boolean): DirectionMark[] {
  const route = closed && points.length > 2 ? [...points, points[0] as Pt] : points;
  const legs = route.slice(1).map((to, i) => {
    const from = route[i] as Pt;
    return { from, to, length: Math.hypot(to[0] - from[0], to[1] - from[1]) };
  });
  const total = legs.reduce((length, leg) => length + leg.length, 0);
  if (total < 20) return [];
  const count = Math.max(1, Math.round(total / 260));
  const side = 8;
  const tip = side / Math.sqrt(3);
  const offset = 12;
  const marks: DirectionMark[] = [];
  for (let i = 0; i < count; i++) {
    let remaining = (total * (i + 0.5)) / count;
    for (const { from, to, length } of legs) {
      if (length < 1) continue;
      if (remaining > length) {
        remaining -= length;
        continue;
      }
      // Keep the triangle off vertices, especially on closed rectangular paths.
      const inset = Math.min(11, length / 2);
      const along = Math.min(Math.max(remaining, inset), length - inset);
      const dx = (to[0] - from[0]) / length;
      const dy = (to[1] - from[1]) / length;
      const x = from[0] + dx * along;
      const y = from[1] + dy * along;
      const base = -tip / 2;
      const sign = i % 2 === 0 ? -1 : 1;
      const cx = x - dy * offset * sign;
      const cy = y + dx * offset * sign;
      marks.push({
        triangle: [
          [cx + dx * tip, cy + dy * tip],
          [cx + dx * base - dy * (side / 2), cy + dy * base + dx * (side / 2)],
          [cx + dx * base + dy * (side / 2), cy + dy * base - dx * (side / 2)],
        ],
        tail: [
          [cx + dx * (base - 7), cy + dy * (base - 7)],
          [cx + dx * base, cy + dy * base],
        ],
      });
      break;
    }
  }
  return marks;
}

/** Offset to the joined edge at each vertex; limit sharp turns to four half-widths. */
export function bandOffsets(points: readonly Pt[], closed: boolean, r: number): Pt[] {
  const n = points.length;
  const loop = closed && n > 2;
  const normal = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    return length > 0 ? [-dy / length, dx / length] : [0, 0];
  };
  return points.map((p, i) => {
    const before = loop || i > 0 ? normal(points[(i + n - 1) % n] as Pt, p) : undefined;
    const after = loop || i < n - 1 ? normal(p, points[(i + 1) % n] as Pt) : undefined;
    const a = before ?? after ?? [0, 1];
    const b = after ?? before ?? [0, 1];
    const sum: Pt = [a[0] + b[0], a[1] + b[1]];
    const length = Math.hypot(...sum);
    if (length < 1e-6) return [b[0] * r, b[1] * r];
    const unit: Pt = [sum[0] / length, sum[1] / length];
    const size = Math.min(r / Math.max(unit[0] * b[0] + unit[1] * b[1], 1e-6), 4 * r);
    return [unit[0] * size, unit[1] * size];
  });
}

/** Filled segment regions. Joined edges share a diagonal across each corner. */
export function bandRegions(points: readonly Pt[], closed: boolean, width: number, count: number) {
  points = points.filter(
    (p, i) => i === 0 || p[0] !== points[i - 1]?.[0] || p[1] !== points[i - 1]?.[1],
  );
  if (
    closed &&
    points.length > 1 &&
    points[0]?.[0] === points.at(-1)?.[0] &&
    points[0]?.[1] === points.at(-1)?.[1]
  ) {
    points = points.slice(0, -1);
  }
  const offsets = bandOffsets(points, closed, width / 2);
  const legs = closed && points.length > 2 ? points.length : points.length - 1;
  const lengths = Array.from({ length: Math.max(0, legs) }, (_, i) => {
    const a = points[i] as Pt,
      b = points[(i + 1) % points.length] as Pt;
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  const total = lengths.reduce((a, b) => a + b, 0);
  const regions: { segment: number; points: Pt[] }[] = [];
  let start = 0;
  lengths.forEach((length, i) => {
    const j = (i + 1) % points.length;
    const a = points[i] as Pt,
      b = points[j] as Pt;
    const oa = offsets[i] as Pt,
      ob = offsets[j] as Pt;
    const edge = (t: number, side: number): Pt => [
      a[0] + (b[0] - a[0]) * t + side * (oa[0] + (ob[0] - oa[0]) * t),
      a[1] + (b[1] - a[1]) * t + side * (oa[1] + (ob[1] - oa[1]) * t),
    ];
    for (let segment = 0; segment < count && length > 0; segment++) {
      const from = Math.max(start, (segment * total) / count);
      const to = Math.min(start + length, ((segment + 1) * total) / count);
      if (to <= from) continue;
      const lo = (from - start) / length,
        hi = (to - start) / length;
      regions.push({ segment, points: [edge(lo, 1), edge(hi, 1), edge(hi, -1), edge(lo, -1)] });
    }
    start += length;
  });
  return regions;
}

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
 * bottom right and going up the right side. It fits the screen both ways, so it
 * stays flush when the thickness or the screen changes.
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
    fit: { x: "fit", y: "fit" },
  };
}

/** The same path, run the other way. A closed loop keeps its start. */
export function reversePath(p: LightPath): LightPath {
  const [first, ...rest] = p.points;
  const points = p.closed && first ? [first, ...rest.reverse()] : [...p.points].reverse();
  return { ...p, points };
}

/** Default path: from the left edge to the right edge, halfway down the screen. */
export const linePath = (width = 0.12): LightPath => ({
  points: [
    [0, 0.5],
    [1, 0.5],
  ],
  width,
  closed: false,
});

/** The old screen zones, as paths. For moving saved lights over. */
export type OldZone = "top" | "left" | "bottom" | "right" | "all" | "center";

/**
 * A path that samples about what an old zone did: a band `width` thick along
 * an edge, or a wide one over the middle.
 */
export function zonePath(zone: OldZone, aspect: number, width: number): LightPath {
  const iy = width / 2;
  const ix = iy / aspect;
  const line = (points: [number, number][], w = width): LightPath => ({
    points,
    width: w,
    closed: false,
  });
  switch (zone) {
    case "top":
      return line([
        [0, iy],
        [1, iy],
      ]);
    case "bottom":
      return line([
        [0, 1 - iy],
        [1, 1 - iy],
      ]);
    case "left":
      return line([
        [ix, 0],
        [ix, 1],
      ]);
    case "right":
      return line([
        [1 - ix, 0],
        [1 - ix, 1],
      ]);
    case "center":
      return line(
        [
          [0.35, 0.5],
          [0.65, 0.5],
        ],
        0.5,
      );
    case "all":
      return line(
        [
          [0.25, 0.5],
          [0.75, 0.5],
        ],
        1,
      );
  }
}

/** The path moved by `[dx, dy]`, held so every point stays on screen. */
export function movePath(p: LightPath, delta: Pt): LightPath {
  return movePoints(p, p.points.keys(), delta);
}

/** Points `indices` moved by `[dx, dy]` together, held so they all stay on screen. */
export function movePoints(p: LightPath, indices: Iterable<number>, [dx, dy]: Pt): LightPath {
  const only = new Set(indices);
  const moved = p.points.filter((_, i) => only.has(i));
  if (moved.length === 0) return p;
  const xs = moved.map(([x]) => x);
  const ys = moved.map(([, y]) => y);
  const mx = Math.min(Math.max(dx, -Math.min(...xs)), 1 - Math.max(...xs));
  const my = Math.min(Math.max(dy, -Math.min(...ys)), 1 - Math.max(...ys));
  return {
    ...p,
    points: p.points.map(([x, y], i) => (only.has(i) ? [x + mx, y + my] : [x, y])),
  };
}

/** The path mirrored across the middle of the screen. */
export function flipPath(p: LightPath, axis: "x" | "y"): LightPath {
  return {
    ...p,
    points: p.points.map(([x, y]) => (axis === "x" ? [1 - x, y] : [x, 1 - y])),
  };
}

/** A closed loop starting at point `i` instead, going the same way. */
export function startAt(p: LightPath, i: number): LightPath {
  if (i <= 0 || i >= p.points.length) return p;
  return { ...p, points: [...p.points.slice(i), ...p.points.slice(0, i)] };
}

/** The path without points `indices`. */
export function removePoints(p: LightPath, indices: Iterable<number>): LightPath {
  const drop = new Set(indices);
  return { ...p, points: p.points.filter((_, i) => !drop.has(i)) };
}

/** Indices of the points inside the box between `a` and `b`. */
export function pointsIn(p: LightPath, a: Pt, b: Pt): number[] {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return p.points.flatMap(([x, y], i) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 ? [i] : []));
}

/**
 * The leg of the path nearest `p` (screen fractions), on a `w`x`h` screen: the
 * index a point inserted there would get, and how far away it is in pixels.
 */
function nearestLeg(path: LightPath, p: Pt, w: number, h: number): { index: number; d: number } {
  const pts = path.points.map(([x, y]) => [x * w, y * h] as Pt);
  const n = pts.length;
  const [cx, cy] = [p[0] * w, p[1] * h];
  if (n === 1) {
    const [x, y] = pts[0] as Pt;
    return { index: 1, d: Math.hypot(cx - x, cy - y) };
  }
  let best = { index: -1, d: Number.POSITIVE_INFINITY };
  const edges = path.closed && n > 2 ? n : n - 1;
  for (let k = 0; k < edges; k++) {
    const [a, b] = [pts[k] as Pt, pts[(k + 1) % n] as Pt];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const len2 = dx * dx + dy * dy;
    const u = len2 > 0 ? Math.min(1, Math.max(0, ((cx - a[0]) * dx + (cy - a[1]) * dy) / len2)) : 0;
    const d = Math.hypot(cx - (a[0] + dx * u), cy - (a[1] + dy * u));
    if (d <= best.d) best = { index: k + 1, d };
  }
  return best;
}

/** How far `p` is from the path's band, in pixels. 0 or less = on it. */
export function distanceTo(path: LightPath, p: Pt, w: number, h: number): number {
  if (path.points.length === 0) return Number.POSITIVE_INFINITY;
  if (path.points.length === 1)
    return nearestLeg(path, p, w, h).d - Math.max((path.width * h) / 2, 1);
  const point: Pt = [p[0] * w, p[1] * h];
  const regions = bandRegions(
    path.points.map(([x, y]) => [x * w, y * h]),
    path.closed,
    Math.max(path.width * h, 2),
    1,
  );
  let distance = Number.POSITIVE_INFINITY;
  for (const region of regions) {
    let inside = false;
    region.points.forEach((a, i) => {
      const b = region.points[(i + 1) % region.points.length] as Pt;
      if (
        a[1] > point[1] !== b[1] > point[1] &&
        point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
      distance = Math.min(
        distance,
        nearestLeg({ ...path, points: [a, b], closed: false }, point, 1, 1).d,
      );
    });
    if (inside) return 0;
  }
  return distance;
}

/**
 * Where a click at `p` (screen fractions) falls on the path: the index to insert
 * a new point at, or -1 when it's off the band. On a `w`x`h` screen.
 */
export function insertIndex(path: LightPath, p: Pt, w: number, h: number): number {
  if (path.points.length < 2) return -1;
  return distanceTo(path, p, w, h) <= 0 ? nearestLeg(path, p, w, h).index : -1;
}

/**
 * Where a path's name goes: halfway along an open path, or the middle of a
 * loop's bounds. Works in whatever units `points` are in.
 */
export function labelPoint(points: readonly Pt[], closed: boolean): Pt | undefined {
  if (points.length === 0) return undefined;
  if (!closed && points.length > 1) return splitPath(points, false, 2)[1]?.[0];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** Per axis, fitted = saved * k + b, in screen fractions. */
interface FitMap {
  kx: number;
  bx: number;
  ky: number;
  by: number;
}

/**
 * How far the band reaches past each point on each axis, for points `pts` and
 * half thickness `r`. Corners follow the mitered join. An open
 * path's ends are cut square: they reach only across the line, not along it.
 */
export function reach(pts: readonly Pt[], closed: boolean, r: number): Pt[] {
  return bandOffsets(pts, closed, r).map(([x, y]) => [Math.abs(x), Math.abs(y)]);
}

/** Per axis in screen heights: placed = saved * s + t. */
interface Scale {
  sx: number;
  tx: number;
  sy: number;
  ty: number;
}

/**
 * How a saved path maps onto a screen `aspect` wide (width over height), or
 * undefined when it stays where it is.
 */
function fitMap(p: LightPath, aspect: number): FitMap | undefined {
  const fx: Fit = p.fit?.x ?? "exact";
  const fy: Fit = p.fit?.y ?? "exact";
  if ((fx !== "fit" && fy !== "fit") || p.points.length === 0) return undefined;
  // Units of screen heights, so both axes measure the same.
  const from = p.aspect ?? aspect;
  const pts = p.points.map(([x, y]) => [x * from, y] as Pt);
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const r = Math.min(p.width / 2, aspect / 2, 0.5);

  /** The scale that puts the band's outline, reaching `ext` past each point, on the screen's edges. */
  const solve = (ext: Pt[]): Scale => {
    /** How far past the lowest and highest points the band reaches, on one axis. */
    const ends = (vs: number[], axis: 0 | 1, lo: number, hi: number) => {
      const past = (at: number) =>
        Math.max(...vs.flatMap((v, i) => (v === at ? [(ext[i] as Pt)[axis]] : [])));
      return [past(lo), past(hi)] as const;
    };
    const [l, rr] = ends(xs, 0, x0, x1);
    const [t, b] = ends(ys, 1, y0, y1);
    const sxFit = fx === "fit" && x1 > x0 ? (aspect - l - rr) / (x1 - x0) : undefined;
    const syFit = fy === "fit" && y1 > y0 ? (1 - t - b) / (y1 - y0) : undefined;
    // Auto follows the other axis's scale, about the shape's middle.
    const [mx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const cx = (mx / from) * aspect;
    const sx = sxFit ?? (fx === "auto" ? syFit : undefined);
    const sy = syFit ?? (fy === "auto" ? sxFit : undefined);
    return {
      sx: sx ?? aspect / from,
      tx: sxFit !== undefined ? l - sxFit * x0 : sx !== undefined ? cx - sx * mx : 0,
      sy: sy ?? 1,
      ty: syFit !== undefined ? t - syFit * y0 : sy !== undefined ? cy - sy * cy : 0,
    };
  };

  // Stretching one axis turns the ends, which moves their corners: solve again
  // with the ends as placed.
  let m = solve(reach(pts, p.closed, r));
  const placed = pts.map(([x, y]) => [x * m.sx + m.tx, y * m.sy + m.ty] as Pt);
  m = solve(reach(placed, p.closed, r));
  return { kx: (m.sx * from) / aspect, bx: m.tx / aspect, ky: m.sy, by: m.ty };
}

/**
 * The path as placed on a screen `aspect` wide (width over height), after its
 * fit. The saved path keeps its own shape; this is what's drawn and sampled.
 */
export function resolvePath(p: LightPath, aspect: number): LightPath {
  const m = fitMap(p, aspect);
  if (!m) return p;
  return {
    ...p,
    points: p.points.map(([x, y]) => [clamp01(x * m.kx + m.bx), clamp01(y * m.ky + m.by)]),
  };
}

/**
 * `edited`, a changed copy of `saved` as placed on a screen `aspect` wide, back
 * in `saved`'s own terms: the path to save.
 */
export function unresolvePath(edited: LightPath, saved: LightPath, aspect: number): LightPath {
  const m = fitMap(saved, aspect);
  if (!m) return edited;
  return {
    ...edited,
    aspect: saved.aspect ?? aspect,
    points: edited.points.map(([x, y]) => [(x - m.bx) / m.kx, (y - m.by) / m.ky]),
  };
}
