export type Rgb = [number, number, number];

export type Hex = `#${string}`;

/**
 * Where a segment gets its color: its section's path on the canvas ("path"),
 * or a fixed "#rrggbb".
 */
export type Source = "path" | Hex;

/**
 * How a path sizes to its container (the screen, for now) on one axis:
 * - "exact": where its points are
 * - "fit": stretched to fill it, band edges flush with its edges
 * - "auto": scaled with the other axis, keeping the shape's proportions
 */
export type Fit = "exact" | "fit" | "auto";

/** A line drawn over the screen that a light samples along. */
export interface LightPath {
  /** Screen fractions (0..1), from where the strip starts. */
  points: [number, number][];
  /** Thickness, as a fraction of the screen height. */
  width: number;
  /** Joins the last point back to the first. */
  closed: boolean;
  /** Per axis. Missing = exact. Read the placed shape through `resolvePath`. */
  fit?: { x: Fit; y: Fit };
  /**
   * The screen's width over height when the points were placed, so "auto"
   * keeps the shape's proportions on a screen of another shape.
   */
  aspect?: number;
}

/**
 * A run of a light's segments, placed on its own. A light's sections cover its
 * segments in order, so a light with two bars can put one on each side.
 */
export interface Section {
  /** Optional display name. Missing or blank uses "Section n" for its position. */
  name?: string;
  /** Omitted means on. Off preserves the section's placement and colors. */
  on?: boolean;
  /** Segments in it. The last section takes whatever is left. */
  count: number;
  color: Source;
  /** Where it samples. Unplaced until set. */
  path?: LightPath;
}

/** The small frame the engine samples. */
export interface ScreenImage {
  width: number;
  height: number;
  /** RGBA, row by row, ready for `ImageData`. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export interface GoveeDevice {
  id: string;
  ip: string;
  sku: string;
  /** Segments a new light starts with, when the scan knows (iCUE lights: one per fan or stick). */
  segments?: number;
}

export interface AddedDevice extends GoveeDevice {
  name: string;
  /** Off lights are switched off and skipped by sync. */
  on: boolean;
  /** Per-light multiplier on top of the global tuning. 1 = unchanged. */
  brightness: number;
  /** Experimental: stream in razer mode, which skips the light's own fade. */
  razer: boolean;
  /** Segments in razer mode. Unset = `defaultSegments(sku)`. Without razer mode, 1. */
  segments?: number;
  /** At least one. Read them through `sectionsOf`, which fits them to the segments. */
  sections: Section[];
  /** Per-segment overrides. Missing or null = the section's color. */
  segmentColors?: (Source | null)[];
  /** Color matching. Missing = none. */
  calibration?: Calibration;
}

/** A corner of the color cube: a test color the wall is matched to. */
export type Corner = "white" | "red" | "green" | "blue" | "yellow" | "cyan" | "magenta";

/**
 * What a light is sent in place of each test color, so the wall matches the
 * screen, found by eye. Missing corners follow white (see `resolveCalibration`).
 * `gamma` shapes the light's response: over 1 dims the middle. Missing = 1.
 */
export type Calibration = Partial<Record<Corner, Hex>> & { gamma?: number };

/** A calibration with every corner filled in, for the engine. */
export type ResolvedCalibration = Record<Corner, Rgb> & { gamma: number };

/** Segment counts measured on real lights. */
const KNOWN_SEGMENTS: Readonly<Record<string, number>> = { H61F5: 10, H6056: 12 };

/**
 * A light inside this PC (fans, cooler, RAM), reached through Corsair iCUE,
 * not the network. Its `ip` is "icue:" and iCUE's device id. It always takes a
 * color per segment.
 */
export const isPcLight = (d: { ip: string }) => d.ip.startsWith("icue:");

/** Segments to fill in razer mode. 15 is common on Govee strips. */
export const defaultSegments = (sku: string) => KNOWN_SEGMENTS[sku] ?? 15;

export interface Tuning {
  saturation: number;
  brightness: number;
  smoothing: number;
}

/**
 * What the lights follow: the screen, the screen through a filter, or a scene
 * the engine paints.
 */
export type CanvasSource =
  | "screen"
  | "phthalo"
  | "forest"
  | "sunset"
  | "aurora"
  | "sea"
  | "lava"
  | "fire";

export interface Settings {
  fps: number;
  monitor: number;
  canvas: CanvasSource;
  tuning: Tuning;
}

export interface MonitorInfo {
  index: number;
  name: string;
  width: number;
  height: number;
}

export interface EngineStatus {
  running: boolean;
  error: string | null;
}

export interface EngineConfig {
  enabled: boolean;
  fps: number;
  monitor: number;
  canvas: CanvasSource;
  tuning: Tuning;
  devices: {
    ip: string;
    brightness: number;
    razer: boolean;
    /** One per segment. Without razer mode, one. */
    segments: Source[];
    /** In order. `path` is null when unplaced or when no segment follows it. */
    sections: { path: LightPath | null; count: number }[];
    calibration: ResolvedCalibration;
  }[];
}
