import { describe, expect, it } from "vitest";
import { decodePreview, mergePaths } from "./preview";
import type { Rgb } from "./types";

/** A message laid out as `src-tauri/src/preview.rs` writes it. */
function message(seq: number, parts: number, ...body: number[][]) {
  const head = new Uint8Array(9);
  new DataView(head.buffer).setBigUint64(0, BigInt(seq), true);
  head[8] = parts;
  return new Uint8Array([...head, ...body.flat()]).buffer;
}
const u16 = (v: number) => [v & 255, v >> 8];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("decodePreview", () => {
  it("reads nothing new", () => {
    expect(decodePreview(message(7, 0))).toEqual({ seq: 7 });
  });

  it("reads status, paths and the image", () => {
    const m = decodePreview(
      message(
        3,
        1 | 2 | 4,
        [0, 1, ...u16(4), ...ascii("boom")],
        [...u16(1), 8, ...ascii("10.0.0.2"), ...u16(2), 1, 2, 3, 4, 5, 6],
        [...u16(2), ...u16(1), 10, 20, 30, 255, 40, 50, 60, 255],
      ),
    );
    expect(m.seq).toBe(3);
    expect(m.status).toEqual({ running: false, error: "boom" });
    expect(m.paths).toEqual([
      {
        ip: "10.0.0.2",
        colors: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      },
    ]);
    expect(m.image?.width).toBe(2);
    expect([...(m.image?.rgba ?? [])]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it("reads a running engine without an error", () => {
    expect(decodePreview(message(1, 1, [1, 0, 0, 0])).status).toEqual({
      running: true,
      error: null,
    });
  });
});

describe("mergePaths", () => {
  const a: Rgb = [1, 1, 1];
  const b: Rgb = [2, 2, 2];

  it("returns the same object when nothing changed", () => {
    const prev = { X: [a, b] };
    expect(
      mergePaths(prev, [
        {
          ip: "X",
          colors: [
            [1, 1, 1],
            [2, 2, 2],
          ],
        },
      ]),
    ).toBe(prev);
  });

  it("keeps unchanged colors and lights", () => {
    const prev = { X: [a, b], Y: [a] };
    const next = mergePaths(prev, [
      {
        ip: "X",
        colors: [
          [1, 1, 1],
          [9, 9, 9],
        ],
      },
      { ip: "Y", colors: [[1, 1, 1]] },
    ]);
    expect(next).not.toBe(prev);
    expect(next.X?.[0]).toBe(a);
    expect(next.X?.[1]).toEqual([9, 9, 9]);
    expect(next.Y).toBe(prev.Y);
  });

  it("drops lights that are gone", () => {
    const next = mergePaths({ X: [a], Y: [b] }, [{ ip: "X", colors: [[1, 1, 1]] }]);
    expect(Object.keys(next)).toEqual(["X"]);
  });
});
