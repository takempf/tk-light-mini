/**
 * Zoom and pan for the artboard: the screen, drawn inside a bigger viewport.
 * Zoom 1 fits the screen in the viewport with `PAD` around it.
 */

type Pt = [number, number];

export interface View {
  /** 1 = fit. */
  zoom: number;
  /** The screen spot (fractions) in the middle of the viewport. */
  cx: number;
  cy: number;
}

/** Where the artboard is in the viewport, in pixels. */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FIT: View = { zoom: 1, cx: 0.5, cy: 0.5 };
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 8;
/** Room around the fitted screen, in pixels. */
export const PAD = 24;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keeps the zoom in range and some of the screen in view. */
export const clampView = (v: View): View => ({
  zoom: clamp(v.zoom, MIN_ZOOM, MAX_ZOOM),
  cx: clamp(v.cx, 0, 1),
  cy: clamp(v.cy, 0, 1),
});

/** The artboard's place in a `vw`x`vh` viewport, for a screen `aspect` wide. */
export function frameOf(v: View, vw: number, vh: number, aspect: number): Frame {
  const fit = Math.max(1, Math.min(vw - 2 * PAD, (vh - 2 * PAD) * aspect));
  const w = fit * v.zoom;
  const h = w / aspect;
  return { x: vw / 2 - v.cx * w, y: vh / 2 - v.cy * h, w, h };
}

/** Zoom by `factor`, keeping the spot under `at` (viewport pixels) where it is. */
export function zoomAt(
  v: View,
  factor: number,
  [mx, my]: Pt,
  vw: number,
  vh: number,
  aspect: number,
): View {
  const f = frameOf(v, vw, vh, aspect);
  const [fx, fy] = [(mx - f.x) / f.w, (my - f.y) / f.h];
  const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const { w, h } = frameOf({ ...v, zoom }, vw, vh, aspect);
  const [x, y] = [mx - fx * w, my - fy * h];
  return clampView({ zoom, cx: (vw / 2 - x) / w, cy: (vh / 2 - y) / h });
}

/** Pan by `[dx, dy]` viewport pixels. */
export const panBy = (v: View, [dx, dy]: Pt, f: Frame): View =>
  clampView({ ...v, cx: v.cx - dx / f.w, cy: v.cy - dy / f.h });
