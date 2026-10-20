import { describe, expect, it } from "vitest";
import { CANVASES } from "./canvases";
import { controlsOf, controlValue, formatControl } from "./controls";

describe("controls", () => {
  it("has some for every canvas but the screen, defaults in range", () => {
    for (const c of CANVASES) {
      expect(controlsOf(c.id).length > 0, c.id).toBe(c.id !== "screen");
      for (const k of controlsOf(c.id)) {
        expect(k.min <= k.default && k.default <= k.max, `${c.id} ${k.key}`).toBe(true);
      }
    }
  });

  it("reads values or defaults, and formats them", () => {
    const blobs = controlsOf("lava").find((k) => k.key === "blobs");
    const speed = controlsOf("lava").find((k) => k.key === "speed");
    if (!blobs || !speed) throw new Error("lava controls");
    expect(controlValue(blobs, undefined)).toBe(7);
    expect(controlValue(blobs, { blobs: 3 })).toBe(3);
    expect(formatControl(blobs, 3)).toBe("3");
    expect(formatControl(speed, 1.5)).toBe("150%");
  });
});
