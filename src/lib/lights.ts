import { linePath } from "./path";
import { type AddedDevice, defaultSegments, type Section, type Source } from "./types";

/** Segments the light shows: its razer count, or one without razer mode. */
export const segmentCount = (d: AddedDevice) =>
  d.razer ? Math.max(1, d.segments ?? defaultSegments(d.sku)) : 1;

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

/** The light's sections, fitted to its segments. */
export const sectionsOf = (d: AddedDevice) => fitSections(d.sections, segmentCount(d));

/** Display name for one section; the default follows its current position. */
export const sectionName = (section: Section, index: number) =>
  section.name?.trim() || `Section ${index + 1}`;

/** Where each section starts, in segments. */
export function sectionStarts(sections: readonly Section[]): number[] {
  let at = 0;
  return sections.map((s) => {
    const start = at;
    at += s.count;
    return start;
  });
}

/** Each segment's color, first to last. */
export function segmentSources(d: AddedDevice): Source[] {
  const sections = sectionsOf(d);
  const starts = sectionStarts(sections);
  return sections.flatMap((s, k) =>
    Array.from({ length: s.count }, (_, i) => d.segmentColors?.[(starts[k] ?? 0) + i] ?? s.color),
  );
}

/** The section that segment `i` is in. */
export function sectionAt(sections: readonly Section[], i: number): number {
  const starts = sectionStarts(sections);
  for (let k = starts.length - 1; k >= 0; k--) {
    if (i >= (starts[k] as number)) return k;
  }
  return 0;
}

/**
 * Split section `k` after `at` of its segments (default: half). The new second
 * part keeps the color and starts as a horizontal path across the middle.
 */
export function splitSection(sections: readonly Section[], k: number, at?: number): Section[] {
  const s = sections[k];
  if (!s || s.count < 2) return [...sections];
  const first = Math.min(Math.max(1, at ?? Math.floor(s.count / 2)), s.count - 1);
  const tail: Section = { count: s.count - first, color: s.color, path: linePath(s.path?.width) };
  if (s.on !== undefined) tail.on = s.on;
  return [...sections.slice(0, k), { ...s, count: first }, tail, ...sections.slice(k + 1)];
}

/** Join section `k` with the next. It keeps `k`'s color and path. */
export function mergeSections(sections: readonly Section[], k: number): Section[] {
  const [a, b] = [sections[k], sections[k + 1]];
  if (!a || !b) return [...sections];
  return [...sections.slice(0, k), { ...a, count: a.count + b.count }, ...sections.slice(k + 2)];
}
