import { describe, expect, it } from "vitest";
import { isCalibrated, resolveCalibration, STEPS, testColor, withStep } from "./calibration";

describe("resolveCalibration", () => {
  it("changes nothing by default", () => {
    expect(resolveCalibration()).toEqual({
      gamma: 1,
      white: [255, 255, 255],
      red: [255, 0, 0],
      green: [0, 255, 0],
      blue: [0, 0, 255],
      yellow: [255, 255, 0],
      cyan: [0, 255, 255],
      magenta: [255, 0, 255],
    });
  });

  it("keeps white's balance in unmatched corners", () => {
    const c = resolveCalibration({ white: "#ffe0c0", green: "#20ff00" });
    expect(c.red).toEqual([255, 0, 0]);
    expect(c.green).toEqual([32, 255, 0]);
    expect(c.blue).toEqual([0, 0, 192]);
    expect(c.yellow).toEqual([255, 255, 0]);
    expect(c.cyan).toEqual([32, 255, 192]);
    expect(c.magenta).toEqual([255, 0, 192]);
  });

  it("keeps matched corners as they are", () => {
    const c = resolveCalibration({ white: "#808080", yellow: "#ff9900", gamma: 2.2 });
    expect(c.yellow).toEqual([255, 153, 0]);
    expect(c.gamma).toBe(2.2);
  });
});

describe("withStep", () => {
  it("sets and clears steps, and drops an empty calibration", () => {
    const one = withStep(undefined, "red", "#ff1000");
    expect(one).toEqual({ red: "#ff1000" });
    const two = withStep(one, "gamma", 1.8);
    expect(two).toEqual({ red: "#ff1000", gamma: 1.8 });
    expect(isCalibrated(two)).toBe(true);
    expect(withStep(two, "red", undefined)).toEqual({ gamma: 1.8 });
    expect(withStep(one, "red", undefined)).toBeUndefined();
    expect(isCalibrated(undefined)).toBe(false);
  });
});

it("shows each step's color, white first", () => {
  expect(STEPS[0]).toBe("white");
  expect(testColor("gamma")).toEqual([64, 64, 64]);
  expect(testColor("cyan")).toEqual([0, 255, 255]);
});
