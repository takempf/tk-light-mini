type Pt = [number, number];

/** Guide lines to draw, in screen fractions. */
export interface Guides {
  x?: number;
  y?: number;
}

export interface SnapOptions {
  /** The point before this one. Shift locks the angle from it. */
  from?: Pt;
  /** Lock to 0, 45 or 90 degrees from `from`. */
  shift?: boolean;
  /** Snap to other points, the screen edges and its center. Default on. */
  guides?: boolean;
  /** Other points, in screen fractions. */
  targets: readonly Pt[];
  /** The screen's size on the page, in pixels. */
  w: number;
  h: number;
  /** Snap distance, in pixels. */
  tol: number;
}

/** Lines everything can snap to: the edges and the middle. */
const FRAME = [0, 0.5, 1];

/** The nearest of `lines` within `tol` of `v`, if any. */
function nearest(v: number, lines: readonly number[], tol: number): number | undefined {
  let best: number | undefined;
  let bestD = tol;
  for (const l of lines) {
    const d = Math.abs(l - v);
    if (d <= bestD) {
      best = l;
      bestD = d;
    }
  }
  return best;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Where a point placed or dragged to `p` (screen fractions) lands. Works in
 * pixels, so angles and distances aren't skewed by the screen's shape.
 */
export function snapPoint(p: Pt, o: SnapOptions): { point: Pt; guides: Guides } {
  const { w, h, tol } = o;
  const xs = o.guides === false ? [] : [...FRAME, ...o.targets.map(([x]) => x)].map((x) => x * w);
  const ys = o.guides === false ? [] : [...FRAME, ...o.targets.map(([, y]) => y)].map((y) => y * h);
  let [x, y] = [p[0] * w, p[1] * h];
  const guides: Guides = {};

  if (o.shift && o.from) {
    const [fx, fy] = [o.from[0] * w, o.from[1] * h];
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(y - fy, x - fx) / step) * step;
    const [ux, uy] = [
      Math.round(Math.cos(angle) * 1e9) / 1e9,
      Math.round(Math.sin(angle) * 1e9) / 1e9,
    ];
    const along = (x - fx) * ux + (y - fy) * uy;
    [x, y] = [fx + ux * along, fy + uy * along];
    // Slide along the locked line to the nearest guide it crosses.
    const gx = ux !== 0 ? nearest(x, xs, tol) : undefined;
    const gy = uy !== 0 ? nearest(y, ys, tol) : undefined;
    const useX = gx !== undefined && (gy === undefined || Math.abs(gx - x) <= Math.abs(gy - y));
    if (useX && gx !== undefined) {
      [x, y] = [gx, fy + ((gx - fx) * uy) / ux];
      guides.x = gx / w;
    } else if (gy !== undefined) {
      [x, y] = [fx + ((gy - fy) * ux) / uy, gy];
      guides.y = gy / h;
    }
  } else {
    const gx = nearest(x, xs, tol);
    const gy = nearest(y, ys, tol);
    if (gx !== undefined) {
      x = gx;
      guides.x = gx / w;
    }
    if (gy !== undefined) {
      y = gy;
      guides.y = gy / h;
    }
  }
  return { point: [clamp01(x / w), clamp01(y / h)], guides };
}

export interface MoveOptions {
  /** Lock the move to horizontal or vertical. */
  shift?: boolean;
  /** Snap to other points, the screen edges and its center. Default on. */
  guides?: boolean;
  /** Points to snap to, not the ones being moved. */
  targets: readonly Pt[];
  w: number;
  h: number;
  tol: number;
}

/**
 * How far points `moved` really move when dragged by `delta` (screen
 * fractions): Shift keeps it level or upright, and the nearest point to a guide
 * on each axis pulls the whole group onto it.
 */
export function snapMove(
  moved: readonly Pt[],
  delta: Pt,
  o: MoveOptions,
): { delta: Pt; guides: Guides } {
  const { w, h, tol } = o;
  let [dx, dy] = [delta[0] * w, delta[1] * h];
  if (o.shift) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  const guides: Guides = {};
  if (o.guides !== false) {
    const xs = [...FRAME, ...o.targets.map(([x]) => x)].map((x) => x * w);
    const ys = [...FRAME, ...o.targets.map(([, y]) => y)].map((y) => y * h);
    /** The smallest pull that puts one of `vs` on a line, if any is close. */
    const pull = (vs: number[], lines: number[]) => {
      let best: { by: number; at: number } | undefined;
      for (const v of vs) {
        const l = nearest(v, lines, tol);
        if (l !== undefined && (!best || Math.abs(l - v) < Math.abs(best.by))) {
          best = { by: l - v, at: l };
        }
      }
      return best;
    };
    // A locked axis stays put.
    const px =
      !o.shift || dx !== 0
        ? pull(
            moved.map(([x]) => x * w + dx),
            xs,
          )
        : undefined;
    const py =
      !o.shift || dy !== 0
        ? pull(
            moved.map(([, y]) => y * h + dy),
            ys,
          )
        : undefined;
    if (px) {
      dx += px.by;
      guides.x = px.at / w;
    }
    if (py) {
      dy += py.by;
      guides.y = py.at / h;
    }
  }
  return { delta: [dx / w, dy / h], guides };
}
