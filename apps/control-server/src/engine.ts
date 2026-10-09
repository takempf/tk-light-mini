import { calibrate, rgb, samplePath, scale } from "./color.js";
import type { FrameRegistry } from "./frames.js";
import { ScenePainter } from "./scenes.js";
import type { Device, Frame, FrameSource, Rgb, Setup } from "./types.js";

export interface LightOutput {
  turn(ip: string, on: boolean): void;
  color(ip: string, color: Rgb): void;
  razer(ip: string, value: Rgb[] | boolean): void;
}

export function phthalo(frame: Frame): Frame {
  const levels: Rgb[] = [
    [6, 20, 15],
    [18, 53, 36],
    [31, 107, 80],
    [143, 212, 181],
  ];
  const bayer = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  const bgra = Buffer.from(frame.bgra);
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++) {
      const i = (y * frame.width + x) * 4;
      const light =
        (0.2126 * (bgra[i + 2] ?? 0) + 0.7152 * (bgra[i + 1] ?? 0) + 0.0722 * (bgra[i] ?? 0)) / 255;
      const p = Math.max(0, Math.min(1, (light - 0.05) / 0.75)) * 3;
      const lo = Math.floor(p);
      const threshold = ((bayer[y & 3]?.[x & 3] ?? 0) + 0.5) / 16;
      const c = levels[Math.min(3, lo + Number(p - lo > threshold))] ?? levels[0] ?? [0, 0, 0];
      bgra[i] = c[2];
      bgra[i + 1] = c[1];
      bgra[i + 2] = c[0];
      bgra[i + 3] = 255;
    }
  return { ...frame, bgra };
}

export class LightEngine {
  private previous = new Map<
    string,
    {
      colors: Rgb[];
      output: Rgb[];
      sent: number;
      power: number;
      powerTries: number;
      streaming: boolean;
      ip: string;
    }
  >();
  private held = new Map<string, number>();
  private lastTick = 0;
  private calibration: { id: string; color: Rgb; raw: boolean; until: number } | null = null;
  private frameCache = new Map<string, Frame | null>();
  private cacheAt = 0;
  private readonly painter = new ScenePainter();
  private startedAt: number | null = null;
  readonly live = new Map<string, Rgb[]>();
  preview: Frame | null = null;
  constructor(
    private readonly frames: FrameRegistry,
    private readonly output: LightOutput,
  ) {}

  hold(id: string, until: number): void {
    this.held.set(id, until);
    const old = this.previous.get(id);
    if (old?.streaming) this.output.razer(old.ip, false);
    this.previous.delete(id);
  }

  release(id: string): void {
    this.held.delete(id);
  }

  setCalibration(id: string, color: Rgb, raw: boolean, until: number): void {
    if (
      this.calibration?.id === id &&
      this.calibration.raw === raw &&
      this.calibration.color.every((v, i) => v === color[i])
    ) {
      this.calibration.until = until;
      return;
    }
    this.calibration = { id, color, raw, until };
    const old = this.previous.get(id);
    if (old?.streaming) this.output.razer(old.ip, false);
    this.previous.delete(id);
  }

  clearCalibration(): void {
    this.calibration = null;
    for (const state of this.previous.values())
      if (state.streaming) this.output.razer(state.ip, false);
    this.previous.clear();
  }

  private sourceFrame(source: FrameSource, now: number): Frame | null {
    if (this.cacheAt !== now) {
      this.cacheAt = now;
      this.frameCache.clear();
    }
    const key = JSON.stringify(source);
    if (this.frameCache.has(key)) return this.frameCache.get(key) ?? null;
    const frame = this.createSourceFrame(source, now);
    this.frameCache.set(key, frame);
    return frame;
  }

  private createSourceFrame(source: FrameSource, now: number): Frame | null {
    if (source.kind === "color") return null;
    if (source.kind === "scene") {
      this.startedAt ??= now;
      return this.painter.paint(source.scene, now - this.startedAt);
    }
    const frame = this.frames.latest(source.senderId, now);
    if (!frame) return this.sourceFrame(source.fallback ?? { kind: "scene", scene: "forest" }, now);
    return source.filter === "phthalo" ? phthalo(frame) : frame;
  }

  previewFor(setup: Setup, now: number, id?: string, section?: number): Frame | null {
    if (!id) return this.sourceFrame(setup.source, now);
    const device = setup.devices.find((entry) => entry.id === id);
    if (!device) return null;
    const source =
      (section === undefined ? undefined : device.sections[section]?.source) ??
      device.source ??
      setup.source;
    return this.sourceFrame(source, now);
  }

