import { css, hexRgb, isLive, rgbHex, SWATCHES, type Swatch, sourceLabel } from "../lib/colors";
import { useSourceColor } from "../lib/live";
import type { Hex, Source } from "../lib/types";
import { Icon, Popover, Tooltip, TooltipProvider } from "../ui";

/**
 * A chip in `source`'s color: live ones show segment `index` of light `ip`.
 * Its own component, so a live color re-renders only the chip.
 */
function SourceChip({ source, ip, index }: { source: Source; ip: string; index: number }) {
  const color = useSourceColor(source, ip, index);
  return (
    <span
      className="chip"
      data-live={isLive(source) || undefined}
      style={{ background: css(color) }}
    />
  );
}

function SwatchButton({
  swatch,
  ip,
  index,
  pressed,
  onPick,
  palette = false,
}: {
  swatch: Swatch;
  ip: string;
  index: number;
  pressed: boolean;
  onPick: (s: Source) => void;
  palette?: boolean;
}) {
  // Palette swatches are fixed colors.
  const background = palette && !isLive(swatch.source) ? css(hexRgb(swatch.source)) : undefined;
  const button = (
    <button
      type="button"
      className={palette ? "swatch-button palette-swatch" : "swatch-button"}
      aria-label={palette ? swatch.label : undefined}
      aria-pressed={pressed}
      style={palette ? { background } : undefined}
      onClick={() => onPick(swatch.source)}
    >
      {!palette && (
        <>
          <SourceChip source={swatch.source} ip={ip} index={index} />
          {swatch.label}
        </>
      )}
    </button>
  );
  return palette ? (
    <Tooltip content={swatch.label} delay={250}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

/** Current color and the canvas, custom, and palette choices in a popup. */
export function ColorPicker({
  label,
  ip,
  index,
  value,
  onPick,
  extra,
}: {
  label: string;
  /** The light's IP and a segment in what's being colored, for the live "Canvas" chip. */
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
    <Popover.Root>
      <Popover.Trigger
        render={<button type="button" className="color-trigger" aria-label={label} />}
      >
        <SourceChip source={value ?? "#777777"} ip={ip} index={index} />
        <span className="color-trigger-text">{value ? sourceLabel(value) : "Mixed"}</span>
        <Icon name="chevron-down" />
      </Popover.Trigger>
      <Popover.Popup className="color-popup" side="bottom" align="start">
        <Popover.Title>Color</Popover.Title>
        <fieldset className="color-options" aria-label={label}>
          <SwatchButton
            swatch={SWATCHES[0] as Swatch}
            ip={ip}
            index={index}
            pressed={value === "path"}
            onPick={onPick}
          />
          <label className="swatch-button" data-pressed={custom || undefined}>
            <input
              type="color"
              className="chip chip-input"
              aria-label="Custom color"
              value={value && !isLive(value) ? value : "#ffffff"}
              onChange={(e) => onPick(rgbHex(hexRgb(e.target.value)) as Hex)}
            />
            Custom color
          </label>
          <span className="tk-range-label">Palette</span>
          <TooltipProvider>
            <div className="picker">
              {SWATCHES.slice(1).map((s) => (
                <SwatchButton
                  key={s.source}
                  swatch={s}
                  ip={ip}
                  index={index}
                  pressed={s.source === value}
                  onPick={onPick}
                  palette
                />
              ))}
            </div>
          </TooltipProvider>
          {extra}
        </fieldset>
      </Popover.Popup>
    </Popover.Root>
  );
}
