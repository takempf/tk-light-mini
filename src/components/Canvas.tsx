import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { css, hexRgb } from "../lib/colors";
import { sectionStarts, sectionsOf, segmentSources } from "../lib/lights";
import { clampPoint, distanceTo, insertIndex, movePath, splitPath } from "../lib/path";
import { type Guides, snapPoint } from "../lib/snap";
import type { AddedDevice, LightPath, Rgb, Source } from "../lib/types";
import { useLive, useScreen, useStore } from "../store";

type Pt = [number, number];

/** Until the first frame arrives. */
const FALLBACK = { width: 160, height: 90 };
/** Snap distance, in screen pixels. */
const SNAP = 6;
/** Extra reach around a band for clicks, in screen pixels. */
const REACH = 4;
const HANDLE = 6;

/** A placed section, ready to draw. */
interface Placed {
  device: AddedDevice;
  section: number;
  path: LightPath;
  /** Its first segment, in the light. */
  start: number;
  /** One per segment in it. */
  sources: Source[];
  label: string;
}

function placedSections(devices: readonly AddedDevice[]): Placed[] {
  return devices.flatMap((device) => {
    const sections = sectionsOf(device);
    const starts = sectionStarts(sections);
    const sources = segmentSources(device);
    const name = device.name || device.sku;
    return sections.flatMap((s, k) => {
      const start = starts[k] as number;
      if (!s.path) return [];
      return [
        {
          device,
          section: k,
          path: s.path,
          start,
          sources: sources.slice(start, start + s.count),
          label: sections.length > 1 ? `${name} · ${k + 1}` : name,
        },
      ];
    });
  });
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

/** The engine's small frame, scaled up with crisp pixels. */
function ScreenImage() {
  const image = useScreen((s) => s.image);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = image && ref.current?.getContext("2d");
    if (!image || !ctx) return;
    const rgba = new Uint8ClampedArray(image.width * image.height * 4);
    for (let i = 0, j = 0; i < image.rgb.length; i += 3, j += 4) {
      rgba[j] = image.rgb[i] as number;
      rgba[j + 1] = image.rgb[i + 1] as number;
      rgba[j + 2] = image.rgb[i + 2] as number;
      rgba[j + 3] = 255;
    }
    ctx.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
  }, [image]);
  if (!image) return <div className="canvas-waiting">Waiting for the screen…</div>;
  return <canvas ref={ref} width={image.width} height={image.height} />;
}

const line = (pts: readonly Pt[]) => pts.map((p) => p.join(",")).join(" ");

/** A section's band, in its segments' colors, with its name at the start. */
function Shape({ p, w, h, selected }: { p: Placed; w: number; h: number; selected: boolean }) {
  const live = useLive((s) => s.paths[p.device.ip]);
  const px = p.path.points.map(([x, y]) => [x * w, y * h] as Pt);
  const loop = p.path.closed && px.length > 2 ? [...px, px[0] as Pt] : px;
  const pieces = splitPath(px, p.path.closed, p.sources.length);
  const band = Math.max(p.path.width * h, 2);
  const color = (i: number): Rgb | undefined => {
    const s = p.sources[i] as Source;
    return s === "path" ? live?.[p.start + i] : hexRgb(s);
  };
  const [tx, ty] = px[0] ?? [0, 0];
  return (
    <g
      className="shape"
      data-selected={selected || undefined}
      data-off={p.device.on ? undefined : ""}
    >
      {px.length > 1 && (
        // A light rim around the band, so it reads over any picture.
        <polyline className="shape-rim" points={line(loop)} strokeWidth={band + 4} />
      )}
      {pieces.map((piece, i) => (
        <polyline
          // biome-ignore lint/suspicious/noArrayIndexKey: pieces are positions
          key={i}
          className="shape-piece"
          points={line(piece)}
          style={{ stroke: css(color(i)) }}
          strokeWidth={band}
        />
      ))}
      {px.length > 0 && (
        <text className="shape-tag" x={tx} y={ty} dy={-band / 2 - 6}>
          {p.label}
        </text>
      )}
    </g>
  );
}

