import { memo, useMemo } from "react";
import { sectionStarts, sectionsOf, segmentSources } from "../lib/lights";
import { useSegmentCss } from "../lib/live";
import { bandOffsets, bandRegions, resolvePath } from "../lib/path";
import type { AddedDevice, Source } from "../lib/types";
import { useScreenAspect } from "../store";
import { BandFill } from "./BandFill";
import { ShapeOutline } from "./ShapeOutline";

type Pt = [number, number];
const WIDTH = 56;
const HEIGHT = 40;
const PAD = 4;

/** One section's band in the thumbnail, fitted to it. */
interface Band {
  points: Pt[];
  closed: boolean;
  width: number;
  regions: ReturnType<typeof bandRegions>;
  start: number;
  sources: Source[];
}

/** Every section of `device` (or just `only`), fitted into the thumbnail. */
function thumbnailBands(device: AddedDevice, aspect: number, only?: number): Band[] {
  const sections = sectionsOf(device);
  const starts = sectionStarts(sections);
  const sources = segmentSources(device);
  const paths = sections.flatMap((section, k) => {
    if (only !== undefined && k !== only) return [];
    const path = section.path && resolvePath(section.path, aspect);
    const start = starts[k] ?? 0;
    return [
      {
        // Unplaced sections still show their colors as a short strip.
        points: path?.points.length
          ? path.points.map(([x, y]) => [x * aspect, y] as Pt)
          : ([
              [aspect * 0.2, (k + 1) / (sections.length + 1)],
              [aspect * 0.8, (k + 1) / (sections.length + 1)],
            ] as Pt[]),
        width: path?.width ?? 0.12,
        closed: path?.closed ?? false,
        start,
        sources: sources.slice(start, start + section.count),
      },
    ];
  });
  const bounds = paths.flatMap((p) => {
    const offsets = bandOffsets(p.points, p.closed, p.width / 2);
    return p.points.flatMap(([x, y], i) => {
      const [dx, dy] = offsets[i] as Pt;
      return [
        [x + dx, y + dy],
        [x - dx, y - dy],
      ] as Pt[];
    });
  });
  const left = Math.min(...bounds.map(([x]) => x));
  const top = Math.min(...bounds.map(([, y]) => y));
  const width = Math.max(...bounds.map(([x]) => x)) - left;
  const height = Math.max(...bounds.map(([, y]) => y)) - top;
  const scale = Math.min(
    (WIDTH - PAD * 2) / Math.max(width, 0.01),
    (HEIGHT - PAD * 2) / Math.max(height, 0.01),
  );
  const project = ([x, y]: Pt): Pt => [
    (WIDTH - width * scale) / 2 + (x - left) * scale,
    (HEIGHT - height * scale) / 2 + (y - top) * scale,
  ];
  return paths.map((p) => {
    const points = p.points.map(project);
    const band = Math.max(p.width * scale, 3);
    return {
      points,
      closed: p.closed,
      width: band,
      regions: bandRegions(points, p.closed, band, p.sources.length),
      start: p.start,
      sources: p.sources,
    };
  });
}

/** One band's segment colors. Re-renders only when they change. */
function ThumbnailFill({ ip, band }: { ip: string; band: Band }) {
  const colors = useSegmentCss(ip, band.start, band.sources);
  return <BandFill regions={band.regions} colors={colors} className="thumbnail-piece" />;
}

/** A fitted miniature of every section, with the same segment colors as the canvas. */
export const LightThumbnail = memo(function LightThumbnail({
  device,
  section,
}: {
  device: AddedDevice;
  section?: number;
}) {
  const aspect = useScreenAspect();
  const bands = useMemo(() => thumbnailBands(device, aspect, section), [device, aspect, section]);
  return (
    <svg className="light-thumbnail" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      {bands.map((band, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: sections are ordered positions
        <g key={k}>
          <ThumbnailFill ip={device.ip} band={band} />
          <ShapeOutline points={band.points} closed={band.closed} width={band.width} />
        </g>
      ))}
    </svg>
  );
});
