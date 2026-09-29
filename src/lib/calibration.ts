import { hexRgb } from "./colors";
import type { Calibration, Corner, ResolvedCalibration, Rgb } from "./types";

/** One step of calibrating: match a corner, or the gamma. */
export type Step = Corner | "gamma";

/** In the wizard's order. White goes first, since the other corners follow it. */
export const STEPS: readonly Step[] = [
  "white",
  "gamma",
  "red",
  "green",
  "blue",
  "yellow",
  "cyan",
  "magenta",
];

const FULL: Readonly<Record<Corner, Rgb>> = {
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
};

/** Dark enough that the light's response curve shows. */
export const GREY: Rgb = [64, 64, 64];

/** What the screen shows during `step`, and what the light is sent (calibrated). */
export const testColor = (step: Step): Rgb => (step === "gamma" ? GREY : FULL[step]);

/**
 * Every corner filled in. Unmatched primaries keep white's balance (the wall
 * tints every color the same way), and unmatched secondaries mix their
 * primaries, as the light's LEDs do.
 */
export function resolveCalibration(c: Calibration = {}): ResolvedCalibration {
  const corner = (k: Corner, fallback: Rgb): Rgb => {
    const v = c[k];
    return v ? hexRgb(v) : fallback;
  };
  const white = corner("white", FULL.white);
  const only = (i: number) => white.map((v, k) => (k === i ? v : 0)) as Rgb;
  const mix = (a: Rgb, b: Rgb) => a.map((v, k) => Math.min(255, v + (b[k] as number))) as Rgb;
  const red = corner("red", only(0));
  const green = corner("green", only(1));
  const blue = corner("blue", only(2));
  return {
    gamma: c.gamma ?? 1,
    white,
    red,
    green,
    blue,
    yellow: corner("yellow", mix(red, green)),
    cyan: corner("cyan", mix(green, blue)),
    magenta: corner("magenta", mix(red, blue)),
  };
}

/** The step was matched, rather than following white or the default. */
export const isSet = (c: Calibration | undefined, step: Step) => c?.[step] !== undefined;

export const isCalibrated = (c: Calibration | undefined) => STEPS.some((s) => isSet(c, s));

/** `c` with `step` set, or cleared with undefined. Undefined once nothing is set. */
export function withStep(
  c: Calibration | undefined,
  step: Step,
  value: Calibration[Step],
): Calibration | undefined {
  const next: Calibration = { ...c };
  delete next[step];
  if (value !== undefined) Object.assign(next, { [step]: value });
  return isCalibrated(next) ? next : undefined;
}
