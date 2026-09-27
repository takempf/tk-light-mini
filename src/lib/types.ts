/** Screen zones. "all" is the whole screen, "center" is inside the edge bands. */
export type Zone = "top" | "left" | "bottom" | "right" | "all" | "center";

/** Same order as the Rust `Zone::index`. */
export const ZONES: readonly Zone[] = ["top", "left", "bottom", "right", "all", "center"];

export type Rgb = [number, number, number];
/** Live colors in `ZONES` order. */
export type ZoneColors = Rgb[];

/** Where a light or segment gets its color: a live zone, or a fixed "#rrggbb". */
export type Source = Zone | `#${string}`;

export interface GoveeDevice {
  id: string;
  ip: string;
  sku: string;
}

export interface AddedDevice extends GoveeDevice {
  name: string;
  /** Off lights are switched off and skipped by sync. */
  on: boolean;
  /** The whole light's color. */
  color: Source;
  /** Per-light multiplier on top of the global tuning. 1 = unchanged. */
  brightness: number;
  /** Experimental: stream in razer mode, which skips the light's own fade. */
  razer: boolean;
  /** Segments in razer mode. Unset = `defaultSegments(sku)`. */
  segments?: number;
  /** Per-segment colors in razer mode. Missing or null = the light's color. */
  segmentColors?: (Source | null)[];
}

/** Segment counts measured on real lights. */
const KNOWN_SEGMENTS: Readonly<Record<string, number>> = { H61F5: 10 };

/** Segments to fill in razer mode. 15 is common on Govee strips. */
export const defaultSegments = (sku: string) => KNOWN_SEGMENTS[sku] ?? 15;

export interface Tuning {
  saturation: number;
  brightness: number;
  depth: number;
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
  /** `segments` has one source per segment in razer mode, else is empty. */
  devices: { ip: string; color: Source; brightness: number; razer: boolean; segments: Source[] }[];
}
