export type Rgb = [number, number, number];
export type Hex = `#${string}`;
export type ColorSource = "path" | Hex;

export interface Path {
  points: [number, number][];
  width: number;
  closed: boolean;
  fit?: { x: "exact" | "fit" | "auto"; y: "exact" | "fit" | "auto" };
  aspect?: number;
}

export interface Section {
  name?: string;
  on?: boolean;
  count: number;
  color: ColorSource;
  path?: Path;
  source?: FrameSource;
}

export interface Device {
  id: string;
  ip: string;
  sku: string;
  name: string;
  on: boolean;
  brightness: number;
  razer: boolean;
  segments?: number;
  sections: Section[];
  segmentColors?: (ColorSource | null)[];
  calibration?: Record<string, string | number>;
  source?: FrameSource;
}

export type { FrameSource, Scene } from "../../../packages/protocol/src/index.js";

import type { FrameSource } from "../../../packages/protocol/src/index.js";

export interface Setup {
  version: number;
  revision: number;
  enabled: boolean;
  devices: Device[];
  source: FrameSource;
  tuning: { saturation: number; brightness: number; smoothing: number };
  fps: number;
}

export interface Frame {
  width: number;
  height: number;
  bgra: Buffer;
  sequence: number;
  capturedAt: number;
}
