import { hexRgb, rgbHex } from "../lib/colors";
import {
  isDefault,
  isSingle,
  MAX_STOPS,
  palettesFor,
  pickedPalette,
  type Slot,
  slotColors,
  slotsOf,
} from "../lib/palettes";
import type { CanvasSource, Hex } from "../lib/types";
import { useStore } from "../store";
import { Button, Icon, Input, Select } from "../ui";

/** One slot's colors: chips to look at, or pickers with more and fewer. */
function SlotColors({
  slot,
  colors,
  locked,
  onChange,
}: {
  slot: Slot;
  colors: readonly Hex[];
  locked: boolean;
  onChange: (colors: Hex[]) => void;
}) {
  const ramp = !isSingle(slot);
  const last = colors[colors.length - 1] as Hex;
  return (
    <div className="palette-slot">
      <span className="tk-range-label">{slot.label}</span>
      <div className="palette-stops">
        {colors.map((c, i) =>
          locked ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: stops are only ever added or removed at the end
            <span key={i} className="chip palette-stop" style={{ background: c }} />
          ) : (
            <input
              // biome-ignore lint/suspicious/noArrayIndexKey: stops are only ever added or removed at the end
              key={i}
              type="color"
              className="chip chip-input palette-stop"
              aria-label={ramp ? `${slot.label} color ${i + 1}` : `${slot.label} color`}
              value={c}
              onChange={(e) => {
                const hex = rgbHex(hexRgb(e.target.value));
                onChange(colors.map((x, k) => (k === i ? hex : x)));
              }}
            />
          ),
        )}
        {!locked && ramp && (
          <>
            <Button
              variant="ghost"
              size="sm"
              square
              aria-label={`Remove the last ${slot.label} color`}
              disabled={colors.length <= 2}
              onClick={() => onChange(colors.slice(0, -1))}
            >
              <Icon name="minus" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              square
              aria-label={`Add a ${slot.label} color`}
              disabled={colors.length >= MAX_STOPS}
              onClick={() => onChange([...colors, last])}
            >
              <Icon name="plus" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** The canvas's palettes: pick one, copy it, and change the user's own. */
export function PaletteSettings({ canvas }: { canvas: CanvasSource }) {
  const custom = useStore((s) => s.palettes);
  const picked = useStore((s) => s.settings.palettes);
  const pickPalette = useStore((s) => s.pickPalette);
  const copyPalette = useStore((s) => s.copyPalette);
  const editPalette = useStore((s) => s.editPalette);
  const deletePalette = useStore((s) => s.deletePalette);

  const slots = slotsOf(canvas);
  if (!slots.length) return null;
  const palette = pickedPalette(canvas, picked, custom);
  const locked = isDefault(palette);

  return (
    <div className="palette-settings stack">
      <div className="palette-row">
        <Select
          aria-label="Palette"
          size="sm"
          className="palette-select"
          value={palette.id}
          onValueChange={(id) => id !== null && pickPalette(canvas, id)}
          items={palettesFor(canvas, custom).map((p) => ({
            value: p.id,
            label: p.name.trim() || "Untitled",
          }))}
        />
        <Button size="sm" onClick={() => copyPalette(palette)}>
          <Icon name="copy" />
          Copy
        </Button>
        {!locked && (
          <Button size="sm" variant="danger" onClick={() => deletePalette(palette.id)}>
            Delete
          </Button>
        )}
      </div>
      {!locked && (
        <Input
          size="sm"
          aria-label="Palette name"
          value={palette.name}
          onChange={(e) => editPalette(palette.id, { name: e.target.value })}
        />
      )}
      {slots.map((slot) => (
        <SlotColors
          key={slot.key}
          slot={slot}
          colors={slotColors(palette, slot)}
          locked={locked}
          onChange={(colors) =>
            editPalette(palette.id, { colors: { ...palette.colors, [slot.key]: colors } })
          }
        />
      ))}
      {locked && (
        <p className="setting-hint">The default can't be changed. Copy it to make your own.</p>
      )}
    </div>
  );
}
