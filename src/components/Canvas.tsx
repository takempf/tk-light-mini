import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { sectionStarts, sectionsOf, segmentSources } from "../lib/lights";
import { useSegmentCss } from "../lib/live";
import {
  bandRegions,
  clampPoint,
  directionMarks,
  distanceTo,
  insertIndex,
  movePath,
  movePoints,
  pointsIn,
  reach,
  removePoints,
  resolvePath,
  splitPath,
  unresolvePath,
} from "../lib/path";
import { type Guides, snapMove, snapPoint } from "../lib/snap";
import type { AddedDevice, LightPath, Source } from "../lib/types";
import { FIT, frameOf, panBy, type View, zoomAt } from "../lib/view";
import { useScreen, useScreenAspect, useStore } from "../store";
import { Button, Popover } from "../ui";
import { BandFill } from "./BandFill";
import { ShapeOutline } from "./ShapeOutline";

type Pt = [number, number];

/** Snap distance, in screen pixels. */
const SNAP = 6;
/** Extra reach around a band for clicks, in screen pixels. */
const REACH = 4;
const HANDLE = 6;
/** A press that moves less than this is a click, in screen pixels. */
const CLICK = 3;
/** Zoom per button press or key. */
const ZOOM_STEP = 1.25;

/** A placed section, ready to draw. */
interface Placed {
  key: string;
  device: AddedDevice;
  section: number;
  /** As placed on screen, after its fit. */
  path: LightPath;
  /** As saved: edits map back to this. */
  saved: LightPath;
  /** Its first segment, in the light. */
  start: number;
  /** One per segment in it. */
  sources: Source[];
}

/** Every placed section, fitted to a screen `aspect` wide. */
function placedSections(devices: readonly AddedDevice[], aspect: number): Placed[] {
  return devices.flatMap((device) => {
    const sections = sectionsOf(device);
    const starts = sectionStarts(sections);
    const sources = segmentSources(device);
    return sections.flatMap((s, k) => {
      const start = starts[k] as number;
      if (!s.path) return [];
      return [
        {
          key: `${device.id}-${k}`,
          device,
          section: k,
          path: resolvePath(s.path, aspect),
          saved: s.path,
          start,
          sources: sources.slice(start, start + s.count),
        },
      ];
    });
  });
}

/**
 * `placedSections`, keeping each section as it was while its light is
 * unchanged, so its shape doesn't re-render when another light is edited.
 */
function usePlaced(devices: readonly AddedDevice[], aspect: number): Placed[] {
  const prev = useRef<{ aspect: number; placed: Placed[] }>({ aspect, placed: [] });
  return useMemo(() => {
    const old =
      prev.current.aspect === aspect ? new Map(prev.current.placed.map((p) => [p.key, p])) : null;
    const placed = placedSections(devices, aspect).map((p) => {
      const o = old?.get(p.key);
      return o && o.device === p.device ? o : p;
    });
    prev.current = { aspect, placed };
    return placed;
  }, [devices, aspect]);
}

/** The element's size in pixels, kept up to date. */
function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Keys typed into a field belong to the field. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** The engine's small frame (the screen or a scene), scaled up with crisp pixels. */
function ScreenImage() {
  const image = useScreen((s) => s.image);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = image && ref.current?.getContext("2d");
    if (!image || !ctx) return;
    ctx.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  }, [image]);
  if (!image) return <div className="canvas-waiting">Waiting for the canvas…</div>;
  return <canvas ref={ref} width={image.width} height={image.height} />;
}

const line = (pts: readonly Pt[]) => pts.map((p) => p.join(",")).join(" ");

/**
 * A section's segment colors over its band. Only a filled band shows them, so
 * only it follows the live colors; the rest keep the last ones for fading out.
 */
function ShapeFill({
  p,
  regions,
  live,
}: {
  p: Placed;
  regions: ReturnType<typeof bandRegions>;
  live: boolean;
}) {
  const colors = useSegmentCss(p.device.ip, p.start, p.sources, live);
  return <BandFill regions={regions} colors={colors} className="shape-piece" />;
}

