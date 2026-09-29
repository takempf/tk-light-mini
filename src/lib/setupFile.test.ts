import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../store";
import { readSetupText, setupText } from "./setupFile";
import type { AddedDevice } from "./types";

const light: AddedDevice = {
  id: "AA:BB",
  ip: "192.168.1.10",
  sku: "H6199",
  name: "Desk",
  on: true,
  brightness: 1,
  razer: false,
  sections: [{ count: 1, color: "path" }],
};

describe("setup file", () => {
  it("reads back what it wrote, with its version", () => {
    const setup = { devices: [light], settings: DEFAULT_SETTINGS };
    expect(readSetupText(setupText(setup, 8), 8)).toEqual({ state: setup, version: 8 });
  });

  it("reads older versions, to migrate", () => {
    const text = setupText({ devices: [light], settings: DEFAULT_SETTINGS }, 6);
    expect(readSetupText(text, 8).version).toBe(6);
  });

  it("refuses newer versions", () => {
    const text = setupText({ devices: [], settings: DEFAULT_SETTINGS }, 9);
    expect(() => readSetupText(text, 8)).toThrow("newer version");
  });

  it("refuses files that aren't setups", () => {
    for (const text of ["not json", "{}", '{"kind":"other","version":1}', "null", "[]"]) {
      expect(() => readSetupText(text, 8)).toThrow("isn't a light setup");
    }
    const bad = JSON.stringify({
      kind: "light-mini-setup",
      version: 8,
      devices: [{}],
      settings: {},
    });
    expect(() => readSetupText(bad, 8)).toThrow("can't read");
  });
});
