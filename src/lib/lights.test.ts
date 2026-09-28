import { describe, expect, it } from "vitest";
import {
  fitSections,
  mergeSections,
  sectionAt,
  sectionStarts,
  sectionsOf,
  segmentSources,
  splitSection,
} from "./lights";
import type { AddedDevice, Section } from "./types";

const sec = (count: number, color: Section["color"] = "path"): Section => ({ count, color });

const bars = (over: Partial<AddedDevice> = {}): AddedDevice => ({
  id: "B",
  ip: "10.0.0.2",
  sku: "H6056",
  name: "Bars",
  on: true,
  brightness: 1,
  razer: true,
  sections: [sec(6), sec(6, "#ff0000")],
  ...over,
});

describe("fitSections", () => {
  it("gives the last section what's left", () => {
    expect(fitSections([sec(3), sec(1)], 10).map((s) => s.count)).toEqual([3, 7]);
  });

  it("drops sections that don't fit, and keeps one each", () => {
    expect(fitSections([sec(3), sec(4), sec(5)], 5).map((s) => s.count)).toEqual([3, 2]);
    expect(fitSections([sec(0), sec(0)], 2).map((s) => s.count)).toEqual([1, 1]);
  });

  it("always has a section", () => {
    expect(fitSections([], 4)).toEqual([{ count: 4, color: "path" }]);
  });
});

describe("sections of a light", () => {
  it("split by razer segment count, one without razer mode", () => {
    expect(sectionsOf(bars()).map((s) => s.count)).toEqual([6, 6]);
    expect(sectionsOf(bars({ razer: false })).map((s) => s.count)).toEqual([1]);
    expect(sectionsOf(bars({ segments: 8 })).map((s) => s.count)).toEqual([6, 2]);
  });

  it("colors each segment by section, then overrides", () => {
    const d = bars({ segments: 4, sections: [sec(2), sec(2, "#ff0000")] });
    expect(segmentSources(d)).toEqual(["path", "path", "#ff0000", "#ff0000"]);
    const o = { ...d, segmentColors: [null, "#00ff00" as const, null, "path" as const] };
    expect(segmentSources(o)).toEqual(["path", "#00ff00", "#ff0000", "path"]);
  });

  it("finds starts and which section a segment is in", () => {
    const s = [sec(2), sec(3), sec(1)];
    expect(sectionStarts(s)).toEqual([0, 2, 5]);
    expect([0, 1, 2, 4, 5].map((i) => sectionAt(s, i))).toEqual([0, 0, 1, 1, 2]);
  });
});

describe("split and merge", () => {
  const path = { points: [[0, 0.5] as [number, number]], width: 0.1, closed: false };

  it("splits in half by default, and the new part is unplaced", () => {
    const out = splitSection([{ count: 12, color: "#ff0000", path }], 0);
    expect(out).toEqual([
      { count: 6, color: "#ff0000", path },
      { count: 6, color: "#ff0000" },
    ]);
    expect(splitSection([sec(5)], 0, 4).map((s) => s.count)).toEqual([4, 1]);
    expect(splitSection([sec(5)], 0, 9).map((s) => s.count)).toEqual([4, 1]);
  });

  it("won't split a single segment", () => {
    expect(splitSection([sec(1)], 0)).toEqual([sec(1)]);
  });

  it("merges into the first", () => {
    const out = mergeSections([{ count: 2, color: "path", path }, sec(3, "#ff0000"), sec(1)], 0);
    expect(out).toEqual([{ count: 5, color: "path", path }, sec(1)]);
    expect(mergeSections([sec(2)], 0)).toEqual([sec(2)]);
  });
});
