import defaults from "./controls.json";
import type { CanvasSource, Controls } from "./types";

/** A setting of one canvas, shown as a slider. */
export interface Control {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** "percent" shows 1 as 100%; "count" shows whole numbers. */
  format: "percent" | "count";
}

/** Each canvas's controls. The engine reads the same file. */
const CONTROLS = defaults as Partial<Record<CanvasSource, readonly Control[]>>;

/** The canvas's controls. None for the plain screen. */
export const controlsOf = (canvas: CanvasSource): readonly Control[] => CONTROLS[canvas] ?? [];

/** `control`'s value in `values`, or its default. */
export const controlValue = (control: Control, values: Controls | undefined): number =>
  values?.[control.key] ?? control.default;

export const formatControl = (control: Control, v: number): string =>
  control.format === "count" ? `${Math.round(v)}` : `${Math.round(v * 100)}%`;
