/** Version 1 sender frame: magic, dimensions, sequence, capture time, then BGRA. */
export const FRAME_MAGIC = "TKL1";
export const FRAME_HEADER_BYTES = 20;
export const MAX_FRAME_DIMENSION = 256;

export type Scene = "forest" | "sunset" | "aurora" | "sea" | "lava" | "fire";
export type FrameSource =
  | {
      kind: "remote";
      senderId: string;
      filter?: "phthalo";
      fallback?: { kind: "scene"; scene: Scene } | { kind: "color"; color: `#${string}` };
    }
  | { kind: "scene"; scene: Scene }
  | { kind: "color"; color: `#${string}` };
