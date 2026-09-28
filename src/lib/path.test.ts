import { describe, expect, it } from "vitest";
import { edgeLoop, insertIndex, reversePath, splitPath } from "./path";

describe("splitPath", () => {
  it("cuts a line into equal pieces", () => {
    const pieces = splitPath(
      [
        [0, 0],
        [100, 0],
      ],
      false,
      4,
    );
    expect(pieces.map((p) => [p[0]?.[0], p[p.length - 1]?.[0]])).toEqual([
      [0, 25],
      [25, 50],
      [50, 75],
      [75, 100],
    ]);
  });

  it("keeps corners inside a piece and closes loops", () => {
    // A 10x10 square loop, 40 long: 2 pieces of 20, each turning one corner.
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const [a, b] = splitPath(square, true, 2);
    expect(a).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(b).toEqual([
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
  });

  it("needs two points", () => {
    expect(splitPath([[1, 1]], false, 3)).toEqual([]);
  });
});

describe("edgeLoop", () => {
  it("runs up the right side from the bottom right, inset by half the width", () => {
    const p = edgeLoop(2, 0.2);
    expect(p.closed).toBe(true);
    expect(p.points[0]).toEqual([0.95, 0.9]);
    expect(p.points[1]).toEqual([0.95, 0.1]);
  });
});

describe("reversePath", () => {
  it("keeps a loop's start", () => {
    const p = {
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
      ] as [number, number][],
      width: 0.1,
      closed: true,
    };
    expect(reversePath(p).points).toEqual([
      [0, 0],
      [1, 1],
      [1, 0],
    ]);
    expect(reversePath({ ...p, closed: false }).points[0]).toEqual([1, 1]);
  });
});

describe("insertIndex", () => {
  const path = {
    points: [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.9, 0.9],
    ] as [number, number][],
    width: 0.1,
    closed: false,
  };

  it("finds the leg under the click", () => {
    expect(insertIndex(path, [0.5, 0.12], 100, 100)).toBe(1);
    expect(insertIndex(path, [0.88, 0.5], 100, 100)).toBe(2);
  });

  it("misses off the band, and uses the closing leg of a loop", () => {
    expect(insertIndex(path, [0.5, 0.5], 100, 100)).toBe(-1);
    expect(insertIndex({ ...path, closed: true }, [0.5, 0.5], 100, 100)).toBe(3);
  });
});
