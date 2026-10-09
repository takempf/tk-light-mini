import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { ScenePainter } from "./scenes.js";

const names = ["forest", "sunset", "aurora", "sea", "lava", "fire"];

it("paints every scene as an opaque, varied BGRA image", () => {
  for (const name of names) {
    const image = new ScenePainter().paint(name, 1000);
    expect(image.bgra).toHaveLength(128 * 72 * 4);
    const colors = new Set<string>();
    for (let i = 0; i < image.bgra.length; i += 4) {
      expect(image.bgra[i + 3]).toBe(255);
      colors.add(image.bgra.subarray(i, i + 3).toString("hex"));
    }
    expect(colors.size).toBeGreaterThan(1);
  }
});

it("moves scenes over time and keeps fire state between frames", () => {
  for (const name of names) {
    const painter = new ScenePainter();
    const first = painter.paint(name, 1000).bgra;
    const second = painter.paint(name, 10_000).bgra;
    expect(second.equals(first), name).toBe(false);
  }
});

it("matches frames rendered by the original Rust painter", () => {
  // RGB SHA-256 of the PPM output from:
  // cargo test --manifest-path src-tauri/Cargo.toml render_canvases -- --ignored
  const golden: Record<string, [string, string]> = {
    forest: [
      "37c6854dde88f6cd9a612dbb96bd0c7cf3220f2352a75539d7590a63817e2039",
      "ba6422f423d252657ad51e45dcdae11c051acea87376491f2ff6560265a8b4b0",
    ],
    sunset: [
      "e5e2691ec091e17d95b25f0aef5cf33d88a01ca2d1b1184b1f3d1277e7be1a55",
      "2a86c97370ad8889029408144a87c7d01a2e8dc6525de8524b8a921e54158e47",
    ],
    aurora: [
      "0fb204988e0b28b82bba1f25c82c3c0bfdd7ca86fe93f93385ee9cf9a97ee019",
      "37e71f82236fdb409a3ba301bdd7de716ad07623ed79eaf1d6d6d36e6cd5a903",
    ],
    sea: [
      "1beffc8a94fc596f8de612f2f4a202b94dec5c434a9c1df201e0301effe65c55",
      "2484cde84273fd473c3aa0d6cf8b992232fec18dce7d4ac57fd2a927c191c497",
    ],
    lava: [
      "4f770c1ded12f8a49f54edea9367ac2b4b35865ca9b27e1d46e395ec3db9941d",
      "86d0cf5c6bce83d94b9213ad7bbda1ccff313c0e4a85cd71eb6b5d2346af759b",
    ],
    fire: [
      "c8d1e9d893b747fb7fd266d741ffb7c494da07ef09cfa32d5e630b1a4abcbd99",
      "88260dae9898181781efa304c02958ab16d1d00737e3223cf5627bd88fb12e9f",
    ],
  };
  for (const name of names) {
    const painter = new ScenePainter();
    for (const [index, t] of [5, 40].entries()) {
      let frame = painter.paint(name, (t - 1) * 1000);
      for (let k = 1; k < 30; k++) frame = painter.paint(name, (t - 1 + k / 30) * 1000);
      const rgb = Buffer.alloc(frame.width * frame.height * 3);
      for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
        rgb[pixel * 3] = frame.bgra[pixel * 4 + 2] ?? 0;
        rgb[pixel * 3 + 1] = frame.bgra[pixel * 4 + 1] ?? 0;
        rgb[pixel * 3 + 2] = frame.bgra[pixel * 4] ?? 0;
      }
      expect(createHash("sha256").update(rgb).digest("hex"), `${name} frame ${index}`).toBe(
        golden[name]?.[index],
      );
    }
  }
});
