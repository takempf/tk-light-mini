import { useRef } from "react";
import type { Source } from "../lib/types";
import { Button } from "../ui";
import { css, useSourceColor } from "./ZonePreview";

function Cell({
  index,
  source,
  selected,
  onClick,
}: {
  index: number;
  source: Source;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const color = useSourceColor(source);
  return (
    <button
      type="button"
      className="segment"
      aria-label={`Segment ${index + 1}`}
      aria-pressed={selected}
      style={{ background: css(color) }}
      onClick={onClick}
    />
  );
}

/**
 * One cell per segment, in its current color. Click to select, shift-click to
 * select a range.
 */
export function SegmentBar({
  label,
  sources,
  selected,
  onSelect,
}: {
  label: string;
  sources: readonly Source[];
  selected: ReadonlySet<number>;
  onSelect: (s: Set<number>) => void;
}) {
  const anchor = useRef<number | null>(null);
  const click = (i: number, e: React.MouseEvent) => {
    const next = new Set(selected);
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [anchor.current, i].sort((x, y) => x - y) as [number, number];
      for (let j = a; j <= b; j++) next.add(j);
    } else if (next.has(i)) {
      next.delete(i);
    } else {
      next.add(i);
    }
    anchor.current = i;
    onSelect(next);
  };
  return (
    <div className="segment-bar">
      <fieldset className="segments" aria-label={label}>
        {sources.map((s, i) => (
          <Cell
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positions
            key={i}
            index={i}
            source={s}
            selected={selected.has(i)}
            onClick={(e) => click(i, e)}
          />
        ))}
      </fieldset>
      <div className="segment-actions">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSelect(new Set(sources.map((_, i) => i)))}
        >
          All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={selected.size === 0}
          onClick={() => onSelect(new Set())}
        >
          None
        </Button>
      </div>
    </div>
  );
}