/** A section's band, in its segments' colors. */
const Shape = memo(function Shape({
  p,
  w,
  h,
  selected,
  hovered,
  visible,
  filled,
}: {
  p: Placed;
  w: number;
  h: number;
  selected: boolean;
  hovered: boolean;
  visible: boolean;
  filled: boolean;
}) {
  const count = p.sources.length;
  const { px, band, regions, loop, pieces, direction } = useMemo(() => {
    const px = p.path.points.map(([x, y]) => [x * w, y * h] as Pt);
    const band = Math.max(p.path.width * h, 2);
    return {
      px,
      band,
      regions: bandRegions(px, p.path.closed, band, count),
      loop: p.path.closed && px.length > 2 ? [...px, px[0] as Pt] : px,
      pieces: splitPath(px, p.path.closed, count),
      direction: directionMarks(px, p.path.closed),
    };
  }, [p.path, w, h, count]);
  return (
    <g
      className="shape"
      data-selected={selected || undefined}
      data-hover={hovered || undefined}
      data-visible={visible || undefined}
      data-filled={filled || undefined}
      aria-hidden={!visible}
    >
      <ShapeFill p={p} regions={regions} live={filled} />
      <ShapeOutline points={px} closed={p.path.closed} width={band} />
      <g className="shape-details">
        {px.length > 1 && <polyline className="shape-path" points={line(loop)} />}
        {pieces.map((piece, i) => {
          const at = splitPath(piece, false, 2)[1]?.[0] ?? piece[0];
          return (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are ordered positions
              key={i}
              className="shape-segment"
              cx={at?.[0]}
              cy={at?.[1]}
              r={2.5}
            />
          );
        })}
      </g>
      {direction.length > 0 && (
        <g className="shape-direction">
          {direction.map((mark, i) => (
            <g
              // biome-ignore lint/suspicious/noArrayIndexKey: markers follow the path order
              key={i}
            >
              <line
                className="shape-direction-tail-halo"
                x1={mark.tail[0][0]}
                y1={mark.tail[0][1]}
                x2={mark.tail[1][0]}
                y2={mark.tail[1][1]}
              />
              <line
                className="shape-direction-tail"
                x1={mark.tail[0][0]}
                y1={mark.tail[0][1]}
                x2={mark.tail[1][0]}
                y2={mark.tail[1][1]}
              />
              <polygon points={line(mark.triangle)} />
            </g>
          ))}
        </g>
      )}
    </g>
  );
});

const SHORTCUTS: [string, string][] = [
  ["Click a band", "Select a light"],
  ["Drag a band", "Move it (Shift: straight across or up)"],
  ["Click a point", "Pick it"],
  ["Shift+click a point", "Add it to the picked points, or take it out"],
  ["Drag on empty space", "Pick the points in a box (Shift: add to them)"],
  ["Drag a point", "Move the picked points (Shift: 0/45/90°)"],
  ["Double-click the band", "Add a point there"],
  ["Ctrl+click", "Add a point after the last one"],
  ["Delete, right-click", "Remove points"],
  ["Arrows", "Nudge the picked points (Shift: further)"],
  ["Ctrl+A", "Pick every point"],
  ["Esc", "Unpick points, then the light"],
  ["Alt", "Hold to turn off snapping"],
  ["Wheel", "Zoom in or out at the pointer"],
  ["Space+drag, middle drag", "Pan"],
  ["Ctrl+=, Ctrl+−, Ctrl+0", "Zoom in, out, fit"],
  ["Ctrl+Z, Ctrl+Shift+Z", "Undo, redo"],
  [
    "While drawing",
    "Backspace: undo a point. Click the first point: close the loop. Double-click or Enter: done.",
  ],
];

