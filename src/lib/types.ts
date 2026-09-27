export type Zone = "top" | "left" | "bottom" | "right" | "all";

/** Same order as the Rust `Zone::index`. */
export const ZONES: readonly Zone[] = ["top", "left", "bottom", "right", "all"];

export type Rgb = [number, number, number];
export type ZoneColors = [Rgb, Rgb, Rgb, Rgb, Rgb];

export interface GoveeDevice {
  id: string;
  ip: string;
  sku: string;
}

export interface AddedDevice extends GoveeDevice {
  name: string;
  zone: Zone;
  /** Per-light multiplier on top of the global tuning. 1 = unchanged. */
  brightness: number;
}

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
  devices: { ip: string; zone: Zone; brightness: number }[];
}
