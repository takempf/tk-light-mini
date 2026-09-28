import { describe, expect, it } from "vitest";
import {
  distanceTo,
  edgeLoop,
  flipPath,
  insertIndex,
  labelPoint,
  movePath,
  movePoints,
  pointsIn,
  removePoints,
  resolvePath,
  reversePath,
  splitPath,
  startAt,
  unresolvePath,
  zonePath,
} from "./path";

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

describe("distanceTo", () => {
  const path = {
    points: [
      [0.1, 0.5],
      [0.9, 0.5],
    ] as [number, number][],
    width: 0.2,
    closed: false,
  };

  it("is 0 or less on the band, and pixels past its edge off it", () => {
    expect(distanceTo(path, [0.5, 0.55], 100, 100)).toBeLessThanOrEqual(0);
    expect(distanceTo(path, [0.5, 0.8], 100, 100)).toBeCloseTo(20);
    expect(distanceTo({ ...path, points: [] }, [0.5, 0.5], 100, 100)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("movePath", () => {
  it("moves every point, but not off screen", () => {
    const p = {
      points: [
        [0.1, 0.2],
        [0.5, 0.6],
      ] as [number, number][],
      width: 0.1,
      closed: false,
    };
    expect(movePath(p, [0.1, 0.1]).points).toEqual([
      [0.2, 0.30000000000000004],
      [0.6, 0.7],
    ]);
    expect(movePath(p, [-0.5, 0.9]).points).toEqual([
      [0, 0.6000000000000001],
      [0.4, 1],
    ]);
  });
});

describe("zonePath", () => {
  it("runs along the old edge band", () => {
    const top = zonePath("top", 2, 0.2);
    expect(top.points).toEqual([
      [0, 0.1],
      [1, 0.1],
    ]);
    expect(top.width).toBe(0.2);
    expect(zonePath("left", 2, 0.2).points[0]).toEqual([0.05, 0]);
  });

  it("covers the screen for the average", () => {
    expect(zonePath("all", 2, 0.2).width).toBe(1);
  });
});

describe("point tools", () => {
  const square = {
    points: [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
    ] as [number, number][],
    width: 0.1,
    closed: true,
  };

  it("moves only the picked points, held on screen together", () => {
    const moved = movePoints(square, [1, 2], [0.5, 0]);
    expect(moved.points.map(([x]) => x)).toEqual([0.2, 1, 1, 0.2]);
    expect(moved.points[3]).toEqual([0.2, 0.8]);
    expect(movePoints(square, [], [0.1, 0.1])).toBe(square);
  });

  it("mirrors across the middle", () => {
    const line = { ...square, points: [[0.1, 0.3]] as [number, number][] };
    expect(flipPath(line, "x").points[0]?.[0]).toBeCloseTo(0.9);
    expect(flipPath(line, "y").points[0]?.[1]).toBeCloseTo(0.7);
  });

  it("starts a loop at another point, same direction", () => {
    expect(startAt(square, 2).points).toEqual([
      [0.8, 0.8],
      [0.2, 0.8],
      [0.2, 0.2],
      [0.8, 0.2],
    ]);
    expect(startAt(square, 0)).toBe(square);
  });

  it("removes points and finds the ones in a box", () => {
    expect(removePoints(square, [0, 3]).points).toEqual([
      [0.8, 0.2],
      [0.8, 0.8],
    ]);
    expect(pointsIn(square, [0.9, 0.9], [0.5, 0.1])).toEqual([1, 2]);
  });
});

describe("labelPoint", () => {
  it("is halfway along an open path, and in the middle of a loop", () => {
    const l: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 30],
    ];
    expect(labelPoint(l, false)).toEqual([10, 0 + 10]);
    expect(labelPoint(l, true)).toEqual([5, 15]);
    expect(labelPoint([[3, 4]], false)).toEqual([3, 4]);
    expect(labelPoint([], false)).toBeUndefined();
  });
});

describe("resolvePath", () => {
  // A 2:1 screen. A diagonal band 0.1 thick: its edges are 0.05 screen heights out.
  const diag = {
    points: [
      [0.3, 0.4],
      [0.5, 0.6],
    ] as [number, number][],
    width: 0.1,
    closed: false,
  };
  const at = (p: ReturnType<typeof resolvePath>, i: number) =>
    p.points[i]?.map((v) => Math.round(v * 1000) / 1000);

  it("leaves exact paths alone", () => {
    expect(resolvePath(diag, 2)).toBe(diag);
    // Auto with nothing to follow is exact too.
    const auto = { ...diag, fit: { x: "exact", y: "auto" } as const };
    expect(resolvePath(auto, 2)).toBe(auto);
  });

  it("fills an axis, band edges flush with the screen", () => {
    const p = resolvePath({ ...diag, fit: { x: "fit", y: "exact" } }, 2);
    // 0.05 heights in from each side is 0.025 of the width.
    expect(at(p, 0)).toEqual([0.025, 0.4]);
    expect(at(p, 1)).toEqual([0.975, 0.6]);
  });

  it("scales the other axis with it on auto, about the middle", () => {
    const p = resolvePath({ ...diag, fit: { x: "fit", y: "auto" } }, 2);
    // Width 0.4 heights becomes 1.9: 4.75 times. The height 0.2 becomes 0.95.
    expect(at(p, 0)).toEqual([0.025, 0.025]);
    expect(at(p, 1)).toEqual([0.975, 0.975]);
  });

  it("fits both ways on its own", () => {
    const p = resolvePath({ ...diag, fit: { x: "fit", y: "fit" } }, 2);
    expect(at(p, 0)).toEqual([0.025, 0.05]);
    expect(at(p, 1)).toEqual([0.975, 0.95]);
  });

  it("keeps proportions on a screen of another shape", () => {
    // A square placed on a 2:1 screen: its height fits, its width follows.
    const square = {
      points: [
        [0.25, 0],
        [0.75, 1],
      ] as [number, number][],
      width: 0,
      closed: false,
      aspect: 2,
      fit: { x: "auto", y: "fit" } as const,
    };
    // On a 4:1 screen it stays square: one height wide, a quarter of the width.
    const p = resolvePath(square, 4);
    expect(at(p, 0)).toEqual([0.375, 0]);
    expect(at(p, 1)).toEqual([0.625, 1]);
  });

  it("maps an edit on screen back into the saved shape", () => {
    const saved = { ...diag, fit: { x: "fit", y: "auto" } as const, aspect: 2 };
    const shown = resolvePath(saved, 2);
    // Nothing changed: the saved shape comes back.
    const same = unresolvePath(shown, saved, 2);
    same.points.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(saved.points[i]?.[0] as number, 9);
      expect(y).toBeCloseTo(saved.points[i]?.[1] as number, 9);
    });
    // A point added on screen lands where it shows.
    const more = { ...shown, points: [...shown.points, [0.5, 0.5] as [number, number]] };
    const back = resolvePath(unresolvePath(more, saved, 2), 2);
    expect(at(back, 2)).toEqual([0.5, 0.5]);
  });

  it("leaves exact edits as they are", () => {
    const edited = { ...diag, points: [[0.1, 0.1]] as [number, number][] };
    expect(unresolvePath(edited, diag, 2)).toBe(edited);
  });
});
