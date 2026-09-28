import { css, hexRgb, isLive, rgbHex, SWATCHES, type Swatch } from "../lib/colors";
import { useSourceColor } from "../lib/live";
import type { Hex, Source } from "../lib/types";

function SwatchButton({
  swatch,
  ip,
  index,
  pressed,
  onPick,
}: {
  swatch: Swatch;
  ip: string;
  index: number;
  pressed: boolean;
  onPick: (s: Source) => void;
}) {
  const color = useSourceColor(swatch.source, ip, index);
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

/** "Screen", fixed colors, and any other color. */
export function ColorPicker({
  label,
  ip,
  index,
  value,
  onPick,
  extra,
}: {
  label: string;
  /** The light's IP and a segment in what's being colored, for the live "Screen" chip. */
  ip: string;
  index: number;
  /** The current color, if there's one to show as picked. */
  value: Source | undefined;
  onPick: (s: Source) => void;
  /** More swatches after the fixed ones. */
  extra?: React.ReactNode;
}) {
  const custom = value && !isLive(value) && !SWATCHES.some((s) => s.source === value);
  return (
    <fieldset className="picker" aria-label={label}>
      {SWATCHES.map((s) => (
        <SwatchButton
          key={s.source}
          swatch={s}
          ip={ip}
          index={index}
          pressed={s.source === value}
          onPick={onPick}
        />
      ))}
      <label className="swatch-button" data-pressed={custom || undefined}>
        <input
          type="color"
          className="chip chip-input"
          aria-label="Other color"
          value={value && !isLive(value) ? value : "#ffffff"}
          onChange={(e) => onPick(rgbHex(hexRgb(e.target.value)) as Hex)}
        />
        Other
      </label>
      {extra}
    </fieldset>
  );
}
