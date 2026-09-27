import { hexRgb, isLive } from "../lib/colors";
import { type Rgb, type Source, ZONES, type Zone } from "../lib/types";
import { useStore, useZoneColors } from "../store";

export const css = (c: Rgb | undefined) => (c ? `rgb(${c[0]} ${c[1]} ${c[2]})` : undefined);

/** Hook for one zone's live color. Re-renders only when that zone changes. */
export function useZoneColor(zone: Zone): Rgb | undefined {
  return useZoneColors((s) => s.colors?.[ZONES.indexOf(zone)]);
}

/** A source's current color: live ones follow the screen, fixed ones don't. */
export function useSourceColor(source: Source): Rgb | undefined {
  const live = useZoneColors((s) =>
    isLive(source) ? s.colors?.[ZONES.indexOf(source)] : undefined,
  );
  return isLive(source) ? live : hexRgb(source);
}

/** Zones drawn in the preview. The middle shows the whole-screen average. */
type Shape = "top" | "right" | "bottom" | "left" | "all";

/**
 * The screen as the engine samples it, in a 100x100 box stretched to fit: four
 * trapezoids as deep as the edge band, mitered at the corners, and the middle
 * showing All.
 */
function shapes(depth: number): Record<Shape, string> {
  const d = Math.min(Math.max(depth, 0.02), 0.5) * 100;
  const e = 100 - d;
  return {
    top: `0,0 100,0 ${e},${d} ${d},${d}`,
    right: `100,0 100,100 ${e},${e} ${e},${d}`,
    bottom: `100,100 0,100 ${d},${e} ${e},${e}`,
    left: `0,100 0,0 ${d},${d} ${d},${e}`,
    all: `${d},${d} ${e},${d} ${e},${e} ${d},${e}`,
  };
}

export function ZonePreview() {
  const enabled = useStore((s) => s.enabled);
  const depth = useStore((s) => s.settings.tuning.depth);
  const colors = useZoneColors((s) => s.colors);
  const points = shapes(depth);
  const status = enabled ? (colors ? null : "Waiting for frames…") : "Paused";
  return (
    <figure className="preview" aria-label="Zone preview" data-live={enabled && !!colors}>
      <svg className="wall" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {(Object.keys(points) as Shape[]).map((z) => {
          const c = css(colors?.[ZONES.indexOf(z)]);
          return (
            <polygon key={z} className="zone" points={points[z]} style={{ fill: c, stroke: c }} />
          );
        })}
      </svg>
      {status && <div className="preview-status">{status}</div>}
    </figure>
  );
}
