import type { Rgb, Source, Zone } from "./types";

export interface Swatch {
  source: Source;
  label: string;
}

export interface Palette {
  name: string;
  swatches: readonly Swatch[];
}

export const PALETTES: readonly Palette[] = [
  {
    name: "Screen",
    swatches: [
      { source: "top", label: "Top" },
      { source: "right", label: "Right" },
      { source: "bottom", label: "Bottom" },
      { source: "left", label: "Left" },
      { source: "center", label: "Center" },
      { source: "all", label: "Average" },
      { source: "path", label: "Path" },
    ],
  },
  {
    name: "Rainbow",
    swatches: [
      { source: "#ff0000", label: "Red" },
      { source: "#ff8000", label: "Orange" },
      { source: "#ffff00", label: "Yellow" },
      { source: "#00ff00", label: "Green" },
      { source: "#0000ff", label: "Blue" },
      { source: "#4000ff", label: "Indigo" },
      { source: "#a000ff", label: "Violet" },
      { source: "#ffffff", label: "White" },
      { source: "#000000", label: "Off" },
    ],
  },
];

/** Follows the screen: a zone or the path. */
export const isLive = (s: Source): s is Zone | "path" => !s.startsWith("#");

/** Palettes for a light. "Path" only once it has one. */
export const palettesFor = (hasPath: boolean): readonly Palette[] =>
  hasPath
    ? PALETTES
    : PALETTES.map((p) => ({ ...p, swatches: p.swatches.filter((s) => s.source !== "path") }));

const LABELS = new Map(PALETTES.flatMap((p) => p.swatches.map((s) => [s.source, s.label])));

export const sourceLabel = (s: Source) => LABELS.get(s) ?? s;

export function hexRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
