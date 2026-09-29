import { memo, useId, useMemo } from "react";
import { bandRegions } from "../lib/path";

/** Clip a 2px centered stroke to the fill, leaving exactly 1px inside. */
export const ShapeOutline = memo(function ShapeOutline({
  points,
  closed,
  width,
}: {
  points: [number, number][];
  closed: boolean;
  width: number;
}) {
  const id = useId();
  const { regions, d } = useMemo(() => {
    const regions = bandRegions(points, closed, width, 1);
    const edges = regions.map(({ points: [a, b, c, d] }) => `M${a}L${b}M${c}L${d}`);
    if (!closed || points.length < 3) {
      const first = regions[0]?.points;
      const last = regions.at(-1)?.points;
      if (first && last) edges.push(`M${first[3]}L${first[0]}M${last[1]}L${last[2]}`);
    }
    return { regions, d: edges.join(" ") };
  }, [points, closed, width]);
  return (
    <g className="shape-outline">
      <defs>
        <clipPath id={id} clipPathUnits="userSpaceOnUse">
          {regions.map((region, i) => (
            <polygon
              // biome-ignore lint/suspicious/noArrayIndexKey: legs are ordered positions
              key={i}
              points={region.points.map((p) => p.join(",")).join(" ")}
            />
          ))}
        </clipPath>
      </defs>
      <path d={d} clipPath={`url(#${id})`} vectorEffect="non-scaling-stroke" />
    </g>
  );
});
