import type { Section } from "./types.js";

/**
 * `sections` fitted to `total` segments: each keeps at least one, the last takes
 * whatever is left, and ones that don't fit are dropped. Always at least one.
 */
export function fitSections(sections: readonly Section[], total: number): Section[] {
  const out: Section[] = [];
  let left = Math.max(1, total);
  for (const s of sections) {
    if (left === 0) break;
    const count = Math.min(Math.max(1, s.count), left);
    out.push({ ...s, count });
    left -= count;
  }
  if (out.length === 0) out.push({ count: 0, color: "path" });
  const last = out[out.length - 1] as Section;
  last.count += left;
  return out;
}
