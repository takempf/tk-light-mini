import { describe, expect, it } from "vitest";
import {
  bandOffsets,
  bandRegions,
  directionMarks,
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

describe("section direction marks", () => {
  it("spaces tailed equilateral arrows along long paths and alternates sides", () => {
    const marks = directionMarks(
      [
        [0, 0],
        [510, 0],
      ],
      false,
    );
    expect(marks).toHaveLength(2);
    expect(marks.map(({ triangle }) => triangle.reduce((x, point) => x + point[0], 0) / 3)).toEqual(
      [127.5, 382.5],
    );
    expect(marks.map(({ triangle }) => triangle.reduce((y, point) => y + point[1], 0) / 3)).toEqual(
      [-12, 12],
    );
    for (const {
      triangle: [tip, left, right],
      tail: [back, front],
    } of marks) {
      expect(tip[0]).toBeGreaterThan(left[0]);
      const length = (a: [number, number], b: [number, number]) =>
        Math.hypot(a[0] - b[0], a[1] - b[1]);
      expect(length(tip, left)).toBeCloseTo(8);
      expect(length(left, right)).toBeCloseTo(8);
      expect(length(right, tip)).toBeCloseTo(8);
      expect(back[0]).toBeLessThan(front[0]);
      expect(front[0]).toBeLessThan(tip[0]);
      expect(length(back, front)).toBeCloseTo(7);
    }
  });

  it("follows a closed loop without placing a triangle on a corner", () => {
    const marks = directionMarks(
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      true,
    );
    expect(marks).toHaveLength(2);
    expect(marks[0]?.triangle[0][0]).toBeGreaterThan(90);
    expect(marks[1]?.triangle[0][0]).toBeLessThan(10);
  });
});

describe("corner sampling regions", () => {
  const square: [number, number][] = [
    [4, 4],
    [16, 4],
    [16, 16],
    [4, 16],
  ];

  it("fills the outer corners and shares a diagonal between neighboring segments", () => {
    const regions = bandRegions(square, true, 8, 4);
    expect(regions).toHaveLength(4);
    expect(regions[0]?.points).toEqual([
      [8, 8],
      [12, 8],
      [20, 0],
      [0, 0],
    ]);
    expect(regions[1]?.points).toEqual([
      [12, 8],
      [12, 12],
      [20, 20],
      [20, 0],
    ]);
    expect(regions[3]?.points).toContainEqual([0, 0]);
    const path = {
      points: square.map(([x, y]) => [x / 20, y / 20] as [number, number]),
      width: 0.4,
      closed: true,
    };
    expect(distanceTo(path, [0.025, 0.025], 20, 20)).toBe(0);
    expect(distanceTo(path, [0.5, 0.5], 20, 20)).toBeGreaterThan(0);
  });

  it("keeps open ends flat and limits sharp corner spikes", () => {
    expect(
      bandRegions(
        [
          [4, 10],
          [16, 10],
        ],
        false,
        8,
        1,
      )[0]?.points,
    ).toEqual([
      [4, 14],
      [16, 14],
      [16, 6],
      [4, 6],
    ]);
    for (const offset of bandOffsets(
      [
        [0, 0],
        [10, 0],
        [0, 0.01],
      ],
      false,
      4,
    )) {
      expect(Math.hypot(...offset)).toBeLessThanOrEqual(16.000001);
    }
  });
});

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
  // A 2:1 screen. An L 0.1 thick: along the top, then down. Its corner reaches
  // 0.05 screen heights every way; its square ends reach only across the line.
  const ell = {
    points: [
      [0.3, 0.4],
      [0.5, 0.4],
      [0.5, 0.6],
    ] as [number, number][],
    width: 0.1,
    closed: false,
  };
  const diag = { ...ell, points: [ell.points[0], ell.points[2]] as [number, number][] };
  const at = (p: ReturnType<typeof resolvePath>, i: number) =>
    p.points[i]?.map((v) => Math.round(v * 1000) / 1000);

  it("leaves exact paths alone", () => {
    expect(resolvePath(ell, 2)).toBe(ell);
    // Auto with nothing to follow is exact too.
    const auto = { ...ell, fit: { x: "exact", y: "auto" } as const };
    expect(resolvePath(auto, 2)).toBe(auto);
  });

  it("fills an axis, band edges flush with the screen", () => {
    const p = resolvePath({ ...ell, fit: { x: "fit", y: "exact" } }, 2);
    // The square start sits on the left edge. The corner and the end going
    // down reach 0.05 heights right: 0.025 of the width.
    expect(at(p, 0)).toEqual([0, 0.4]);
    expect(at(p, 1)).toEqual([0.975, 0.4]);
    expect(at(p, 2)).toEqual([0.975, 0.6]);
  });

  it("runs a flat line's square ends right to the edges", () => {
    const flat = {
      points: [
        [0.3, 0.5],
        [0.6, 0.5],
      ] as [number, number][],
      width: 0.4,
      closed: false,
      fit: { x: "fit", y: "exact" } as const,
    };
    expect(resolvePath(flat, 2).points).toEqual([
      [0, 0.5],
      [1, 0.5],
    ]);
  });

  it("scales the other axis with it on auto, about the middle", () => {
    const p = resolvePath({ ...ell, fit: { x: "fit", y: "auto" } }, 2);
    // Width 0.4 heights becomes 1.95: 4.875 times. So does the height 0.2.
    expect(p.points[0]?.[1]).toBeCloseTo(0.5 - 0.1 * 4.875);
    expect(p.points[2]?.[1]).toBeCloseTo(0.5 + 0.1 * 4.875);
  });

  it("fits both ways on its own", () => {
    const p = resolvePath({ ...ell, fit: { x: "fit", y: "fit" } }, 2);
    // The top reaches up 0.05; the square end at the bottom doesn't reach down.
    expect(at(p, 0)).toEqual([0, 0.05]);
    expect(at(p, 2)).toEqual([0.975, 1]);
  });

  it("settles a slanted end's corners inside the screen", () => {
    const p = resolvePath({ ...diag, fit: { x: "fit", y: "fit" } }, 2);
    const [[ax, ay], [bx, by]] = p.points as [[number, number], [number, number]];
    // Each square end's outer corner, in screen heights on the 2:1 screen.
    const [dx, dy] = [(bx - ax) * 2, by - ay];
    const len = Math.hypot(dx, dy);
    const [nx, ny] = [(0.05 * dy) / len, (0.05 * dx) / len];
    expect(ax * 2 - nx).toBeGreaterThan(-0.002);
    expect(ay - ny).toBeGreaterThan(-0.002);
    expect(bx * 2 + nx).toBeLessThan(2.002);
    expect(by + ny).toBeLessThan(1.002);
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
    const saved = { ...ell, fit: { x: "fit", y: "auto" } as const, aspect: 2 };
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
    expect(at(back, 3)).toEqual([0.5, 0.5]);
  });

  it("leaves exact edits as they are", () => {
    const edited = { ...ell, points: [[0.1, 0.1]] as [number, number][] };
    expect(unresolvePath(edited, ell, 2)).toBe(edited);
  });
});
