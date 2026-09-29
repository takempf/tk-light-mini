import { useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useLive } from "../store";
import { css, hexRgb, isLive } from "./colors";
import type { Rgb, Source } from "./types";

const NONE: readonly (Rgb | undefined)[] = [];

/**
 * Segment `index`'s current color on light `ip`: live ones follow the screen,
 * fixed ones don't. Re-renders only when that color changes (the sync keeps
 * unchanged colors as they were).
 */
export function useSourceColor(source: Source, ip: string, index: number) {
  const live = useLive((s) => (isLive(source) ? s.paths[ip]?.[index] : undefined));
  return isLive(source) ? live : hexRgb(source);
}

/**
 * Live colors of segments `start` to `start + count` on light `ip`.
 * Re-renders only when one of them changes. Off (`on` false), it holds the
 * last colors and stops following, for something shown but faded out.
 */
export function useLiveColors(
  ip: string,
  start: number,
  count: number,
  on = true,
): readonly (Rgb | undefined)[] {
  const held = useRef<readonly (Rgb | undefined)[]>(NONE);
  const colors = useLive(
    useShallow((s) => {
      if (!on) return held.current;
      const all = s.paths[ip];
      return all ? all.slice(start, start + count) : NONE;
    }),
  );
  held.current = colors;
  return colors;
}

/**
 * CSS colors for `sources`, the segments from `start` on light `ip`. Follows
 * live colors only when some segment does and `on`.
 */
export function useSegmentCss(
  ip: string,
  start: number,
  sources: readonly Source[],
  on = true,
): string[] {
  const live = useLiveColors(ip, start, sources.length, on && sources.some(isLive));
  return useMemo(
    () => sources.map((s, i) => css(isLive(s) ? live[i] : hexRgb(s)) ?? "#333"),
    [sources, live],
  );
}
