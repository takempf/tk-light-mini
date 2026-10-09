import { expect, it } from "vitest";
import { FrameRegistry, parseFrame } from "./frames.js";

function packet(sequence: number, width = 2, height = 1) {
  const data = Buffer.alloc(20 + width * height * 4);
  data.write("TKL1");
  data.writeUInt16LE(width, 4);
  data.writeUInt16LE(height, 6);
  data.writeUInt32LE(sequence, 8);
  data.writeDoubleLE(100, 12);
  return data;
}

it("rejects malformed frames before accessing pixel data", () => {
  expect(() => parseFrame(packet(1).subarray(0, 21))).toThrow("dimensions");
  expect(() => parseFrame(packet(1, 257))).toThrow("dimensions");
  expect(() => parseFrame(Buffer.from("bad"))).toThrow("header");
});

it("keeps only newer frames and expires a disconnected sender", () => {
  const registry = new FrameRegistry();
  registry.connect("office", "Office PC");
  registry.publish("office", parseFrame(packet(2)), 1000);
  registry.publish("office", parseFrame(packet(1)), 1100);
  expect(registry.latest("office", 1100)?.sequence).toBe(2);
  expect(registry.latest("office", 3100)).toBeNull();
  registry.disconnect("office");
  expect(registry.statuses(1100)[0]?.online).toBe(false);
});
