import { useLive } from "../store";
import { hexRgb, isLive } from "./colors";
import type { Source } from "./types";

/**
 * Segment `index`'s current color on light `ip`: live ones follow the screen,
 * fixed ones don't. Re-renders only when that color changes.
 */
export function useSourceColor(source: Source, ip: string, index: number) {
  const live = useLive((s) => (isLive(source) ? s.paths[ip]?.[index] : undefined));
  return isLive(source) ? live : hexRgb(source);
}
