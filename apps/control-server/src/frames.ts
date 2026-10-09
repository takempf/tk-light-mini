import {
  FRAME_HEADER_BYTES,
  FRAME_MAGIC,
  MAX_FRAME_DIMENSION,
} from "../../../packages/protocol/src/index.js";
import type { Frame } from "./types.js";

export const FRAME_HEADER = FRAME_HEADER_BYTES;
export const MAX_WIDTH = MAX_FRAME_DIMENSION;
export const MAX_HEIGHT = MAX_FRAME_DIMENSION;
export const STALE_MS = 2000;

/** TKL1, u16 width, u16 height, u32 sequence, f64 capture time, BGRA pixels. */
export function parseFrame(data: Buffer): Frame {
  if (data.length < FRAME_HEADER || data.toString("ascii", 0, 4) !== FRAME_MAGIC)
    throw new Error("Invalid frame header");
  const width = data.readUInt16LE(4),
    height = data.readUInt16LE(6);
  if (
    !width ||
    !height ||
    width > MAX_WIDTH ||
    height > MAX_HEIGHT ||
    data.length !== FRAME_HEADER + width * height * 4
  )
    throw new Error("Invalid frame dimensions");
  const capturedAt = data.readDoubleLE(12);
  if (!Number.isFinite(capturedAt)) throw new Error("Invalid capture time");
  return {
    width,
    height,
    sequence: data.readUInt32LE(8),
    capturedAt,
    bgra: data.subarray(FRAME_HEADER),
  };
}

export interface SenderStatus {
  id: string;
  name: string;
  online: boolean;
  lastSeen: number | null;
  width: number | null;
  height: number | null;
}
interface Sender {
  name: string;
  connected: boolean;
  frame: Frame | null;
  lastSeen: number | null;
}

export class FrameRegistry {
  private readonly senders = new Map<string, Sender>();
  connect(id: string, name: string): void {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || name.length > 80)
      throw new Error("Invalid sender identity");
    this.senders.set(id, { name, connected: true, frame: null, lastSeen: null });
  }
  disconnect(id: string): void {
    const sender = this.senders.get(id);
    if (sender) sender.connected = false;
  }
  publish(id: string, frame: Frame, now = Date.now()): void {
    const sender = this.senders.get(id);
    if (!sender?.connected) throw new Error("Sender is offline");
    if (sender.frame && frame.sequence <= sender.frame.sequence) return;
    sender.frame = frame;
    sender.lastSeen = now;
  }
  latest(id: string, now = Date.now()): Frame | null {
    const sender = this.senders.get(id);
    return sender?.connected &&
      sender.frame &&
      sender.lastSeen !== null &&
      now - sender.lastSeen < STALE_MS
      ? sender.frame
      : null;
  }
  statuses(now = Date.now()): SenderStatus[] {
    return [...this.senders].map(([id, s]) => ({
      id,
      name: s.name,
      online: Boolean(this.latest(id, now)),
      lastSeen: s.lastSeen,
      width: s.frame?.width ?? null,
      height: s.frame?.height ?? null,
    }));
  }
}
