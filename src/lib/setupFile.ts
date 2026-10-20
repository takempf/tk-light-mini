import type { AddedDevice, Palette, Settings } from "./types";

/** Marks a file as a light setup. */
const KIND = "light-mini-setup";

export const SETUP_FILE_NAME = "light-mini-setup.json";

/** The lights and canvas settings, as saved in a setup file. */
export interface Setup {
  devices: AddedDevice[];
  settings: Settings;
  /** Missing in files from before palettes. */
  palettes?: Palette[];
}

/** A setup file's text, stamped with the saved-state `version` it was made at. */
export function setupText(setup: Setup, version: number): string {
  return `${JSON.stringify({ kind: KIND, version, ...setup }, null, 2)}\n`;
}

/**
 * The saved state in a setup file, and the version it was made at, to
 * migrate from. Throws with a message fit to show if it isn't one.
 */
export function readSetupText(text: string, current: number): { state: Setup; version: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a light setup.");
  }
  const d = data as Partial<Setup> & { kind?: unknown; version?: unknown };
  if (
    typeof d !== "object" ||
    d === null ||
    d.kind !== KIND ||
    typeof d.version !== "number" ||
    !Array.isArray(d.devices) ||
    typeof d.settings !== "object" ||
    d.settings === null
  ) {
    throw new Error("That file isn't a light setup.");
  }
  if (d.version > current) {
    throw new Error("That setup was made by a newer version of the app.");
  }
  if (!d.devices.every(isDevice)) {
    throw new Error("That setup has a light it can't read.");
  }
  if (d.palettes !== undefined && !(Array.isArray(d.palettes) && d.palettes.every(isPalette))) {
    throw new Error("That setup has a palette it can't read.");
  }
  const state: Setup = { devices: d.devices, settings: d.settings };
  if (d.palettes) state.palettes = d.palettes;
  return { state, version: d.version };
}

/** Enough of a saved light to find it and migrate it. */
const isDevice = (d: unknown): boolean => {
  const x = d as Partial<AddedDevice> | null;
  return (
    typeof x === "object" && x !== null && typeof x.id === "string" && typeof x.ip === "string"
  );
};

const isPalette = (p: unknown): boolean => {
  const x = p as Partial<Palette> | null;
  return (
    typeof x === "object" &&
    x !== null &&
    typeof x.id === "string" &&
    typeof x.name === "string" &&
    typeof x.canvas === "string" &&
    typeof x.colors === "object" &&
    x.colors !== null &&
    Object.values(x.colors).every(
      (c) => Array.isArray(c) && c.every((h) => typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h)),
    )
  );
};
