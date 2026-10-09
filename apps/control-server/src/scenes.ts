import type { Frame, Rgb } from "./types.js";

// TypeScript port of the small, dithered canvases in src-tauri/src/visuals.rs.
const palette = (values: number[]): Rgb[] =>
  values.map((value) => [(value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
const NIGHT = palette([
  0x080a12, 0x0e1422, 0x172036, 0x222e4a, 0x34425f, 0x4e5c7a, 0x7582a0, 0xaab4c8,
]);
const PINE = palette([0x030504, 0x070c0b, 0x0c1614, 0x13211f, 0x1c2e2c]);
const DUSK = palette([
  0x1a0f2e, 0x2d1543, 0x4d1b56, 0x7a2160, 0xa8305e, 0xd34d52, 0xef7b45, 0xf9a94b, 0xffd57e,
  0xfff2c2,
]);
const TIDE = palette([
  0x0b0616, 0x1a0f2e, 0x2d1543, 0x4d1b56, 0x7a2160, 0xd34d52, 0xf9a94b, 0xffd57e,
]);
const POLAR = palette([
  0x03050b, 0x071322, 0x0b2a33, 0x0f4d45, 0x178057, 0x2fb56c, 0x7fe39a, 0xd8ffc8,
]);
const VIOLET = palette([0x03050b, 0x0d0b24, 0x1f1440, 0x3a1d5e, 0x62307e]);
const SNOW = palette([0x070b16, 0x0e1828, 0x172a3c, 0x24424e, 0x3b6a68]);
const DEEP = palette([
  0x020a12, 0x04192a, 0x062a3f, 0x0a3f55, 0x0f5a6b, 0x1a7a80, 0x34a39a, 0x7fd3c0, 0xd4fff0,
]);
const LAVA = palette([
  0x12061c, 0x2a0b33, 0x4d1040, 0x7c1a45, 0xb32c3f, 0xe0503a, 0xf78a3d, 0xffc15e, 0xfff0a8,
]);
const EMBER = palette([
  0x070203, 0x1f0705, 0x3d0c06, 0x661605, 0x962508, 0xc43d0a, 0xe8650f, 0xf7931e, 0xffc24a,
  0xffe89a,
]);
const FIREFLY: Rgb = [212, 228, 110];
const STAR: Rgb = [200, 212, 240];
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const ramp = (colors: Rgb[], value: number, x: number, y: number): Rgb => {
  const top = colors.length - 1;
  const p = clamp(value) * top;
  const lo = Math.floor(p);
  const threshold = ((BAYER[y & 3]?.[x & 3] ?? 0) + 0.5) / 16;
  return colors[Math.min(top, lo + Number(p - lo > threshold))] ?? [0, 0, 0];
};
const hash = (x: number, y: number) => {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841);
  h = Math.imul(h ^ (h >>> 13), 0xcb1ab31f);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
};
const noise = (x: number, y: number) => {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const fx = x - xi,
    fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  return lerp(
    lerp(hash(xi, yi), hash(xi + 1, yi), sx),
    lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), sx),
    sy,
  );
};
const fbm = (x: number, y: number, octaves: number) => {
  let sum = 0,
    amp = 0.5,
    norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x, y);
    norm += amp;
    amp *= 0.5;
    x = x * 2 + 17.3;
    y = y * 2 + 5.1;
  }
  return sum / norm;
};

class Pines {
  constructor(
    private spacing: number,
    private min: number,
    private max: number,
    private seed: number,
  ) {}
  hit(x: number, y: number, base: number): boolean {
    if (y >= base) return true;
    const i = Math.floor(x / this.spacing);
    for (let k = i - 2; k <= i + 2; k++) {
      const height = lerp(this.min, this.max, hash(k, this.seed));
      const top = base - height;
      if (y < top) continue;
      const cx = (k + 0.2 + 0.6 * hash(k, this.seed + 1)) * this.spacing;
      const down = y - top;
      const tier = (down / Math.max(height * 0.2, 2)) % 1;
      if (Math.abs(x - cx) <= down * 0.3 * (0.65 + 0.35 * tier) + 0.3) return true;
    }
    return false;
  }
}

function paintPixels(
  bgra: Buffer,
  width: number,
  height: number,
  pixel: (x: number, y: number, u: number, v: number) => Rgb,
) {
  const k = 72 / height;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y, x * k, y * k);
      const offset = (y * width + x) * 4;
      bgra[offset] = b;
      bgra[offset + 1] = g;
      bgra[offset + 2] = r;
      bgra[offset + 3] = 255;
    }
}

export class ScenePainter {
  private heat = new Uint8Array(0);
  private clock = 0;
  private rng = 0;

