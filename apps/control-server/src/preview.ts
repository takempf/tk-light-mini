import type { Frame, Rgb } from "./types.js";

// What the admin shows live: engine status, path colors and canvas frames. It
// long-polls for them as raw bytes in the desktop app's `next_preview` layout
// (see `src-tauri/src/preview.rs`), so both read them with `decodePreview`. A
// message has only the parts that changed after the one the admin has.

const STATUS = 1;
const PATHS = 2;
const IMAGE = 4;

/** Keeps a frame up to date this long after the admin last asked for it. */
const WATCH_MS = 2000;

/** One part and the sequence number it last changed at. */
interface Part {
  seq: number;
  bytes: Buffer;
}

const NONE: Part = { seq: 0, bytes: Buffer.alloc(0) };

const u16 = (value: number) => [value & 255, value >> 8];

export class PreviewSlot {
  private seq = 0;
  private status = NONE;
  private paths = NONE;
  /** Frames by what they show, and when the admin last asked for each. */
  private readonly images = new Map<string, { part: Part; askedAt: number }>();
  private readonly waiting = new Set<() => void>();

  /** `part` replaced by `bytes`, unless they're the same. */
  private update(part: Part, bytes: Buffer): Part {
    if (part.seq > 0 && part.bytes.equals(bytes)) return part;
    // Once the caller has stored it.
    queueMicrotask(() => {
      for (const wake of this.waiting) wake();
    });
    return { seq: ++this.seq, bytes };
  }

  setStatus(running: boolean, error: string | null): void {
    const text = Buffer.from(error ?? "").subarray(0, 0xffff);
    this.status = this.update(
      this.status,
      Buffer.concat([
        Buffer.from([Number(running), Number(error !== null), ...u16(text.length)]),
        text,
      ]),
    );
  }

  /** Each light's path colors, by IP. */
  setPaths(lights: Iterable<[string, Rgb[]]>): void {
    const list = [...lights].slice(0, 0xffff);
    const bytes = [...u16(list.length)];
    for (const [ip, colors] of list) {
      const name = Buffer.from(ip).subarray(0, 255);
      const shown = colors.slice(0, 0xffff);
      bytes.push(name.length, ...name, ...u16(shown.length), ...shown.flat());
    }
    this.paths = this.update(this.paths, Buffer.from(bytes));
  }

  /** The frame for `target`, if the admin is watching it. No frame is 0 x 0. */
  setImage(target: string, frame: Frame | null): void {
    const entry = this.images.get(target);
    if (!entry) return;
    const width = frame?.width ?? 0,
      height = frame?.height ?? 0;
    const bytes = Buffer.alloc(4 + width * height * 4);
    bytes.set([...u16(width), ...u16(height)]);
    if (frame)
      for (let i = 0; i < width * height * 4; i += 4) {
        bytes[4 + i] = frame.bgra[i + 2] ?? 0;
        bytes[5 + i] = frame.bgra[i + 1] ?? 0;
        bytes[6 + i] = frame.bgra[i] ?? 0;
        bytes[7 + i] = 255;
      }
    entry.part = this.update(entry.part, bytes);
  }

  /** The admin wants `target`'s frame. */
  watch(target: string, now: number): void {
    const entry = this.images.get(target);
    if (entry) entry.askedAt = now;
    else this.images.set(target, { part: NONE, askedAt: now });
  }

  /** The frames the admin asked for lately. Forgets the others. */
  watched(now: number): string[] {
    for (const [target, entry] of this.images)
      if (now - entry.askedAt > WATCH_MS) this.images.delete(target);
    return [...this.images.keys()];
  }

  /** The parts for `target` changed after `after`. */
  message(after: number, target: string): Buffer {
    // From an earlier server run: send everything.
    const from = after > this.seq ? 0 : after;
    const parts: [number, Part][] = [
      [STATUS, this.status],
      [PATHS, this.paths],
      [IMAGE, this.images.get(target)?.part ?? NONE],
    ];
    const head = Buffer.alloc(9);
    head.writeBigUInt64LE(BigInt(this.seq));
    const sent = parts.filter(([, part]) => part.seq > from);
    head[8] = sent.reduce((flags, [bit]) => flags | bit, 0);
    return Buffer.concat([head, ...sent.map(([, part]) => part.bytes)]);
  }

  /**
   * What changed for `target` after `after`, waiting up to `timeoutMs` for
   * something to, or until `signal` aborts. With nothing new, it has no parts.
   */
  wait(after: number, target: string, timeoutMs: number, signal?: AbortSignal): Promise<Buffer> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiting.delete(check);
        signal?.removeEventListener("abort", done);
        resolve(this.message(after, target));
      };
      const check = () => {
        const from = after > this.seq ? 0 : after;
        const image = this.images.get(target)?.part ?? NONE;
        if (Math.max(this.status.seq, this.paths.seq, image.seq) > from) done();
      };
      const timer = setTimeout(done, timeoutMs);
      signal?.addEventListener("abort", done);
      this.waiting.add(check);
      if (signal?.aborted) done();
      else check();
    });
  }
}
