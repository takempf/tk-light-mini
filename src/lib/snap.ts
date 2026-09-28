type Pt = [number, number];

/** Guide lines to draw, in screen fractions. */
export interface Guides {
  x?: number;
  y?: number;
}

/** What to snap to, shared by points and moves. */
interface SnapTargets {
  /** Snap at all. Default on. */
  guides?: boolean;
  /** Other points, in screen fractions. */
  targets: readonly Pt[];
  /** More lines to snap to, in screen fractions: other bands' edges. */
  lines?: { x?: readonly number[]; y?: readonly number[] };
  /**
   * Half the thickness of the band being placed, in pixels. Its edges snap as
   * well as its middle, so a band can sit flush with the screen's edge.
   */
  edge?: number;
  /** The screen's size on the page, in pixels. */
  w: number;
  h: number;
  /** Snap distance, in pixels. */
  tol: number;
}

export interface SnapOptions extends SnapTargets {
  /** The point before this one. Shift locks the angle from it. */
  from?: Pt;
  /** Lock to 0, 45 or 90 degrees from `from`. */
  shift?: boolean;
}

export interface MoveOptions extends SnapTargets {
  /** Lock the move to horizontal or vertical. */
  shift?: boolean;
}

/** Lines everything can snap to: the edges and the middle. */
const FRAME = [0, 0.5, 1];

/** A snap: move by `by` pixels to put the middle or an edge on line `at`. */
interface Pull {
  by: number;
  at: number;
}

/** The nearest pull within `tol` that puts `v`, or `v` ± `edge`, on one of `lines`. */
function pullTo(v: number, lines: readonly number[], tol: number, edge: number): Pull | undefined {
  let best: Pull | undefined;
  const offsets = edge > 0 ? [0, -edge, edge] : [0];
  for (const l of lines) {
    for (const o of offsets) {
      const by = l - (v + o);
      if (Math.abs(by) <= tol && (!best || Math.abs(by) < Math.abs(best.by))) {
        best = { by, at: l };
      }
    }
  }
  return best;
}

/** The lines to snap to on each axis, in pixels. */
function axes(o: SnapTargets): { xs: number[]; ys: number[] } {
  if (o.guides === false) return { xs: [], ys: [] };
  return {
    xs: [...FRAME, ...o.targets.map(([x]) => x), ...(o.lines?.x ?? [])].map((x) => x * o.w),
    ys: [...FRAME, ...o.targets.map(([, y]) => y), ...(o.lines?.y ?? [])].map((y) => y * o.h),
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Where a point placed or dragged to `p` (screen fractions) lands. Works in
 * pixels, so angles and distances aren't skewed by the screen's shape.
 */
export function snapPoint(p: Pt, o: SnapOptions): { point: Pt; guides: Guides } {
  const { w, h, tol } = o;
  const edge = o.edge ?? 0;
  const { xs, ys } = axes(o);
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
    const gx = ux !== 0 ? pullTo(x, xs, tol, edge) : undefined;
    const gy = uy !== 0 ? pullTo(y, ys, tol, edge) : undefined;
    const useX = gx && (!gy || Math.abs(gx.by) <= Math.abs(gy.by));
    if (useX) {
      x += gx.by;
      y = fy + ((x - fx) * uy) / ux;
      guides.x = gx.at / w;
    } else if (gy) {
      y += gy.by;
      x = fx + ((y - fy) * ux) / uy;
      guides.y = gy.at / h;
    }
  } else {
    const gx = pullTo(x, xs, tol, edge);
    const gy = pullTo(y, ys, tol, edge);
    if (gx) {
      x += gx.by;
      guides.x = gx.at / w;
    }
    if (gy) {
      y += gy.by;
      guides.y = gy.at / h;
    }
  }
  return { point: [clamp01(x / w), clamp01(y / h)], guides };
}

/**
 * How far points `moved` really move when dragged by `delta` (screen
 * fractions): Shift keeps it level or upright, and the nearest point (or band
 * edge) to a guide on each axis pulls the whole group onto it.
 */
export function snapMove(
  moved: readonly Pt[],
  delta: Pt,
  o: MoveOptions,
): { delta: Pt; guides: Guides } {
  const { w, h, tol } = o;
  const edge = o.edge ?? 0;
  let [dx, dy] = [delta[0] * w, delta[1] * h];
  if (o.shift) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  const { xs, ys } = axes(o);
  /** The smallest pull that puts one of `vs` on a line, if any is close. */
  const pull = (vs: number[], lines: number[]) => {
    let best: Pull | undefined;
    for (const v of vs) {
      const p = pullTo(v, lines, tol, edge);
      if (p && (!best || Math.abs(p.by) < Math.abs(best.by))) best = p;
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
  const guides: Guides = {};
  if (px) {
    dx += px.by;
    guides.x = px.at / w;
  }
  if (py) {
    dy += py.by;
    guides.y = py.at / h;
  }
  return { delta: [dx / w, dy / h], guides };
}