/** Undo, redo, zoom, and the list of shortcuts. */
function Toolbar({
  zoom,
  onZoom,
  onFit,
}: {
  zoom: number;
  onZoom: (factor: number) => void;
  onFit: () => void;
}) {
  const canUndo = useStore((s) => s.past.length > 0 && !s.drawing);
  const canRedo = useStore((s) => s.future.length > 0 && !s.drawing);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  return (
    <div className="canvas-bar">
      <Button variant="ghost" size="sm" disabled={!canUndo} onClick={undo}>
        Undo
      </Button>
      <Button variant="ghost" size="sm" disabled={!canRedo} onClick={redo}>
        Redo
      </Button>
      <span className="canvas-bar-gap" />
      <Button variant="ghost" size="sm" aria-label="Zoom out" onClick={() => onZoom(1 / ZOOM_STEP)}>
        −
      </Button>
      <Button variant="ghost" size="sm" aria-label="Zoom to fit" onClick={onFit}>
        {Math.round(zoom * 100)}%
      </Button>
      <Button variant="ghost" size="sm" aria-label="Zoom in" onClick={() => onZoom(ZOOM_STEP)}>
        +
      </Button>
      <Popover.Root>
        <Popover.Trigger render={<Button variant="ghost" size="sm" />}>Shortcuts</Popover.Trigger>
        <Popover.Popup className="shortcuts" side="bottom" align="end">
          <Popover.Title>Placing lights</Popover.Title>
          <dl>
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys}>
                <dt>{keys}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </Popover.Popup>
      </Popover.Root>
    </div>
  );
}

type Drag =
  /** Moving the picked points; `grab` is the one under the pointer. */
  | { kind: "points"; grab: number; indices: number[]; from: Pt; orig: LightPath; saved: LightPath }
  | { kind: "move"; from: Pt; orig: LightPath; saved: LightPath }
  /** Picking points in a box, on top of `base`. */
  | { kind: "box"; from: Pt; to: Pt; base: number[] }
  /** Panning; `from` is in page pixels. */
  | { kind: "pan"; from: Pt; orig: View };

/**
 * The screen, with every placed light section on it. Click a band to select
 * it; drag it to move it, drag its points to reshape it.
 */
