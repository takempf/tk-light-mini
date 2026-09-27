import { type Rgb, ZONES, type Zone } from "../lib/types";
import { useStore, useZoneColors } from "../store";

export const css = (c: Rgb | undefined) => (c ? `rgb(${c[0]} ${c[1]} ${c[2]})` : undefined);

/** Hook for one zone's live color. Re-renders only when that zone changes. */
export function useZoneColor(zone: Zone): Rgb | undefined {
  return useZoneColors((s) => s.colors?.[ZONES.indexOf(zone)]);
}

export function ZonePreview() {
  const enabled = useStore((s) => s.enabled);
  const [top, left, bottom, right, all] = useZoneColors((s) => s.colors) ?? [];
  return (
    <figure className="preview" aria-label="Zone preview" data-live={enabled && !!all}>
      <div className="wall" style={{ background: css(all) }}>
        <span className="edge edge-top" style={{ background: css(top) }} />
        <span className="edge edge-bottom" style={{ background: css(bottom) }} />
        <span className="edge edge-left" style={{ background: css(left) }} />
        <span className="edge edge-right" style={{ background: css(right) }} />
        <div className="screen">{enabled ? (all ? null : "Waiting for frames…") : "Paused"}</div>
      </div>
    </figure>
  );
}
