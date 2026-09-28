import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { clampPoint, edgeLoop, insertIndex, reversePath, splitPath } from "../lib/path";
import type { AddedDevice, LightPath } from "../lib/types";
import { useScreen, useStore, useZoneColors } from "../store";
import { Button, Switch } from "../ui";
import { pct, Slider } from "./Slider";
import { css } from "./ZonePreview";

/** Until the first frame arrives. */
const FALLBACK = { width: 160, height: 90 };
const DEFAULT_WIDTH = 0.12;

/** Editors open: the engine sends the screen while any are. */
let watchers = 0;
function useScreenFeed() {
  useEffect(() => {
    if (watchers++ === 0) api.setScreenPreview(true).catch(() => {});
    return () => {
      if (--watchers === 0) api.setScreenPreview(false).catch(() => {});
    };
  }, []);
}

/** The engine's small frame, scaled up with crisp pixels. */
function ScreenCanvas() {
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
  if (!image) return <div className="path-waiting">Waiting for the screen…</div>;
  return <canvas ref={ref} width={image.width} height={image.height} />;
}

/**
 * Draw where a light samples: a line over the screen, as thick as the band it
 * reads, split into one piece per segment from the first point.
 */
export function PathEditor({ device, segments }: { device: AddedDevice; segments: number }) {
  useScreenFeed();
  const setPath = useStore((s) => s.setPath);
  const size = useScreen((s) => s.image) ?? FALLBACK;
  const live = useZoneColors((s) => s.paths[device.ip]);
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const { width: W, height: H } = size;
  const path: LightPath = device.path ?? { points: [], width: DEFAULT_WIDTH, closed: false };
  const update = (p: Partial<LightPath>) => setPath(device.id, { ...path, ...p });

  const at = (e: React.PointerEvent): [number, number] => {
    const r = (svg.current as SVGSVGElement).getBoundingClientRect();
    return clampPoint([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]);
  };
  const px = path.points.map(([x, y]) => [x * W, y * H] as [number, number]);
  const loop = path.closed && px.length > 2 ? [...px, px[0] as [number, number]] : px;
  const pieces = splitPath(px, path.closed, segments);
  const line = (pts: [number, number][]) => pts.map((p) => p.join(",")).join(" ");
  const handle = Math.max(W, H) / 70;

  return (
    <div className="path-editor stack">
      <div className="path-canvas" style={{ aspectRatio: `${W} / ${H}` }}>
        <ScreenCanvas />
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Path for ${device.name || device.sku}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const p = at(e);
            const i = insertIndex(path, p, W, H);
            if (i < 0) {
              update({ points: [...path.points, p] });
              return;
            }
            // On the band: add a point there and drag it.
            update({ points: [...path.points.slice(0, i), p, ...path.points.slice(i)] });
            svg.current?.setPointerCapture(e.pointerId);
            setDragging(i);
          }}
          onPointerMove={(e) => {
            if (dragging === null) return;
            update({ points: path.points.map((p, i) => (i === dragging ? at(e) : p)) });
          }}
          onPointerUp={() => setDragging(null)}
          onPointerCancel={() => setDragging(null)}
        >
          {px.length > 1 && (
            // A light rim around the sampled band, so it reads over any image.
            <polyline
              className="path-band"
              points={line(loop)}
              strokeWidth={path.width * H + H / 50}
            />
          )}
          {pieces.map((piece, i) => (
            <polyline
              // biome-ignore lint/suspicious/noArrayIndexKey: pieces are positions
              key={i}
              className="path-piece"
              points={line(piece)}
              style={{ stroke: css(live?.[i]) }}
              strokeWidth={path.width * H}
            />
          ))}
          {px.length > 1 && <polyline className="path-line" points={line(loop)} />}
          {pieces.slice(1).map((piece, i) => (
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: pieces are positions
              key={i}
              className="path-tick"
              cx={piece[0]?.[0]}
              cy={piece[0]?.[1]}
              r={handle / 2}
            />
          ))}
          {segments > 1 &&
            segments <= 60 &&
            pieces.map((piece, i) => {
              // Halfway along the piece.
              const [x, y] = splitPath(piece, false, 2)[1]?.[0] ?? (piece[0] as [number, number]);
              return (
                <text
                  // biome-ignore lint/suspicious/noArrayIndexKey: pieces are positions
                  key={i}
                  className="path-label"
                  x={x}
                  y={y}
                  fontSize={H / 14}
                >
                  {i + 1}
                </text>
              );
            })}
          {px.map(([x, y], i) => (
            // biome-ignore lint/a11y/useSemanticElements: an SVG handle can't be a <button>
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: points are positions
              key={i}
              className="path-handle"
              role="button"
              tabIndex={0}
              aria-label={i === 0 ? "Point 1, start" : `Point ${i + 1}`}
              data-start={i === 0 || undefined}
              cx={x}
              cy={y}
              r={i === 0 ? handle * 1.4 : handle}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                svg.current?.setPointerCapture(e.pointerId);
                setDragging(i);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                update({ points: path.points.filter((_, j) => j !== i) });
              }}
              onKeyDown={(e) => {
                if (e.key === "Delete" || e.key === "Backspace") {
                  update({ points: path.points.filter((_, j) => j !== i) });
                }
              }}
            />
          ))}
        </svg>
      </div>
      <p className="meta">
        Click to add points, from where the strip starts. Click the band to add a point there. Drag
        to move, right-click (or Delete) to remove.
      </p>
      <Switch checked={path.closed} onCheckedChange={(closed: boolean) => update({ closed })}>
        Closed loop
      </Switch>
      <Slider
        label="Thickness"
        value={path.width}
        min={0.02}
        max={0.4}
        step={0.01}
        format={pct}
        onChange={(width) => update({ width })}
      />
      <div className="path-actions">
        <Button size="sm" onClick={() => setPath(device.id, edgeLoop(W / H, path.width))}>
          Edge loop
        </Button>
        <Button
          size="sm"
          disabled={path.points.length < 2}
          onClick={() => setPath(device.id, reversePath(path))}
        >
          Reverse
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!device.path}
          onClick={() => setPath(device.id, undefined)}
        >
          Delete path
        </Button>
      </div>
    </div>
  );
}