export function Canvas() {
  const devices = useStore((s) => s.devices);
  const selection = useStore((s) => s.selection);
  const hoveredLight = useStore((s) => s.hoveredLight);
  const hoveredSection = useStore((s) => s.hoveredSection);
  const drawing = useStore((s) => s.drawing);
  const points = useStore((s) => s.points);
  const select = useStore((s) => s.select);
  const setPoints = useStore((s) => s.setPoints);
  const setDrawing = useStore((s) => s.setDrawing);
  const setSectionPath = useStore((s) => s.setSectionPath);
  const breakUndo = useStore((s) => s.breakUndo);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  // Only the shape: the picture itself changes up to 10 times a second.
  const aspect = useScreenAspect();
  const vp = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const { w: vw, h: vh } = useSize(vp);
  const [view, setView] = useState<View>(FIT);
  const fills = useStore((s) => s.fills);
  const showFill = selection ? (fills[selection.id] ?? true) : false;
  // The artboard: the screen's place in the viewport. `w`x`h` is its size.
  const frame = frameOf(view, vw, vh, aspect);
  const { w, h } = frame;
  /** Space is held: drags pan. */
  const [space, setSpace] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<Guides>({});
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  /** A handle is being pressed, so its focus isn't from the keyboard. */
  const pressing = useRef(false);

  const placed = usePlaced(devices, aspect);
  const isHovered = (p: Placed) =>
    hoveredLight !== null
      ? p.device.id === hoveredLight && (hoveredSection === null || p.section === hoveredSection)
      : p.key === hover;
  // SVG paints later siblings on top; retain keys so hover doesn't restart fades.
  const ordered = [...placed].sort((a, b) => Number(isHovered(a)) - Number(isHovered(b)));
  const visible = placed.filter(
    (p) =>
      p.device.id === selection?.id ||
      (p.device.id === hoveredLight && (hoveredSection === null || p.section === hoveredSection)),
  );
  const current = placed.find(
    (p) => p.device.id === selection?.id && p.section === selection.section,
  );
  // In drawing mode the selected section may still have no points.
  const editing: LightPath | undefined =
    current?.path ??
    (drawing && selection?.section != null
      ? { points: [], width: 0.12, closed: false }
      : undefined);
  const picked = points.filter((i) => i < (editing?.points.length ?? 0));
  /**
   * Save an edit made on screen. It maps back into the saved path as it was
   * when the drag started, so a fitted path doesn't drift as it's dragged.
   */
  const update = (path: LightPath) => {
    if (!selection || selection.section === null) return;
    const base = drag?.kind === "points" || drag?.kind === "move" ? drag.saved : current?.saved;
    setSectionPath(
      selection.id,
      selection.section,
      base ? unresolvePath(path, base, aspect) : path,
    );
  };

  /** Zoom by `factor` at `at` (viewport pixels), or at the middle. */
  const zoom = (factor: number, at: Pt = [vw / 2, vh / 2]) =>
    setView((v) => zoomAt(v, factor, at, vw, vh, aspect));

  // Latest values for the window and wheel handlers.
  const live = useRef({ editing, picked, drawing, update, w, h, zoom });
  live.current = { editing, picked, drawing, update, w, h, zoom };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Calibration covers the canvas, and has its own keys.
      if (typing(e.target) || useStore.getState().calibrating) return;
      const { editing, picked, drawing, update, w, h, zoom } = live.current;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === " ") {
        e.preventDefault();
        setSpace(true);
        return;
      }
      if (ctrl && (key === "=" || key === "+")) {
        e.preventDefault();
        zoom(ZOOM_STEP);
        return;
      }
      if (ctrl && key === "-") {
        e.preventDefault();
        zoom(1 / ZOOM_STEP);
        return;
      }
      if (ctrl && key === "0") {
        e.preventDefault();
        setView(FIT);
        return;
      }
      if (drawing) {
        if (e.key === "Enter" || e.key === "Escape") {
          setDrawing(false);
          setCursor(null);
          setGuides({});
        } else if ((e.key === "Backspace" || (ctrl && key === "z")) && editing) {
          e.preventDefault();
          update({ ...editing, points: editing.points.slice(0, -1) });
        }
        return;
      }
      if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      if (ctrl && key === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (!editing) {
        if (e.key === "Escape") select(null);
        return;
      }
      if (ctrl && key === "a") {
        e.preventDefault();
        setPoints(editing.points.map((_, i) => i));
      } else if ((e.key === "Delete" || e.key === "Backspace") && picked.length) {
        e.preventDefault();
        breakUndo();
        update(removePoints(editing, picked));
        setPoints([]);
      } else if (e.key === "Escape") {
        if (picked.length) setPoints([]);
        else select(null);
      } else if (e.key.startsWith("Arrow") && picked.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const d: Record<string, Pt> = {
          ArrowLeft: [-step / w, 0],
          ArrowRight: [step / w, 0],
          ArrowUp: [0, -step / h],
          ArrowDown: [0, step / h],
        };
        update(movePoints(editing, picked, d[e.key] ?? [0, 0]));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpace(false);
    };
    const onBlur = () => setSpace(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [setDrawing, setPoints, select, breakUndo, undo, redo]);

  // The wheel zooms at the pointer. Not passive, so the page doesn't scroll.
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const lines = e.deltaMode === 1 ? 16 : 1;
      live.current.zoom(Math.exp(-e.deltaY * lines * 0.0015), [
        e.clientX - r.left,
        e.clientY - r.top,
      ]);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** The screen spot under the pointer, in fractions. */
  const at = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const r = (svg.current as SVGSVGElement).getBoundingClientRect();
    return clampPoint([(e.clientX - r.left - frame.x) / w, (e.clientY - r.top - frame.y) / h]);
  };
  /** Every point on screen but `skip` of the edited path, to snap to. */
  const targets = (skip: readonly number[]): Pt[] => [
    ...placed.filter((p) => p !== current).flatMap((p) => p.path.points),
    ...(editing?.points.filter((_, i) => !skip.includes(i)) ?? []),
  ];
  /** How far a band reaches past each of its points, in pixels. */
  const reachOf = (path: LightPath): Pt[] =>
    reach(
      path.points.map(([x, y]) => [x * w, y * h] as Pt),
      path.closed,
      (path.width * h) / 2,
    );
  /** Other bands' edges, to line up with. */
  const others = placed.filter((p) => p !== current);
  const edges = others.map((p) => ({ p, r: reachOf(p.path) }));
  const lines = {
    x: edges.flatMap(({ p, r }) =>
      p.path.points.flatMap(([x], i) => {
        const e = (r[i] as Pt)[0] / w;
        return [x - e, x + e];
      }),
    ),
    y: edges.flatMap(({ p, r }) =>
      p.path.points.flatMap(([, y], i) => {
        const e = (r[i] as Pt)[1] / h;
        return [y - e, y + e];
      }),
    ),
  };
  /** How far a new end at the pointer would reach: square, across the line from `from`. */
  const endReach = (e: React.PointerEvent, from: Pt | undefined): Pt => {
    const r = ((editing?.width ?? 0) * h) / 2;
    if (!from) return [r, r];
    const p = at(e);
    return reach(
      [
        [from[0] * w, from[1] * h],
        [p[0] * w, p[1] * h],
      ],
      false,
      r,
    )[1] as Pt;
  };
  const snap = (e: React.PointerEvent, from: Pt | undefined, skip: readonly number[], edge: Pt) => {
    const r = snapPoint(at(e), {
      from,
      shift: e.shiftKey,
      guides: !e.altKey,
      targets: targets(skip),
      lines,
      edge,
      w,
      h,
      tol: SNAP,
    });
    setGuides(r.guides);
    return r.point;
  };
  /** The point a dragged one lines up with under Shift. */
  const neighbor = (path: LightPath, i: number): Pt | undefined => {
    const n = path.points.length;
    if (i > 0) return path.points[i - 1];
    return path.closed && n > 2 ? path.points[n - 1] : path.points[1];
  };
  const hitTest = (p: Pt) => {
    const hit = (x: Placed) => distanceTo(x.path, p, w, h) <= REACH;
    return current && hit(current) ? current : [...visible].reverse().find(hit);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Middle button or Space: pan.
    if (e.button === 1 || (e.button === 0 && space)) {
      e.preventDefault();
      svg.current?.setPointerCapture(e.pointerId);
      setDrag({ kind: "pan", from: [e.clientX, e.clientY], orig: view });
      return;
    }
    if (e.button !== 0) return;
    const pts = editing?.points ?? [];
    const end = pts[pts.length - 1];
    if (drawing && editing) {
      update({ ...editing, points: [...pts, snap(e, end, [], endReach(e, end))] });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && editing) {
      breakUndo();
      update({ ...editing, points: [...pts, snap(e, end, [], endReach(e, end))] });
      setPoints([pts.length]);
      return;
    }
    const p = at(e);
    const target = hitTest(p);
    svg.current?.setPointerCapture(e.pointerId);
    if (target) {
      if (target !== current) select({ id: target.device.id, section: target.section });
      setDrag({ kind: "move", from: p, orig: target.path, saved: target.saved });
    } else if (editing) {
      setDrag({ kind: "box", from: p, to: p, base: e.shiftKey ? picked : [] });
    } else {
      select(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag?.kind === "pan") {
      const d: Pt = [e.clientX - drag.from[0], e.clientY - drag.from[1]];
      setView(panBy(drag.orig, d, frameOf(drag.orig, vw, vh, aspect)));
      return;
    }
    if (drawing && editing) {
      const end = editing.points[editing.points.length - 1];
      setCursor(snap(e, end, [], endReach(e, end)));
      return;
    }
    if (!drag) {
      const key = hitTest(at(e))?.key ?? null;
      if (key !== hover) setHover(key);
      return;
    }
    const p = at(e);
    const delta: Pt = [p[0] - drag.from[0], p[1] - drag.from[1]];
    if (drag.kind === "box") {
      setDrag({ ...drag, to: p });
    } else if (drag.kind === "points") {
      if (drag.indices.length === 1) {
        // One point: Shift keeps its leg at 0/45/90 degrees.
        const q = snap(
          e,
          neighbor(drag.orig, drag.grab),
          drag.indices,
          reachOf(drag.orig)[drag.grab] as Pt,
        );
        update({ ...drag.orig, points: drag.orig.points.map((o, i) => (i === drag.grab ? q : o)) });
      } else {
        const r = snapMove(
          drag.orig.points.filter((_, i) => drag.indices.includes(i)),
          delta,
          {
            shift: e.shiftKey,
            guides: !e.altKey,
            targets: targets(drag.indices),
            lines,
            edges: reachOf(drag.orig).filter((_, i) => drag.indices.includes(i)),
            w,
            h,
            tol: SNAP,
          },
        );
        setGuides(r.guides);
        update(movePoints(drag.orig, drag.indices, r.delta));
      }
    } else {
      const r = snapMove(drag.orig.points, delta, {
        shift: e.shiftKey,
        guides: !e.altKey,
        targets: others.flatMap((x) => x.path.points),
        lines,
        edges: reachOf(drag.orig),
        w,
        h,
        tol: SNAP,
      });
      setGuides(r.guides);
      update(movePath(drag.orig, r.delta));
    }
  };

  const endDrag = () => {
    if (drag?.kind === "box" && editing) {
      const moved = Math.hypot((drag.to[0] - drag.from[0]) * w, (drag.to[1] - drag.from[1]) * h);
      if (moved < CLICK) {
        // A click on empty space.
        if (drag.base.length === 0) select(null);
      } else {
        setPoints([...new Set([...drag.base, ...pointsIn(editing, drag.from, drag.to)])]);
      }
    }
    setDrag(null);
    setGuides({});
    breakUndo();
    pressing.current = false;
  };

  const onHandleDown = (i: number, e: React.PointerEvent) => {
    pressing.current = true;
    // Let pans through to the viewport.
    if (e.button !== 0 || space || !editing) return;
    e.stopPropagation();
    if (drawing) {
      // Clicking the first point closes the loop.
      if (i === 0 && editing.points.length > 2) {
        update({ ...editing, closed: true });
        setDrawing(false);
        setCursor(null);
      }
      return;
    }
    if (e.shiftKey) {
      setPoints(picked.includes(i) ? picked.filter((j) => j !== i) : [...picked, i]);
      return;
    }
    const indices = picked.includes(i) ? picked : [i];
    if (!picked.includes(i)) setPoints([i]);
    svg.current?.setPointerCapture(e.pointerId);
    setDrag({
      kind: "points",
      grab: i,
      indices,
      from: at(e),
      orig: editing,
      saved: current?.saved ?? editing,
    });
  };

  const removePoint = (i: number) => {
    if (!editing) return;
    breakUndo();
    update(removePoints(editing, picked.includes(i) ? picked : [i]));
    setPoints([]);
  };

  const px = (editing?.points ?? []).map(([x, y]) => [x * w, y * h] as Pt);
  const last = px[px.length - 1];
  const boxRect =
    drag?.kind === "box"
      ? {
          x: Math.min(drag.from[0], drag.to[0]) * w,
          y: Math.min(drag.from[1], drag.to[1]) * h,
          width: Math.abs(drag.to[0] - drag.from[0]) * w,
          height: Math.abs(drag.to[1] - drag.from[1]) * h,
        }
      : null;
  const pointer =
    drag?.kind === "pan"
      ? "panning"
      : space
        ? "pan"
        : drawing
          ? "draw"
          : drag?.kind === "move" || drag?.kind === "points"
            ? "grabbing"
            : hover
              ? "move"
              : undefined;

  return (
    <section className="canvas" aria-label="Canvas">
      <Toolbar zoom={view.zoom} onZoom={(f) => zoom(f)} onFit={() => setView(FIT)} />
      <div ref={vp} className="viewport" data-pointer={pointer}>
        <div className="artboard" style={{ left: frame.x, top: frame.y, width: w, height: h }}>
          <ScreenImage />
        </div>
        <svg
          ref={svg}
          width={vw}
          height={vh}
          role="application"
          aria-label="Light layout"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => {
            if (drawing) setCursor(null);
            setHover(null);
          }}
          onDoubleClick={(e) => {
            if (!editing) return;
            if (drawing) {
              // The double-click's second press added a point on top of the first.
              const [a, b] = editing.points.slice(-2);
              const dup = a && b && Math.hypot((a[0] - b[0]) * w, (a[1] - b[1]) * h) < CLICK;
              if (dup) update({ ...editing, points: editing.points.slice(0, -1) });
              setDrawing(false);
              setCursor(null);
              return;
            }
            const p = at(e);
            const i = insertIndex(editing, p, w, h);
            if (i >= 0) {
              breakUndo();
              update({
                ...editing,
                points: [...editing.points.slice(0, i), p, ...editing.points.slice(i)],
              });
              setPoints([i]);
            }
          }}
        >
          <g transform={`translate(${frame.x} ${frame.y})`}>
            {ordered.map((p) => (
              <Shape
                key={p.key}
                p={p}
                w={w}
                h={h}
                selected={
                  p.device.id === selection?.id && (selection.section === null || p === current)
                }
                hovered={isHovered(p)}
                filled={
                  p.device.id === selection?.id &&
                  (selection.section === null || p === current) &&
                  showFill
                }
                visible={visible.includes(p)}
              />
            ))}
            {guides.x !== undefined && (
              <line
                className="guide"
                x1={guides.x * w}
                x2={guides.x * w}
                y1={-frame.y}
                y2={vh - frame.y}
              />
            )}
            {guides.y !== undefined && (
              <line
                className="guide"
                x1={-frame.x}
                x2={vw - frame.x}
                y1={guides.y * h}
                y2={guides.y * h}
              />
            )}
            {editing && (
              <g className="editor">
                {drawing && last && cursor && (
                  <line
                    className="editor-ghost"
                    x1={last[0]}
                    y1={last[1]}
                    x2={cursor[0] * w}
                    y2={cursor[1] * h}
                  />
                )}
                {px.map(([x, y], i) => (
                  // biome-ignore lint/a11y/useSemanticElements: an SVG handle can't be a <button>
                  <circle
                    // biome-ignore lint/suspicious/noArrayIndexKey: points are positions
                    key={i}
                    className="editor-handle"
                    role="button"
                    tabIndex={0}
                    aria-label={i === 0 ? "Point 1, start" : `Point ${i + 1}`}
                    aria-pressed={picked.includes(i)}
                    data-start={i === 0 || undefined}
                    data-end={(!editing.closed && i > 0 && i === px.length - 1) || undefined}
                    cx={x}
                    cy={y}
                    r={HANDLE}
                    onPointerDown={(e) => onHandleDown(i, e)}
                    onFocus={() => {
                      // Tabbing to a point picks it.
                      if (!pressing.current && !picked.includes(i)) setPoints([i]);
                      pressing.current = false;
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      removePoint(i);
                    }}
                  />
                ))}
              </g>
            )}
            {boxRect && <rect className="marquee" {...boxRect} />}
          </g>
        </svg>
      </div>
    </section>
  );
}
