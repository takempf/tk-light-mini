import { describe, expect, it } from "vitest";
import { clampView, FIT, frameOf, MAX_ZOOM, PAD, panBy, zoomAt } from "./view";

// A 2:1 screen in a viewport that fits it at 200x100.
const [vw, vh, aspect] = [200 + 2 * PAD, 100 + 2 * PAD, 2];

describe("frameOf", () => {
  it("fits the screen in the middle, with room around it", () => {
    expect(frameOf(FIT, vw, vh, aspect)).toEqual({ x: PAD, y: PAD, w: 200, h: 100 });
  });

  it("fits by the tighter side", () => {
    const f = frameOf(FIT, 1000, 100 + 2 * PAD, aspect);
    expect([f.w, f.h]).toEqual([200, 100]);
    expect(f.x).toBe(400);
  });
});

describe("zoomAt", () => {
  it("keeps the spot under the pointer in place", () => {
    const at: [number, number] = [PAD + 50, PAD + 25];
    const v = zoomAt(FIT, 2, at, vw, vh, aspect);
    expect(v.zoom).toBe(2);
    const f = frameOf(v, vw, vh, aspect);
    expect((at[0] - f.x) / f.w).toBeCloseTo(0.25);
    expect((at[1] - f.y) / f.h).toBeCloseTo(0.25);
  });

  it("stays in range", () => {
    expect(zoomAt(FIT, 100, [vw / 2, vh / 2], vw, vh, aspect).zoom).toBe(MAX_ZOOM);
  });
});

describe("panBy", () => {
  it("moves the screen with the pointer, keeping some of it in view", () => {
    const f = frameOf({ ...FIT, zoom: 2 }, vw, vh, aspect);
    const v = panBy({ ...FIT, zoom: 2 }, [40, 0], f);
    expect(v.cx).toBeCloseTo(0.4);
    expect(panBy(FIT, [10_000, 0], frameOf(FIT, vw, vh, aspect)).cx).toBe(0);
    expect(clampView({ zoom: 0.1, cx: 2, cy: -1 })).toEqual({ zoom: 0.5, cx: 1, cy: 0 });
  });
});
