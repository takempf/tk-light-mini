import { expect, it } from "vitest";
import { PreviewSlot } from "./preview.js";
import type { Frame } from "./types.js";

const STATUS = 1,
  PATHS = 2,
  IMAGE = 4;
const CANVAS = "canvas";
const pixels = (width: number, height: number, bgra: number[]): Frame => ({
  width,
  height,
  bgra: Buffer.from(bgra),
  sequence: 1,
  capturedAt: 0,
});

it("sends what changed since the last message, as the desktop app does", async () => {
  const p = new PreviewSlot();
  p.setStatus(true, null);
  p.setPaths([["10.0.0.2", [[1, 2, 3]]]]);
  const all = [...(await p.wait(0, CANVAS, 0))];
  expect(all.slice(0, 8)).toEqual([2, 0, 0, 0, 0, 0, 0, 0]);
  expect(all[8]).toBe(STATUS | PATHS);
  expect(all.slice(9, 13)).toEqual([1, 0, 0, 0]);
  expect(all.slice(13, 16)).toEqual([1, 0, 8]);
  expect(Buffer.from(all.slice(16, 24)).toString()).toBe("10.0.0.2");
  expect(all.slice(24)).toEqual([1, 0, 1, 2, 3]);
  // Same colors: nothing to send.
  p.setPaths([["10.0.0.2", [[1, 2, 3]]]]);
  expect([...(await p.wait(2, CANVAS, 0))]).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
});

it("carries the error in the status", async () => {
  const p = new PreviewSlot();
  p.setStatus(false, "boom");
  const m = [...(await p.wait(0, CANVAS, 0))];
  expect(m[8]).toBe(STATUS);
  expect(m.slice(9)).toEqual([0, 1, 4, 0, ...Buffer.from("boom")]);
});

it("sends each target its own frame, as RGBA, and only to who asked", async () => {
  const p = new PreviewSlot();
  p.setImage(CANVAS, pixels(2, 1, [10, 20, 30, 0, 40, 50, 60, 0]));
  expect((await p.wait(0, CANVAS, 0))[8]).toBe(0);
  p.watch(CANVAS, 0);
  p.watch("light", 0);
  p.setImage(CANVAS, pixels(2, 1, [10, 20, 30, 0, 40, 50, 60, 0]));
  p.setImage("light", null);
  const canvas = [...(await p.wait(0, CANVAS, 0))];
  expect(canvas[8]).toBe(IMAGE);
  expect(canvas.slice(9)).toEqual([2, 0, 1, 0, 30, 20, 10, 255, 60, 50, 40, 255]);
  // No frame, as for a light showing one color.
  expect([...(await p.wait(0, "light", 0))].slice(8)).toEqual([IMAGE, 0, 0, 0, 0]);
});

it("forgets frames no one asked for lately", () => {
  const p = new PreviewSlot();
  p.watch(CANVAS, 0);
  p.watch("light", 1500);
  expect(p.watched(1000)).toEqual([CANVAS, "light"]);
  expect(p.watched(2500)).toEqual(["light"]);
});

it("waits for a change, or until it times out or the admin leaves", async () => {
  const p = new PreviewSlot();
  const started = Date.now();
  expect((await p.wait(0, CANVAS, 30))[8]).toBe(0);
  expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  const waiting = p.wait(0, CANVAS, 5000);
  setTimeout(() => p.setStatus(true, null), 10);
  expect((await waiting)[8]).toBe(STATUS);
  // A frame for another target isn't a change for this one.
  p.watch("light", Date.now());
  const gone = new AbortController();
  const left = p.wait(1, CANVAS, 5000, gone.signal);
  p.setImage("light", null);
  setTimeout(() => gone.abort(), 20);
  expect((await left)[8]).toBe(0);
});

it("sends everything for a sequence from an earlier server run", async () => {
  const p = new PreviewSlot();
  p.setStatus(true, null);
  expect((await p.wait(99, CANVAS, 0))[8]).toBe(STATUS);
});
