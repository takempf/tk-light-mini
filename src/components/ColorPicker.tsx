import { isLive, palettesFor, type Swatch } from "../lib/colors";
import type { Source } from "../lib/types";
import { css, useSourceColor } from "./ZonePreview";

function SwatchButton({
  swatch,
  ip,
  pressed,
  onPick,
}: {
  swatch: Swatch;
  ip: string;
  pressed: boolean;
  onPick: (s: Source) => void;
}) {
  const color = useSourceColor(swatch.source, ip);
  return (
    <button
      type="button"
      className="swatch-button"
      aria-pressed={pressed}
      onClick={() => onPick(swatch.source)}
    >
      <span
        className="chip"
        data-live={isLive(swatch.source) || undefined}
        style={{ background: css(color) }}
      />
      {swatch.label}
    </button>
  );
}

/** Palettes of live screen colors and fixed colors. */
export function ColorPicker({
  label,
  ip,
  hasPath,
  value,
  onPick,
}: {
  label: string;
  /** The light's IP, for its live path color. */
  ip: string;
  /** Offer "Path": the light has one. */
  hasPath: boolean;
  /** The current color, if there's one to show as picked. */
  value: Source | undefined;
  onPick: (s: Source) => void;
}) {
  return (
    <fieldset className="picker" aria-label={label}>
      {palettesFor(hasPath).map((p) => (
        <div key={p.name} className="palette">
          <span className="meta">{p.name}</span>
          <div className="swatches">
            {p.swatches.map((s) => (
              <SwatchButton
                key={s.source}
                swatch={s}
                ip={ip}
                pressed={s.source === value}
                onPick={onPick}
              />
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
