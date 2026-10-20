import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname } from "node:path";
import type { FrameSource, Setup } from "./types.js";

export const DEFAULT_SETUP: Setup = {
  version: 1,
  revision: 0,
  enabled: false,
  devices: [],
  source: { kind: "scene", scene: "forest" },
  tuning: { saturation: 1.3, brightness: 1, smoothing: 0.5 },
  fps: 30,
};

const validSource = (source: unknown): source is FrameSource => {
  if (!source || typeof source !== "object") return false;
  const s = source as Record<string, unknown>;
  return (
    (s.kind === "color" && typeof s.color === "string" && /^#[0-9a-fA-F]{6}$/.test(s.color)) ||
    (s.kind === "remote" &&
      typeof s.senderId === "string" &&
      /^[a-zA-Z0-9_-]{1,64}$/.test(s.senderId) &&
      (s.filter === undefined || s.filter === "phthalo") &&
      (s.fallback === undefined ||
        (validSource(s.fallback) && (s.fallback as FrameSource).kind !== "remote"))) ||
    (s.kind === "scene" &&
      ["forest", "sunset", "aurora", "sea", "lava", "fire"].includes(String(s.scene)))
  );
};
const validColor = (value: unknown) => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
const validChoice = (value: unknown) => value === "path" || validColor(value);

export function validateSetup(value: unknown): Setup {
  if (!value || typeof value !== "object") throw new Error("Invalid setup");
  const s = value as Setup;
  if (
    s.version !== 1 ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 0 ||
    typeof s.enabled !== "boolean" ||
    !Array.isArray(s.devices) ||
    s.devices.length > 100 ||
    !validSource(s.source)
  )
    throw new Error("Invalid setup");
  if (
    !Number.isFinite(s.fps) ||
    s.fps < 5 ||
    s.fps > 60 ||
    !s.tuning ||
    ![s.tuning.brightness, s.tuning.saturation, s.tuning.smoothing].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 3,
    )
  )
    throw new Error("Invalid tuning");
  const ids = new Set<string>();
  for (const d of s.devices) {
    if (
      !d ||
      typeof d.id !== "string" ||
      !d.id ||
      d.id.length > 128 ||
      ids.has(d.id) ||
      typeof d.ip !== "string" ||
      isIP(d.ip) !== 4 ||
      typeof d.name !== "string" ||
      d.name.length > 200 ||
      typeof d.sku !== "string" ||
      d.sku.length > 100 ||
      typeof d.on !== "boolean" ||
      typeof d.razer !== "boolean" ||
      (d.segments !== undefined &&
        (!Number.isSafeInteger(d.segments) || d.segments < 1 || d.segments > 100)) ||
      (d.segmentColors !== undefined &&
        (!Array.isArray(d.segmentColors) ||
          d.segmentColors.length > 100 ||
          !d.segmentColors.every((c) => c === null || validChoice(c)))) ||
      (d.calibration !== undefined &&
        (typeof d.calibration !== "object" ||
          !Object.entries(d.calibration).every(([key, value]) =>
            key === "gamma"
              ? typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 5
              : validColor(value),
          ))) ||
      !Number.isFinite(d.brightness) ||
      d.brightness < 0 ||
      d.brightness > 3 ||
      !Array.isArray(d.sections) ||
      d.sections.length < 1 ||
      d.sections.length > 100 ||
      (d.source && !validSource(d.source))
    )
      throw new Error("Invalid device");
    ids.add(d.id);
    for (const section of d.sections) {
      if (
        !section ||
        !Number.isSafeInteger(section.count) ||
        section.count < 1 ||
        section.count > 100 ||
        !validChoice(section.color) ||
        (section.on !== undefined && typeof section.on !== "boolean") ||
        (section.source && !validSource(section.source))
      )
        throw new Error("Invalid section");
      if (
        section.path &&
        (!Array.isArray(section.path.points) ||
          section.path.points.length > 100 ||
          !section.path.points.every(
            (p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(v)),
          ) ||
          !Number.isFinite(section.path.width) ||
          section.path.width < 0 ||
          section.path.width > 2 ||
          typeof section.path.closed !== "boolean" ||
          (section.path.aspect !== undefined &&
            (!Number.isFinite(section.path.aspect) ||
              section.path.aspect <= 0 ||
              section.path.aspect > 10)) ||
          (section.path.fit !== undefined &&
            ![section.path.fit.x, section.path.fit.y].every((axis) =>
              ["exact", "fit", "auto"].includes(axis),
            )) ||
          (section.path.edge !== undefined &&
            (typeof section.path.edge !== "object" ||
              section.path.edge === null ||
              ![section.path.edge.start, section.path.edge.end].every(
                (t) => Number.isFinite(t) && t >= 0 && t < 4,
              ) ||
              (section.path.edge.reverse !== undefined &&
                typeof section.path.edge.reverse !== "boolean"))))
      )
        throw new Error("Invalid path");
    }
  }
  return s;
}

export class SetupStore {
  private setup: Setup = structuredClone(DEFAULT_SETUP);
  private updating = false;
  constructor(private readonly file: string) {}
  async load(): Promise<void> {
    try {
      this.setup = validateSetup(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  get(): Setup {
    return structuredClone(this.setup);
  }
  async update(next: Setup, expectedRevision: number): Promise<Setup> {
    if (this.updating || expectedRevision !== this.setup.revision)
      throw new Error("Revision conflict");
    this.updating = true;
    try {
      const checked = validateSetup({ ...next, revision: expectedRevision + 1 });
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(temporary, `${JSON.stringify(checked, null, 2)}\n`, { mode: 0o600 });
      await copyFile(this.file, `${this.file}.bak`).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      await rename(temporary, this.file);
      this.setup = structuredClone(checked);
      return this.get();
    } finally {
      this.updating = false;
    }
  }
}
