import { memo, useMemo } from "react";
import type { bandRegions } from "../lib/path";

/**
 * Paint adjacent regions of the same color as one path, without seams at
 * joins. `colors` has one CSS color per segment.
 */
export const BandFill = memo(function BandFill({
  regions,
  colors,
  className,
}: {
  regions: ReturnType<typeof bandRegions>;
  colors: readonly string[];
  className: string;
}) {
  // Geometry changes far less often than colors.
  const shapes = useMemo(
    () =>
      regions
        .slice()
        .reverse()
        .map((region) => ({
          segment: region.segment,
          d: `${region.points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("")}Z`,
        })),
    [regions],
  );
  const runs: { fill: string; d: string }[] = [];
  for (const { segment, d } of shapes) {
    const fill = colors[segment] ?? "#333";
    const last = runs.at(-1);
    if (last?.fill === fill) last.d += ` ${d}`;
    else runs.push({ fill, d });
  }
  return runs.map(({ fill, d }, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: runs are ordered paint layers
    <path key={i} className={className} d={d} style={{ fill }} />
  ));
});