/**
 * The screen, with every placed light section on it. Click a band to select
 * it; drag it to move it, drag its points to reshape it.
 */
export function Canvas() {
  const devices = useStore((s) => s.devices);
  const selection = useStore((s) => s.selection);
  const drawing = useStore((s) => s.drawing);
  const select = useStore((s) => s.select);
  const setDrawing = useStore((s) => s.setDrawing);
  const setSectionPath = useStore((s) => s.setSectionPath);
  const image = useScreen((s) => s.image) ?? FALLBACK;
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const { w, h } = useSize(box);
  const [drag, setDrag] = useState<
    { kind: "point"; index: number } | { kind: "move"; from: Pt; orig: LightPath } | null
  >(null);
  const [guides, setGuides] = useState<Guides>({});
  const [cursor, setCursor] = useState<Pt | null>(null);

  const placed = placedSections(devices);
  const current = placed.find(
    (p) => p.device.id === selection?.id && p.section === selection.section,
  );
  const selectedDevice = devices.find((d) => d.id === selection?.id);
  // In drawing mode the selected section may still have no points.
  const editing: LightPath | undefined =
    current?.path ??
    (drawing && selectedDevice && selection
      ? { points: [], width: 0.12, closed: false }
      : undefined);
  const update = (path: LightPath) => {
    if (selection) setSectionPath(selection.id, selection.section, path);
  };

  // Enter or Escape ends drawing.
  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        setDrawing(false);
        setCursor(null);
        setGuides({});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing, setDrawing]);

  const at = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const r = (svg.current as SVGSVGElement).getBoundingClientRect();
    return clampPoint([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]);
  };
  /** Every point on screen except `skip` of the edited path, to snap to. */
  const targets = (skip: number): Pt[] => [
    ...placed.filter((p) => p !== current).flatMap((p) => p.path.points),
    ...(editing?.points.filter((_, i) => i !== skip) ?? []),
  ];
  const snap = (e: React.PointerEvent, from: Pt | undefined, skip: number) => {
    const r = snapPoint(at(e), {
      from,
      shift: e.shiftKey,
      guides: !e.altKey,
      targets: targets(skip),
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

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (drawing && editing) {
      const pts = editing.points;
      update({ ...editing, points: [...pts, snap(e, pts[pts.length - 1], -1)] });
      return;
    }
    const p = at(e);
    const hit = (x: Placed) => distanceTo(x.path, p, w, h) <= REACH;
    const target = current && hit(current) ? current : [...placed].reverse().find(hit);
    if (!target) {
      select(null);
      return;
    }
    if (target !== current) select({ id: target.device.id, section: target.section });
    svg.current?.setPointerCapture(e.pointerId);
    setDrag({ kind: "move", from: p, orig: target.path });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drawing && editing) {
      const pts = editing.points;
      setCursor(snap(e, pts[pts.length - 1], -1));
      return;
    }
    if (!drag || !editing || !selection) return;
    if (drag.kind === "point") {
      const q = snap(e, neighbor(editing, drag.index), drag.index);
      update({ ...editing, points: editing.points.map((p, i) => (i === drag.index ? q : p)) });
    } else {
      const p = at(e);
      update(movePath(drag.orig, [p[0] - drag.from[0], p[1] - drag.from[1]]));
    }
  };

  const endDrag = () => {
    setDrag(null);
    setGuides({});
  };

  const removePoint = (i: number) => {
    if (editing) update({ ...editing, points: editing.points.filter((_, j) => j !== i) });
  };

  const nudge = (i: number, e: React.KeyboardEvent) => {
    const step = (e.shiftKey ? 10 : 1) / Math.max(w, 1);
    const d: Record<string, Pt> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, (-step * w) / Math.max(h, 1)],
      ArrowDown: [0, (step * w) / Math.max(h, 1)],
    };
    const [dx, dy] = d[e.key] ?? [0, 0];
    if (!editing || (dx === 0 && dy === 0)) return;
    e.preventDefault();
    update({
      ...editing,
      points: editing.points.map((p, j) => (j === i ? clampPoint([p[0] + dx, p[1] + dy]) : p)),
    });
  };

  const px = (editing?.points ?? []).map(([x, y]) => [x * w, y * h] as Pt);
  const loop = editing?.closed && px.length > 2 ? [...px, px[0] as Pt] : px;
  const count = current?.sources.length ?? 1;
  const pieces = splitPath(px, !!editing?.closed, count);
  const last = px[px.length - 1];

  return (
    <section className="canvas" aria-label="Screen">
      <div className="canvas-fit">
        <div
          ref={box}
          className="canvas-box"
          style={
            {
              aspectRatio: `${image.width} / ${image.height}`,
              "--aspect": image.width / image.height,
            } as React.CSSProperties
          }
          data-drawing={drawing || undefined}
        >
          <ScreenImage />
          <svg
            ref={svg}
            width={w}
            height={h}
            role="application"
            aria-label="Light layout"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => drawing && setCursor(null)}
            onDoubleClick={(e) => {
              if (drawing || !editing) return;
              const p = at(e);
              const i = insertIndex(editing, p, w, h);
              if (i >= 0) {
                update({
                  ...editing,
                  points: [...editing.points.slice(0, i), p, ...editing.points.slice(i)],
                });
              }
            }}
          >
            {placed.map((p) => (
              <Shape
                key={`${p.device.id}-${p.section}`}
                p={p}
                w={w}
                h={h}
                selected={p === current}
              />
            ))}
            {guides.x !== undefined && (
              <line className="guide" x1={guides.x * w} x2={guides.x * w} y1={0} y2={h} />
            )}
            {guides.y !== undefined && (
              <line className="guide" x1={0} x2={w} y1={guides.y * h} y2={guides.y * h} />
            )}
            {editing && (
              <g className="editor">
                {px.length > 1 && <polyline className="editor-line" points={line(loop)} />}
                {drawing && last && cursor && (
                  <line
                    className="editor-ghost"
                    x1={last[0]}
                    y1={last[1]}
                    x2={cursor[0] * w}
                    y2={cursor[1] * h}
                  />
                )}
                {pieces.slice(1).map((piece, i) => (
                  <circle
                    // biome-ignore lint/suspicious/noArrayIndexKey: pieces are positions
                    key={i}
                    className="editor-tick"
                    cx={piece[0]?.[0]}
                    cy={piece[0]?.[1]}
                    r={2.5}
                  />
                ))}
                {count > 1 &&
                  count <= 60 &&
                  pieces.map((piece, i) => {
                    // Halfway along the piece.
                    const [x, y] = splitPath(piece, false, 2)[1]?.[0] ?? (piece[0] as Pt);
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: pieces are positions
                      <text key={i} className="editor-label" x={x} y={y}>
                        {(current?.start ?? 0) + i + 1}
                      </text>
                    );
                  })}
                {px.map(([x, y], i) => (
                  // biome-ignore lint/a11y/useSemanticElements: an SVG handle can't be a <button>
                  <circle
                    // biome-ignore lint/suspicious/noArrayIndexKey: points are positions
                    key={i}
                    className="editor-handle"
                    role="button"
                    tabIndex={0}
                    aria-label={i === 0 ? "Point 1, start" : `Point ${i + 1}`}
                    data-start={i === 0 || undefined}
                    cx={x}
                    cy={y}
                    r={i === 0 ? HANDLE * 1.4 : HANDLE}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || drawing) return;
                      e.stopPropagation();
                      svg.current?.setPointerCapture(e.pointerId);
                      setDrag({ kind: "point", index: i });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      removePoint(i);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Delete" || e.key === "Backspace") removePoint(i);
                      else nudge(i, e);
                    }}
                  />
                ))}
              </g>
            )}
          </svg>
        </div>
      </div>
      <p className="canvas-hint meta">
        {drawing
          ? "Click to add points from where the strip starts. Shift: straight lines. Alt: no guides. Enter: done."
          : editing
            ? "Drag the band to move it, or its points to reshape it. Double-click the band to add a point, right-click a point to remove it. Shift: straight, Alt: no guides."
            : placed.length > 0
              ? "Click a light to edit it."
              : "Add a light to place it on the screen."}
      </p>
    </section>
  );
}
