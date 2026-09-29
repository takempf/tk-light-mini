import type { AddedDevice, Settings } from "./types";

/** Marks a file as a light setup. */
const KIND = "light-mini-setup";

export const SETUP_FILE_NAME = "light-mini-setup.json";

/** The lights and canvas settings, as saved in a setup file. */
export interface Setup {
  devices: AddedDevice[];
  settings: Settings;
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
  return { state: { devices: d.devices, settings: d.settings }, version: d.version };
}

/** Enough of a saved light to find it and migrate it. */
const isDevice = (d: unknown): boolean => {
  const x = d as Partial<AddedDevice> | null;
  return (
    typeof x === "object" && x !== null && typeof x.id === "string" && typeof x.ip === "string"
  );
};
