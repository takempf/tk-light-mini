import { describe, expect, it } from "vitest";
import { calibrate, contentRect, samplePath, scale } from "./color.js";
import type { Frame, Rgb } from "./types.js";

const tuning = { saturation: 1, brightness: 1, smoothing: 0 };
function frame(w: number, h: number, pixel: (x: number, y: number) => Rgb): Frame {
  const bgra = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y),
        i = (y * w + x) * 4;
      bgra.set([b, g, r, 255], i);
    }
  return { width: w, height: h, bgra, sequence: 1, capturedAt: 0 };
}

describe("color engine parity", () => {
  it("splits a path into ordered segment colors", () => {
    const image = frame(100, 50, (x) => (x < 50 ? [255, 0, 0] : [0, 0, 255]));
    const path = {
      points: [
        [0, 0.5],
        [1, 0.5],
      ] as [number, number][],
      width: 0.2,
      closed: false,
    };
    expect(samplePath(image, path, 2, tuning)).toEqual([
      [255, 0, 0],
      [0, 0, 255],
    ]);
    expect(samplePath(image, { ...path, points: [...path.points].reverse() }, 2, tuning)).toEqual([
      [0, 0, 255],
      [255, 0, 0],
    ]);
  });

  it("ignores black letterbox bars", () => {
    const image = frame(40, 40, (_x, y) => (y < 5 || y >= 35 ? [0, 0, 0] : [255, 0, 0]));
    expect(contentRect(image)).toEqual({ x0: 0, y0: 5, x1: 40, y1: 35 });
    expect(
      samplePath(
        image,
        {
          points: [
            [0, 0],
            [1, 0],
          ],
          width: 0.2,
          closed: false,
        },
        1,
        tuning,
      ),
    ).toEqual([[255, 0, 0]]);
  });

  it("samples a midpoint for segments shorter than a pixel", () => {
    const image = frame(4, 2, () => [255, 0, 0]);
    const colors = samplePath(
      image,
      {
        points: [
          [0, 0.5],
          [1, 0.5],
        ],
        width: 0.2,
        closed: false,
      },
      20,
      tuning,
    );
    expect(colors).toHaveLength(20);
    expect(colors.every((color) => color.join() === "255,0,0")).toBe(true);
  });

  it("uses calibration corners and preserves color balance above 100% brightness", () => {
    expect(calibrate([255, 255, 255], { white: "#ffdcc0" })).toEqual([255, 220, 192]);
    expect(calibrate([255, 0, 0], { red: "#f01000" })).toEqual([240, 16, 0]);
    expect(scale([100, 50, 25], 3)).toEqual([255, 128, 64]);
  });
});