  paint(name: string, at: number, width = 128, height = 72): Frame {
    const bgra = Buffer.alloc(width * height * 4);
    const t = at / 1000;
    const canvasWidth = (width * 72) / height;
    if (name === "forest") {
      const rows = [
        { pines: new Pines(13, 26, 44, 3), base: 64, speed: 2.4, shade: 0.02 },
        { pines: new Pines(8, 13, 24, 2), base: 54, speed: 1.2, shade: 0.45 },
        { pines: new Pines(5, 8, 15, 1), base: 47, speed: 0.6, shade: 0.85 },
      ];
      const moonX = canvasWidth * 0.74,
        moonY = 14;
      paintPixels(bgra, width, height, (x, y, u, v) => {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row) continue;
          const wx = u + t * row.speed;
          const ground = row.base + 3 * (noise(wx * 0.04, i * 7) - 0.5);
          if (row.pines.hit(wx, v, ground)) {
            const mist =
              i === 0
                ? 0
                : 0.35 *
                  smoothstep(ground - 10, ground + 4, v) *
                  fbm(u * 0.05 + t * 0.03, v * 0.2 + i, 2);
            return ramp(PINE, row.shade + mist, x, y);
          }
        }
        const dm = Math.hypot(u - moonX, v - moonY);
        const glow = Math.exp((-dm * dm) / 500);
        const cloud = fbm(u * 0.035 + t * 0.012, v * 0.08 - t * 0.003, 4);
        const cover = smoothstep(0.42, 0.62, cloud);
        const sky = 0.2 + 0.25 * (v / 50) + 0.45 * glow;
        const lit = 0.08 + 0.75 * glow + 0.3 * (cloud - 0.5);
        const shade = dm < 4 && cover < 0.6 ? 1 : lerp(sky, lit, cover);
        return ramp(NIGHT, shade, x, y);
      });
      for (let i = 0; i < 6; i++) {
        if (Math.sin(t * 0.8 + i * 1.7) < 0.4) continue;
        const fx = hash(i, 90) * canvasWidth + 4 * Math.sin(t * 0.21 + i);
        const fy = 58 + 10 * hash(i, 91) + 2 * Math.sin(t * 0.17 + i * 2);
        const x = Math.trunc((fx * height) / 72),
          y = Math.trunc((fy * height) / 72);
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const offset = (y * width + x) * 4;
        bgra.set([FIREFLY[2], FIREFLY[1], FIREFLY[0], 255], offset);
      }
    } else if (name === "sunset") {
      const horizon = 44,
        sunX = canvasWidth * 0.6,
        sunY = horizon - 5 + 1.5 * Math.sin(t * 0.05),
        sunR = 7;
      paintPixels(bgra, width, height, (x, y, u, v) => {
        const dx = u - sunX;
        if (v < horizon) {
          const d = Math.hypot(dx, v - sunY);
          if (d < sunR) return ramp(DUSK, 0.9 + 0.1 * (1 - d / sunR), x, y);
          const glow = Math.exp((-d * d) / 900);
          const sky = 0.85 * (v / horizon) ** 1.6 + 0.35 * glow;
          const n = fbm(u * 0.025 + t * 0.01, v * 0.22, 4);
          const cover = smoothstep(0.52, 0.64, n) * smoothstep(4, 12, v);
          const cloud = 0.12 + 0.2 * (v / horizon) + 0.55 * glow;
          return ramp(DUSK, lerp(sky, cloud, cover), x, y);
        }
        const depth = (v - horizon) / (72 - horizon);
        const ripple = fbm(u * 0.05, (v - horizon) * 0.6 - t * 0.25, 2);
        let shade = 0.6 * (1 - depth) ** 2 + 0.1 * (ripple - 0.5);
        const spread = sunR * (1 + depth * 3);
        const path = Math.exp((-dx * dx) / (spread * spread));
        const glint = fbm(u * 0.12 + t * 0.05, (v - horizon) * 1.1 - t * 0.6, 2);
        shade += path * (0.25 + 0.7 * smoothstep(0.45, 0.65, glint)) * (1 - 0.5 * depth);
        return ramp(TIDE, shade, x, y);
      });
    } else if (name === "aurora") {
      const pines = new Pines(7, 5, 13, 11);
      paintPixels(bgra, width, height, (x, y, u, v) => {
        let green = 0,
          violet = 0;
        for (let j = 0; j < 2; j++) {
          const phase = (u / canvasWidth) * Math.PI * 2 * (0.7 + 0.3 * j);
          const edge =
            30 +
            8 * j +
            6 * Math.sin(phase + t * (0.06 + 0.03 * j)) +
            8 * (noise(u * 0.03 + t * 0.04, j * 10) - 0.5);
          const up = edge - v;
          if (up < -3) continue;
          const fall = up < 0 ? Math.exp(up * 1.2) : Math.exp(-up / 16);
          const rays = 0.45 + 0.55 * noise(u * 0.35 + t * 0.15, t * 0.1 + j * 4);
          const reach = smoothstep(0.3, 0.7, noise(u * 0.02 - t * 0.02, j * 3 + 1));
          const a = fall * rays * reach;
          green += a * (1 - smoothstep(6, 22, up));
          violet += 0.4 * a * smoothstep(10, 26, up);
        }
        const hill = 60 + 4 * (noise(u * 0.05, 5) - 0.5);
        if (v >= hill || pines.hit(u, v, hill + 1.5)) {
          if (v < hill) return PINE[0] ?? [0, 0, 0];
          const depth = (v - hill) / (72 - hill);
          return ramp(SNOW, 0.35 + 0.4 * Math.min(green, 1) - 0.3 * depth, x, y);
        }
        if (green + violet < 0.08 && hash(x, y) > 0.985) {
          const twinkle = Math.sin(t * 1.5 + hash(y, x) * 40);
          return twinkle > -0.3 ? STAR : (VIOLET[2] ?? [0, 0, 0]);
        }
        if (green > 0.1 && green >= violet) return ramp(POLAR, 0.08 + green * 0.9, x, y);
        const sky = 0.14 + 0.24 * (v / hill) ** 2;
        return ramp(VIOLET, sky + violet, x, y);
      });
    } else if (name === "sea") {
      paintPixels(bgra, width, height, (x, y, u, v) => {
        const d = v / 72;
        let shade = 0.62 * (1 - d) ** 1.5;
        const ray = noise((u + v * 0.45) * 0.07 + t * 0.03, t * 0.05);
        shade += 0.3 * smoothstep(0.55, 0.8, ray) * (1 - d);
        const a = noise(u * 0.12 + t * 0.12, v * 0.16 - t * 0.07);
        const b = noise(u * 0.1 - t * 0.09, v * 0.13 + t * 0.1);
        const web = Math.max(0, 1 - Math.abs(a - b) * 6) ** 3;
        shade += 0.45 * web * (1 - d) ** 3;
        const flake = hash(x, Math.floor(v - t * 1.2));
        if (flake > 0.994 && d > 0.3) shade += 0.25;
        return ramp(DEEP, shade, x, y);
      });
    } else if (name === "lava") {
      const blobs = Array.from({ length: 7 }, (_, i) => {
        const x = canvasWidth * (0.5 + 0.4 * Math.sin(t * (0.031 + 0.011 * i) + i * 2.1));
        const y = 36 + 30 * Math.sin(t * (0.043 + 0.009 * i) + i * 1.3);
        const r = 7 + 5 * hash(i, 40);
        return { x, y, r2: r * r };
      });
      paintPixels(bgra, width, height, (x, y, u, v) => {
        let field = 0;
        for (const blob of blobs) field += blob.r2 / ((u - blob.x) ** 2 + (v - blob.y) ** 2 + 1);
        const bg = 0.05 + 0.12 * (v / 72) ** 2;
        const shade = field < 1 ? bg + 0.3 * field * field : 0.5 + 0.5 * smoothstep(1, 4, field);
        return ramp(LAVA, shade, x, y);
      });
    } else if (name === "fire") {
      this.paintFire(bgra, width, height, t);
    } else throw new Error(`Unknown scene: ${name}`);
    return { width, height, bgra, sequence: 0, capturedAt: at };
  }

  private next() {
    let x = Math.max(1, this.rng);
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng;
  }

  private paintFire(bgra: Buffer, width: number, height: number, t: number) {
    const step = 1 / 30;
    const max = Math.trunc(Math.min(255, Math.max(8, height * 0.36)));
    if (this.heat.length !== width * height) {
      this.heat = new Uint8Array(width * height);
      this.clock = t;
    }
    if (t - this.clock > 4 * step) this.clock = t - 4 * step;
    while (this.clock < t) {
      this.clock += step;
      const base = (height - 1) * width;
      for (let x = 0; x < width; x++) {
        const glow = 0.75 + 0.25 * noise(x * 0.12, this.clock * 0.7);
        this.heat[base + x] = Math.trunc(max * glow);
      }
      for (let y = 1; y < height; y++)
        for (let x = 0; x < width; x++) {
          const roll = this.next() & 3;
          const to = (x - roll + 1 + width) % width;
          this.heat[(y - 1) * width + to] = Math.max(
            0,
            (this.heat[y * width + x] ?? 0) - (roll & 1),
          );
        }
    }
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const heat = (this.heat[y * width + x] ?? 0) / max;
        const room = 0.2 * (y / height) ** 1.5;
        const [r, g, b] = ramp(EMBER, Math.max(heat, room), x, y);
        const i = (y * width + x) * 4;
        bgra.set([b, g, r, 255], i);
      }
  }
}
