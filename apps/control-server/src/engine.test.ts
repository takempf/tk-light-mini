import { expect, it } from "vitest";
import { LightEngine, phthalo } from "./engine.js";
import { FrameRegistry } from "./frames.js";
import { DEFAULT_SETUP } from "./setup.js";
import type { Frame, Rgb, Setup } from "./types.js";

const light = (id: string, ip: string) => ({
  id,
  ip,
  sku: "H6056",
  name: id,
  on: true,
  brightness: 1,
  razer: false,
  sections: [
    {
      count: 1,
      color: "path" as const,
      path: {
        points: [
          [0, 0.5],
          [1, 0.5],
        ] as [number, number][],
        width: 0.5,
        closed: false,
      },
    },
  ],
});
const frame = (color: Rgb, sequence: number): Frame => ({
  width: 4,
  height: 2,
  sequence,
  capturedAt: 100,
  bgra: Buffer.from(Array.from({ length: 8 }, () => [color[2], color[1], color[0], 255]).flat()),
});

it("selects different remote screens per light and falls back when a sender stops", () => {
  const frames = new FrameRegistry();
  frames.connect("red", "Red screen");
  frames.connect("blue", "Blue screen");
  frames.publish("red", frame([255, 0, 0], 1), 1000);
  frames.publish("blue", frame([0, 0, 255], 1), 1000);
  const sent: Record<string, Rgb> = {};
  const engine = new LightEngine(frames, {
    turn() {},
    razer() {},
    color(ip, value) {
      sent[ip] = value;
    },
  });
  const setup: Setup = {
    ...structuredClone(DEFAULT_SETUP),
    enabled: true,
    tuning: { saturation: 1, brightness: 1, smoothing: 0 },
    source: { kind: "remote", senderId: "red" },
    devices: [
      light("one", "192.168.1.2"),
      { ...light("two", "192.168.1.3"), source: { kind: "remote", senderId: "blue" } },
    ],
  };
  engine.tick(setup, 1000);
  expect(sent["192.168.1.2"]).toEqual([255, 0, 0]);
  expect(sent["192.168.1.3"]).toEqual([0, 0, 255]);
  frames.disconnect("red");
  engine.tick(setup, 3001);
  expect(sent["192.168.1.2"]).not.toEqual([0, 0, 0]);
});

it("keeps fixed colors after the sender disappears and turns an off light off", () => {
  const turns: boolean[] = [],
    colors: Rgb[] = [];
  const engine = new LightEngine(new FrameRegistry(), {
    turn(_ip, on) {
      turns.push(on);
    },
    color(_ip, color) {
      colors.push(color);
    },
    razer() {},
  });
  const setup: Setup = {
    ...structuredClone(DEFAULT_SETUP),
    enabled: true,
    devices: [{ ...light("one", "192.168.1.2"), sections: [{ count: 1, color: "#ff0000" }] }],
  };
  engine.tick(setup, 1000);
  engine.tick(setup, 2100);
  expect(colors).toEqual([
    [255, 0, 0],
    [255, 0, 0],
  ]);
  const device = setup.devices[0];
  if (!device) throw new Error("Missing test light");
  device.on = false;
  engine.tick(setup, 2200);
  expect(turns.at(-1)).toBe(false);
});

it("shows calibration test color even while sync is off", () => {
  const colors: Rgb[] = [];
  const engine = new LightEngine(new FrameRegistry(), {
    turn() {},
    color(_ip, c) {
      colors.push(c);
    },
    razer() {},
  });
  const setup: Setup = {
    ...structuredClone(DEFAULT_SETUP),
    devices: [light("one", "192.168.1.2")],
  };
  engine.setCalibration("one", [0, 255, 0], true, 6000);
  engine.tick(setup, 1000);
  expect(colors.at(-1)).toEqual([0, 255, 0]);
  engine.clearCalibration();
  engine.tick(setup, 1100);
  expect(colors).toHaveLength(1);
});

it("dithers remote frames into the four original phthalo greens", () => {
  const image: Frame = {
    width: 4,
    height: 4,
    sequence: 1,
    capturedAt: 0,
    bgra: Buffer.from(Array.from({ length: 16 }, () => [128, 128, 128, 255]).flat()),
  };
  const colors = new Set<string>();
  const result = phthalo(image);
  for (let i = 0; i < result.bgra.length; i += 4)
    colors.add([result.bgra[i + 2], result.bgra[i + 1], result.bgra[i]].join());
  expect([...colors].sort()).toEqual(["18,53,36", "31,107,80"]);
});

it("previews the source selected for a light or its section", () => {
  const frames = new FrameRegistry();
  frames.connect("red", "Red screen");
  frames.connect("blue", "Blue screen");
  frames.publish("red", frame([255, 0, 0], 1), 1000);
  frames.publish("blue", frame([0, 0, 255], 1), 1000);
  const engine = new LightEngine(frames, { turn() {}, color() {}, razer() {} });
  const setup: Setup = {
    ...structuredClone(DEFAULT_SETUP),
    devices: [
      {
        ...light("one", "192.168.1.2"),
        source: { kind: "remote", senderId: "blue" },
        sections: [
          {
            count: 1,
            color: "path",
            path: light("one", "192.168.1.2").sections[0]?.path,
            source: { kind: "remote", senderId: "red" },
          },
        ],
      },
    ],
  };
  expect(engine.previewFor(setup, 1000, "one")?.bgra.subarray(0, 3)).toEqual(
    Buffer.from([255, 0, 0]),
  );
  expect(engine.previewFor(setup, 1000, "one", 0)?.bgra.subarray(0, 3)).toEqual(
    Buffer.from([0, 0, 255]),
  );
});
