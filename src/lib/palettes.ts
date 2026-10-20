import defaults from "./palettes.json";
import type { CanvasSource, Hex, Palette, PaletteColors, Settings } from "./types";

/** One set of colors a canvas paints with. */
export interface Slot {
  key: string;
  label: string;
  /** The built-in colors, dark to light. */
  colors: readonly Hex[];
}

/** Each canvas's slots and built-in colors. The engine reads the same file. */
const SLOTS = defaults as Partial<Record<CanvasSource, readonly Slot[]>>;

/** Most colors a slot holds. */
export const MAX_STOPS = 16;

/** The canvas's slots. None for the plain screen. */
export const slotsOf = (canvas: CanvasSource): readonly Slot[] => SLOTS[canvas] ?? [];

/** A slot of one color stays one; ramps keep at least two. */
export const isSingle = (slot: Slot) => slot.colors.length === 1;

/** The canvas's built-in palette. Its id is the canvas. */
export const defaultPalette = (canvas: CanvasSource): Palette => ({
  id: canvas,
  name: "Default",
  canvas,
  colors: Object.fromEntries(slotsOf(canvas).map((s) => [s.key, [...s.colors]])),
});

/** Built-in palettes can't be changed. */
export const isDefault = (p: Palette) => p.id === p.canvas;

/** The canvas's palettes: the built-in one, then the user's in the order made. */
export const palettesFor = (canvas: CanvasSource, custom: readonly Palette[]): Palette[] =>
  slotsOf(canvas).length
    ? [defaultPalette(canvas), ...custom.filter((p) => p.canvas === canvas)]
    : [];

/** The palette picked for `canvas`, or its built-in one. */
export const pickedPalette = (
  canvas: CanvasSource,
  picked: Settings["palettes"],
  custom: readonly Palette[],
): Palette =>
  custom.find((p) => p.id === picked[canvas] && p.canvas === canvas) ?? defaultPalette(canvas);

/** A slot's colors in `p`, the built-in ones where it has none. */
export const slotColors = (p: Palette, slot: Slot): readonly Hex[] => {
  const colors = p.colors[slot.key];
  return colors?.length ? colors : slot.colors;
};

/** Every slot of `p`'s canvas, filled in. */
export const fullColors = (p: Palette): PaletteColors =>
  Object.fromEntries(slotsOf(p.canvas).map((s) => [s.key, [...slotColors(p, s)]]));

/**
 * Built-in `colors` of `canvas` (a swatch's), each swapped for the color at
 * the same place in the same slot of `p`.
 */
export function recolor(canvas: CanvasSource, colors: readonly Hex[], p: Palette): Hex[] {
  if (isDefault(p)) return [...colors];
  return colors.map((c) => {
    for (const slot of slotsOf(canvas)) {
      const i = slot.colors.indexOf(c);
      if (i < 0) continue;
      const to = slotColors(p, slot);
      const top = slot.colors.length - 1;
      return to[top ? Math.round((i / top) * (to.length - 1)) : 0] ?? c;
    }
    return c;
  });
}

/** `base`, numbered if `taken` has it already: "Custom", "Custom 2"... */
export function freshName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** What the engine paints `canvas` with. Empty means its built-in colors. */
export const enginePalette = (
  canvas: CanvasSource,
  picked: Settings["palettes"],
  custom: readonly Palette[],
): PaletteColors => {
  const p = pickedPalette(canvas, picked, custom);
  return isDefault(p) ? {} : p.colors;
};
