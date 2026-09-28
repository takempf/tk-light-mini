import type { Hex, Rgb, Source } from "./types";

export interface Swatch {
  source: Source;
  label: string;
}

/** "Screen" follows the section's path; the rest are fixed. */
export const SWATCHES: readonly Swatch[] = [
  { source: "path", label: "Screen" },
  { source: "#ff0000", label: "Red" },
  { source: "#ff8000", label: "Orange" },
  { source: "#ffff00", label: "Yellow" },
  { source: "#00ff00", label: "Green" },
  { source: "#0000ff", label: "Blue" },
  { source: "#4000ff", label: "Indigo" },
  { source: "#a000ff", label: "Violet" },
  { source: "#ffffff", label: "White" },
  { source: "#000000", label: "Off" },
];

/** Follows the screen. */
export const isLive = (s: Source): s is "path" => s === "path";

const LABELS = new Map(SWATCHES.map((s) => [s.source, s.label]));

export const sourceLabel = (s: Source) => LABELS.get(s) ?? s.toUpperCase();

export function hexRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbHex = (c: Rgb): Hex =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export const css = (c: Rgb | undefined) => (c ? `rgb(${c[0]} ${c[1]} ${c[2]})` : undefined);
