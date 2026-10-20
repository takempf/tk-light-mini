import { describe, expect, it } from "vitest";
import { CANVASES } from "./canvases";
import {
  defaultPalette,
  enginePalette,
  freshName,
  palettesFor,
  pickedPalette,
  recolor,
  slotsOf,
} from "./palettes";
import type { Palette } from "./types";

const mine: Palette = {
  id: "p1",
  name: "Mine",
  canvas: "fire",
  colors: { fire: ["#000000", "#ff0000"] },
};

describe("palettes", () => {
  it("has slots for every canvas but the screen", () => {
    for (const c of CANVASES) {
      expect(slotsOf(c.id).length > 0, c.id).toBe(c.id !== "screen");
      for (const slot of slotsOf(c.id)) {
        expect(slot.colors.length, `${c.id} ${slot.key}`).toBeGreaterThan(0);
        expect(slot.colors.every((h) => /^#[0-9a-f]{6}$/.test(h))).toBe(true);
      }
    }
  });

  it("lists the built-in one first, then the canvas's own", () => {
    const other = { ...mine, id: "p2", canvas: "sea" as const };
    expect(palettesFor("fire", [mine, other]).map((p) => p.id)).toEqual(["fire", "p1"]);
    expect(palettesFor("screen", [mine])).toEqual([]);
  });

  it("falls back to the built-in one", () => {
    expect(pickedPalette("fire", { fire: "p1" }, [mine])).toBe(mine);
    expect(pickedPalette("fire", { fire: "gone" }, [mine]).id).toBe("fire");
    // Another canvas's palette doesn't apply.
    expect(pickedPalette("sea", { sea: "p1" }, [mine]).id).toBe("sea");
    expect(enginePalette("fire", {}, [mine])).toEqual({});
    expect(enginePalette("fire", { fire: "p1" }, [mine])).toEqual(mine.colors);
  });

  it("recolors swatches by place in the slot", () => {
    const swatch = ["#070203", "#ffe89a", "#123456"] as const;
    expect(recolor("fire", swatch, defaultPalette("fire"))).toEqual(swatch);
    // First to first, last to last, unknown kept.
    expect(recolor("fire", swatch, mine)).toEqual(["#000000", "#ff0000", "#123456"]);
  });

  it("numbers names already taken", () => {
    expect(freshName("Custom", [])).toBe("Custom");
    expect(freshName("Custom", ["Custom", "Custom 2"])).toBe("Custom 3");
  });
});
