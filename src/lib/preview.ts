import type { EngineStatus, Rgb, ScreenImage } from "./types";

/** One light's live path colors, one per segment. */
export interface LightColors {
  ip: string;
  colors: Rgb[];
}

/** What changed in the engine's preview since the last poll. */
export interface Preview {
  /** Pass back to get only what changes after this. */
  seq: number;
  status?: EngineStatus;
  paths?: LightColors[];
  image?: ScreenImage;
}

const STATUS = 1;
const PATHS = 2;
const IMAGE = 4;

const text = new TextDecoder();

/** Read a `next_preview` message. The layout is in `src-tauri/src/preview.rs`. */
export function decodePreview(buf: ArrayBuffer): Preview {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let at = 0;
  const u8 = () => view.getUint8(at++);
  const u16 = () => {
    const v = view.getUint16(at, true);
    at += 2;
    return v;
  };
  const str = (length: number) => {
    const s = text.decode(bytes.subarray(at, at + length));
    at += length;
    return s;
  };
  const seq = Number(view.getBigUint64(0, true));
  at = 8;
  const parts = u8();
  const out: Preview = { seq };
  if (parts & STATUS) {
    const running = u8() === 1;
    const hasError = u8() === 1;
    const error = str(u16());
    out.status = { running, error: hasError ? error : null };
  }
  if (parts & PATHS) {
    out.paths = Array.from({ length: u16() }, () => {
      const ip = str(u8());
      const colors = Array.from({ length: u16() }, () => {
        const c: Rgb = [bytes[at] as number, bytes[at + 1] as number, bytes[at + 2] as number];
        at += 3;
        return c;
      });
      return { ip, colors };
    });
  }
  if (parts & IMAGE) {
    const width = u16();
    const height = u16();
    // A view, not a copy: the message is only this frame's.
    out.image = { width, height, rgba: new Uint8ClampedArray(buf, at, width * height * 4) };
  }
  return out;
}

const same = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * `lights` as the live colors by IP, reusing `prev`'s arrays for colors that
 * didn't change: components that select one color, or a light's colors, then
 * only re-render when those change. Returns `prev` itself when nothing did.
 */
export function mergePaths(
  prev: Readonly<Record<string, Rgb[]>>,
  lights: readonly LightColors[],
): Record<string, Rgb[]> {
  let changed = Object.keys(prev).length !== lights.length;
  const next: Record<string, Rgb[]> = {};
  for (const { ip, colors } of lights) {
    const old = prev[ip];
    const merged = colors.map((c, i) => {
      const o = old?.[i];
      return o && same(o, c) ? o : c;
    });
    const kept = old?.length === merged.length && merged.every((c, i) => c === old[i]);
    next[ip] = kept && old ? old : merged;
    if (!kept) changed = true;
  }
  return changed ? next : (prev as Record<string, Rgb[]>);
}
