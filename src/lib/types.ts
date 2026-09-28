export type Rgb = [number, number, number];

export type Hex = `#${string}`;

/**
 * Where a segment gets its color: its section's path on screen ("path"), or a
 * fixed "#rrggbb".
 */
export type Source = "path" | Hex;

/** A line drawn over the screen that a light samples along. */
export interface LightPath {
  /** Screen fractions (0..1), from where the strip starts. */
  points: [number, number][];
  /** Thickness, as a fraction of the screen height. */
  width: number;
  /** Joins the last point back to the first. */
  closed: boolean;
}

/**
 * A run of a light's segments, placed on its own. A light's sections cover its
 * segments in order, so a light with two bars can put one on each side.
 */
export interface Section {
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
  /** RGB, row by row. */
  rgb: Uint8Array;
}

export interface GoveeDevice {
  id: string;
  ip: string;
  sku: string;
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
}

/** Segment counts measured on real lights. */
const KNOWN_SEGMENTS: Readonly<Record<string, number>> = { H61F5: 10, H6056: 12 };

/** Segments to fill in razer mode. 15 is common on Govee strips. */
export const defaultSegments = (sku: string) => KNOWN_SEGMENTS[sku] ?? 15;

export interface Tuning {
  saturation: number;
  brightness: number;
  smoothing: number;
}

export interface Settings {
  fps: number;
  monitor: number;
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
  tuning: Tuning;
  devices: {
    ip: string;
    brightness: number;
    razer: boolean;
    /** One per segment. Without razer mode, one. */
    segments: Source[];
    /** In order. `path` is null when unplaced or when no segment follows it. */
    sections: { path: LightPath | null; count: number }[];
  }[];
}