  tick(setup: Setup, now = Date.now()): void {
    const dt = this.lastTick ? Math.max(0, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    const current = new Set<string>();
    this.preview = this.sourceFrame(setup.source, now);
    this.live.clear();
    const calibration = this.calibration && this.calibration.until > now ? this.calibration : null;
    for (const device of setup.devices) {
      if (
        (!device.on && calibration?.id !== device.id) ||
        (!setup.enabled && (!calibration || calibration.id !== device.id))
      )
        continue;
      current.add(device.id);
      const pathColors = calibration
        ? Array.from({ length: Math.max(1, device.razer ? (device.segments ?? 15) : 1) }, () =>
            device.id === calibration.id ? calibration.color : ([0, 0, 0] as Rgb),
          )
        : this.pathColors(device, setup, now);
      this.live.set(device.ip, pathColors);
      const sources = this.segmentSources(device);
      const target = calibration
        ? sources.map(() => (device.id === calibration.id ? calibration.color : ([0, 0, 0] as Rgb)))
        : sources.map((source, i) =>
            source === "path" ? (pathColors[i] ?? ([0, 0, 0] as Rgb)) : rgb(source),
          );
      const prior = this.previous.get(device.id);
      const old = prior?.ip === device.ip ? prior : undefined;
      if (prior && !old && prior.streaming) this.output.razer(prior.ip, false);
      if (old?.streaming && !device.razer) this.output.razer(device.ip, false);
      const tau = Math.max(0, Math.min(1, setup.tuning.smoothing)) * 0.6;
      const alpha = old && tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
      const colors = target.map(
        (c, i) =>
          c.map((v, channel) =>
            Math.round((old?.colors[i]?.[channel] ?? v) * (1 - alpha) + v * alpha),
          ) as Rgb,
      );
      const output = colors.map((c) =>
        scale(
          calibration?.id === device.id && calibration.raw ? c : calibrate(c, device.calibration),
          device.brightness,
        ),
      );
      if ((this.held.get(device.id) ?? 0) > now) continue;
      const powerDue =
        !old || (!device.razer && now - old.power >= (old.powerTries < 3 ? 1000 : 10000));
      if (powerDue) this.output.turn(device.ip, true);
      if (device.razer) {
        if (!old?.streaming) this.output.razer(device.ip, true);
        this.output.razer(device.ip, output);
      } else {
        const first = output[0] ?? [0, 0, 0];
        const last = old?.output[0];
        if (
          !last ||
          first.some((v, i) => Math.abs(v - (last[i] ?? 0)) >= 2) ||
          now - (old?.sent ?? 0) >= 1000
        )
          this.output.color(device.ip, first);
      }
      const sent =
        device.razer ||
        !old ||
        output.some((c, i) => c.some((v, j) => Math.abs(v - (old.output[i]?.[j] ?? 0)) >= 2)) ||
        now - old.sent >= 1000
          ? now
          : old.sent;
      this.previous.set(device.id, {
        colors,
        output: sent === now ? output : (old?.output ?? output),
        sent,
        power: powerDue ? now : old.power,
        powerTries: powerDue ? Math.min(3, (old?.powerTries ?? 0) + 1) : old.powerTries,
        streaming: device.razer,
        ip: device.ip,
      });
    }
    for (const [id, state] of this.previous) {
      if (current.has(id)) continue;
      if (state.streaming) this.output.razer(state.ip, false);
      if (setup.devices.some((d) => d.id === id && !d.on)) this.output.turn(state.ip, false);
      this.previous.delete(id);
    }
  }

  private pathColors(device: Device, setup: Setup, now: number): Rgb[] {
    const out: Rgb[] = [];
    for (const section of device.sections) {
      const source = section.source ?? device.source ?? setup.source;
      const frame = this.sourceFrame(source, now);
      const colors =
        source.kind === "color"
          ? Array.from({ length: section.count }, () => rgb(source.color))
          : frame && section.path
            ? samplePath(frame, section.path, section.count, setup.tuning)
            : Array.from({ length: section.count }, () => [0, 0, 0] as Rgb);
      out.push(...(section.on === false ? colors.map(() => [0, 0, 0] as Rgb) : colors));
    }
    return out;
  }

  private segmentSources(device: Device): string[] {
    const count = device.razer
      ? Math.max(
          1,
          Math.min(
            100,
            device.segments ?? (device.sku === "H61F5" ? 10 : device.sku === "H6056" ? 12 : 15),
          ),
        )
      : 1;
    const sections = device.sections.flatMap((section) =>
      Array.from({ length: section.count }, () =>
        section.on === false ? "#000000" : section.color,
      ),
    );
    const off = device.sections.flatMap((section) =>
      Array.from({ length: section.count }, () => section.on === false),
    );
    return Array.from({ length: count }, (_, i) =>
      off[i] ? "#000000" : (device.segmentColors?.[i] ?? sections[i] ?? "#000000"),
    );
  }
}
