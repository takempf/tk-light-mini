import { describe, expect, it } from "vitest";
import { snapPoint } from "./snap";

// A 200x100 screen, so fractions and pixels differ per axis.
const base = { targets: [] as [number, number][], w: 200, h: 100, tol: 6 };

describe("snapPoint", () => {
  it("leaves a point alone away from guides", () => {
    expect(snapPoint([0.3, 0.3], base)).toEqual({ point: [0.3, 0.3], guides: {} });
  });

  it("snaps to other points, per axis", () => {
    const r = snapPoint([0.31, 0.72], { ...base, targets: [[0.3, 0.1]] });
    expect(r.point).toEqual([0.3, 0.72]);
    expect(r.guides).toEqual({ x: 0.3 });
  });

  it("snaps to the edges and the middle", () => {
    const r = snapPoint([0.51, 0.97], base);
    expect(r.point).toEqual([0.5, 1]);
    expect(r.guides).toEqual({ x: 0.5, y: 1 });
  });

  it("uses screen pixels for the distance", () => {
    // 0.04 is 8px across (too far) but 4px down (close enough).
    const r = snapPoint([0.46, 0.46], base);
    expect(r.guides).toEqual({ y: 0.5 });
  });

  it("can turn guides off", () => {
    expect(snapPoint([0.51, 0.51], { ...base, guides: false }).point).toEqual([0.51, 0.51]);
  });

  it("locks shift to 0, 45 and 90 degrees, in pixels", () => {
    const from: [number, number] = [0.2, 0.2];
    const flat = snapPoint([0.8, 0.23], { ...base, from, shift: true, guides: false });
    expect(flat.point[1]).toBeCloseTo(0.2);
    const up = snapPoint([0.22, 0.9], { ...base, from, shift: true, guides: false });
    expect(up.point[0]).toBeCloseTo(0.2);
    // 45 degrees on a 2:1 screen: (40, 38)px from the start projects to (39, 39)px.
    const diag = snapPoint([0.4, 0.58], { ...base, from, shift: true, guides: false });
    expect(diag.point[0]).toBeCloseTo(0.395);
    expect(diag.point[1]).toBeCloseTo(0.59);
    expect((diag.point[0] - 0.2) * 200).toBeCloseTo((diag.point[1] - 0.2) * 100);
  });

  it("slides along the shift line to a guide", () => {
    const from: [number, number] = [0.2, 0.2];
    const r = snapPoint([0.49, 0.22], { ...base, from, shift: true });
    expect(r.point[0]).toBeCloseTo(0.5);
    expect(r.point[1]).toBeCloseTo(0.2);
    expect(r.guides).toEqual({ x: 0.5 });
  });
});
