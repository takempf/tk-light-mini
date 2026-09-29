import type { CanvasSource, Hex } from "./types";

export interface CanvasOption {
  id: CanvasSource;
  label: string;
  /** Follows the screen, so the monitor matters. */
  screen: boolean;
  /** A few colors from its palette, for the picker. The engine has the real ones. */
  colors: readonly Hex[];
}

/** Every canvas the lights can follow, the screen first. */
export const CANVASES: readonly CanvasOption[] = [
  { id: "screen", label: "Screen", screen: true, colors: [] },
  {
    id: "phthalo",
    label: "Phthalo",
    screen: true,
    colors: ["#06140f", "#123524", "#1f6b50", "#8fd4b5"],
  },
  {
    id: "forest",
    label: "Night forest",
    screen: false,
    colors: ["#070c0b", "#172036", "#34425f", "#7582a0", "#13211f"],
  },
  {
    id: "sunset",
    label: "Sunset",
    screen: false,
    colors: ["#2d1543", "#7a2160", "#d34d52", "#f9a94b", "#ffd57e"],
  },
  {
    id: "aurora",
    label: "Aurora",
    screen: false,
    colors: ["#0d0b24", "#3a1d5e", "#178057", "#7fe39a", "#172a3c"],
  },
  {
    id: "sea",
    label: "Deep sea",
    screen: false,
    colors: ["#04192a", "#0a3f55", "#1a7a80", "#7fd3c0", "#062a3f"],
  },
  {
    id: "lava",
    label: "Lava lamp",
    screen: false,
    colors: ["#2a0b33", "#7c1a45", "#e0503a", "#ffc15e", "#4d1040"],
  },
  {
    id: "fire",
    label: "Fireplace",
    screen: false,
    colors: ["#1f0705", "#661605", "#c43d0a", "#f7931e", "#ffe89a"],
  },
];

export const canvasOption = (id: CanvasSource): CanvasOption =>
  CANVASES.find((c) => c.id === id) ?? (CANVASES[0] as CanvasOption);

/** Hard color bands for a swatch. */
export const bands = (colors: readonly string[]) =>
  `linear-gradient(90deg, ${colors
    .map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`)
    .join(", ")})`;
