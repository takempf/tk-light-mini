import { useState } from "react";
import { api } from "../lib/api";
import { sectionStarts, sectionsOf, segmentCount, segmentSources } from "../lib/lights";
import {
  edgeLoop,
  flipPath,
  linePath,
  removePoints,
  resolvePath,
  reversePath,
  startAt,
  unresolvePath,
} from "../lib/path";
import type { AddedDevice, Fit, LightPath, Source } from "../lib/types";
import { useScreenAspect, useStore } from "../store";
import { Button, Icon, Input, Switch, Toggle, ToggleGroup } from "../ui";
import { ColorPicker } from "./ColorPicker";
import { SegmentBar } from "./SegmentBar";
import { pct, Slider } from "./Slider";

const DEFAULT_WIDTH = 0.12;

/** The one source all of `sources` share, if they do. */
const shared = (sources: Source[]) =>
  sources.every((s) => s === sources[0]) ? sources[0] : undefined;

const FITS: { value: Fit; label: string }[] = [
  { value: "exact", label: "Exact" },
  { value: "fit", label: "Fit" },
  { value: "auto", label: "Auto" },
];

/** How a path sizes to the screen on one axis. */
function FitRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Fit;
  onChange: (f: Fit) => void;
}) {
  return (
    <div className="fit-row">
      <span className="meta">{label}</span>
      <ToggleGroup
        size="sm"
        aria-label={`${label} fit`}
        value={[value]}
        onValueChange={(v: string[]) => v[0] && onChange(v[0] as Fit)}
      >
        {FITS.map((f) => (
          <Toggle key={f.value} value={f.value} aria-label={`${label}: ${f.label}`}>
            {f.label}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** Where a section is on screen, and the tools to place it. */
function Placement({ device, section }: { device: AddedDevice; section: number }) {
  const setPath = useStore((s) => s.setSectionPath);
  const drawing = useStore((s) => s.drawing);
  const setDrawing = useStore((s) => s.setDrawing);
  const aspect = useScreenAspect();
  // Settings change the saved path; point edits happen on the fitted one,
  // which is what's on screen, and map back.
  const path = sectionsOf(device)[section]?.path;
  const shown = path && resolvePath(path, aspect);
  const fit = path?.fit ?? { x: "exact", y: "exact" };
  const setFit = (axis: "x" | "y", f: Fit) =>
    path && place({ ...path, fit: { ...fit, [axis]: f } });
  // Auto follows the other side, so it needs that side on Fit.
  const idle = (fit.x === "auto" && fit.y !== "fit") || (fit.y === "auto" && fit.x !== "fit");
  const width = path?.width ?? DEFAULT_WIDTH;
  const place = (p: LightPath | undefined) => {
    setDrawing(false);
    setPath(device.id, section, p);
  };
  const draw = () => {
    // Drawing first, so the whole drawing is one undo step.
    setDrawing(true);
    setPath(device.id, section, { points: [], width, closed: false });
  };
  return (
    <div className="stack placement">
      <span className="meta">
        Placement · {path ? `${path.points.length} points` : "not placed"}
      </span>
      <div className="button-row">
        {drawing ? (
          <Button size="sm" variant="primary" onClick={() => setDrawing(false)}>
            Done drawing
          </Button>
        ) : (
          <Button size="sm" onClick={draw}>
            {path ? "Redraw" : "Draw"}
          </Button>
        )}
        <Button size="sm" onClick={() => place(edgeLoop(aspect, width))}>
          Edge loop
        </Button>
        <Button size="sm" onClick={() => place(linePath(width))}>
          Line
        </Button>
      </div>
      {path && !drawing && (
        <>
          <Switch
            checked={path.closed}
            onCheckedChange={(closed: boolean) => place({ ...path, closed })}
          >
            Closed loop
          </Switch>
          <FitRow label="Horizontal" value={fit.x} onChange={(f) => setFit("x", f)} />
          <FitRow label="Vertical" value={fit.y} onChange={(f) => setFit("y", f)} />
          {idle && <p className="meta">Auto follows the other side once it's set to Fit.</p>}
          <Slider
            label="Thickness"
            value={path.width}
            min={0.02}
            max={1}
            step={0.01}
            format={pct}
            onChange={(w) => place({ ...path, width: w })}
          />
          <div className="button-row">
            <Button
              size="sm"
              disabled={path.points.length < 2}
              onClick={() => place(reversePath(path))}
            >
              Reverse
            </Button>
            <Button size="sm" onClick={() => place(flipPath(path, "x"))}>
              Flip ↔
            </Button>
            <Button size="sm" onClick={() => place(flipPath(path, "y"))}>
              Flip ↕
            </Button>
            <Button size="sm" variant="danger" onClick={() => place(undefined)}>
              Remove from screen
            </Button>
          </div>
          {shown && (
            <PickedPoints path={shown} onChange={(p) => place(unresolvePath(p, path, aspect))} />
          )}
        </>
      )}
    </div>
  );
}

/** Exact position of a picked point, and what to do with picked points. */
function PickedPoints({ path, onChange }: { path: LightPath; onChange: (p: LightPath) => void }) {
  const points = useStore((s) => s.points);
  const setPoints = useStore((s) => s.setPoints);
  const picked = points.filter((i) => i < path.points.length);
  if (picked.length === 0) return null;
  const one = picked.length === 1 ? (picked[0] as number) : undefined;
  const pt = one === undefined ? undefined : path.points[one];
  const setAxis = (axis: 0 | 1, v: number) => {
    if (one === undefined || !pt || Number.isNaN(v)) return;
    const q: [number, number] = [...pt];
    q[axis] = Math.min(1, Math.max(0, v / 100));
    onChange({ ...path, points: path.points.map((p, i) => (i === one ? q : p)) });
  };
  const round = (v: number) => Math.round(v * 1000) / 10;
  return (
    <div className="stack picked">
      <span className="meta">
        {one === undefined ? `${picked.length} points picked` : `Point ${one + 1}`}
      </span>
      {pt && (
        <div className="point-fields">
          <Input
            size="sm"
            type="number"
            aria-label="X, % from the left"
            min={0}
            max={100}
            step={0.1}
            value={round(pt[0])}
            onChange={(e) => setAxis(0, e.target.valueAsNumber)}
          />
          <Input
            size="sm"
            type="number"
            aria-label="Y, % from the top"
            min={0}
            max={100}
            step={0.1}
            value={round(pt[1])}
            onChange={(e) => setAxis(1, e.target.valueAsNumber)}
          />
        </div>
      )}
      <div className="button-row">
        {one !== undefined && one > 0 && path.closed && (
          <Button
            size="sm"
            onClick={() => {
              onChange(startAt(path, one));
              setPoints([0]);
            }}
          >
            Start here
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            onChange(removePoints(path, picked));
            setPoints([]);
          }}
        >
          {one === undefined ? `Remove ${picked.length} points` : "Remove point"}
        </Button>
      </div>
    </div>
  );
}

/** One section's color, segments and placement. `selected` is in the section. */
function SectionEditor({
  device,
  section,
  selected,
  onSelect,
}: {
  device: AddedDevice;
  section: number;
  selected: number[];
  onSelect: (s: Set<number>) => void;
}) {
  const setSectionColor = useStore((s) => s.setSectionColor);
  const setSegmentColors = useStore((s) => s.setSegmentColors);
  const sections = sectionsOf(device);
  const sec = sections[section];
  if (!sec) return null;
  const start = sectionStarts(sections)[section] as number;
  const sources = segmentSources(device).slice(start, start + sec.count);
  const name = device.name || device.sku;
  const target =
    selected.length === 0
      ? sections.length > 1
        ? "Whole section"
        : "Whole light"
      : selected.length === 1
        ? `Segment ${start + (selected[0] ?? 0) + 1}`
        : `${selected.length} segments`;
  const overridden = selected.some((i) => device.segmentColors?.[start + i] != null);
  return (
    <div className="stack">
      {device.razer && sec.count > 1 && (
        <SegmentBar
          label={`Segments of ${name}`}
          ip={device.ip}
          offset={start}
          sources={sources}
          selected={new Set(selected)}
          onSelect={onSelect}
        />
      )}
      <div className="stack">
        <span className="meta">Color · {target}</span>
        <ColorPicker
          label={`Color for ${name}`}
          ip={device.ip}
          index={start + (selected[0] ?? 0)}
          value={selected.length ? shared(selected.map((i) => sources[i] as Source)) : sec.color}
          onPick={(c) =>
            selected.length
              ? setSegmentColors(
                  device.id,
                  selected.map((i) => start + i),
                  c,
                )
              : setSectionColor(device.id, section, c)
          }
          extra={
            overridden && (
              <button
                type="button"
                className="swatch-button"
                onClick={() =>
                  setSegmentColors(
                    device.id,
                    selected.map((i) => start + i),
                    null,
                  )
                }
              >
                Follow section
              </button>
            )
          }
        />
      </div>
      <Placement device={device} section={section} />
    </div>
  );
}

/** Everything about one light, and the section being edited. */
export function Inspector({ device, section }: { device: AddedDevice; section: number }) {
  const select = useStore((s) => s.select);
  const rename = useStore((s) => s.renameDevice);
  const remove = useStore((s) => s.removeDevice);
  const setBrightness = useStore((s) => s.setDeviceBrightness);
  const setPower = useStore((s) => s.setPower);
  const setRazer = useStore((s) => s.setRazer);
  const setSegments = useStore((s) => s.setSegments);
  const split = useStore((s) => s.splitSection);
  const merge = useStore((s) => s.mergeSections);
  // Picked segments, in the section they were picked in.
  const [picked, setPicked] = useState<{ section: number; set: Set<number> }>({
    section,
    set: new Set(),
  });
  const name = device.name || device.sku;
  const sections = sectionsOf(device);
  const k = Math.min(section, sections.length - 1);
  const starts = sectionStarts(sections);
  const count = sections[k]?.count ?? 1;
  const selected =
    picked.section === k ? [...picked.set].filter((i) => i < count).sort((a, b) => a - b) : [];
  // Split before the first picked segment, or in half.
  const cut = selected[0] ? selected[0] : undefined;
  const range = (i: number) => {
    const s = starts[i] as number;
    const n = sections[i]?.count ?? 1;
    return n > 1 ? `${s + 1}–${s + n}` : `${s + 1}`;
  };

  return (
    <div className="inspector stack">
      <header className="inspector-head">
        <Button variant="ghost" size="sm" aria-label="Back to lights" onClick={() => select(null)}>
          <Icon name="chevron-left" />
          Lights
        </Button>
        <Switch
          aria-label={`Power for ${name}`}
          checked={device.on}
          onCheckedChange={(on: boolean) => setPower(device.id, on)}
        />
      </header>
      <Input
        size="sm"
        aria-label={`Name for ${device.id}`}
        value={device.name}
        onChange={(e) => rename(device.id, e.target.value)}
      />
      <span className="meta">
        {device.sku} · {device.ip}
      </span>
      <Slider
        label="Brightness"
        value={device.brightness}
        min={0}
        max={1.5}
        step={0.05}
        format={pct}
        onChange={(v) => setBrightness(device.id, v)}
      />
      <Switch checked={device.razer} onCheckedChange={(on: boolean) => setRazer(device.id, on)}>
        Razer streaming (experimental)
      </Switch>
      {device.razer && (
        <Slider
          label="Segments"
          value={segmentCount(device)}
          min={1}
          max={100}
          step={1}
          format={String}
          onChange={(v) => setSegments(device.id, v)}
        />
      )}
      {device.razer && (
        <div className="stack">
          <span className="meta">Sections</span>
          <div className="section-tabs">
            {sections.map((_, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: sections are positions
                key={i}
                type="button"
                className="section-tab"
                aria-pressed={i === k}
                aria-label={`Section ${i + 1}, segments ${range(i)}`}
                onClick={() => select({ id: device.id, section: i })}
              >
                <span>{i + 1}</span>
                <span className="meta">{range(i)}</span>
              </button>
            ))}
          </div>
          <div className="button-row">
            <Button
              size="sm"
              disabled={count < 2}
              onClick={() => {
                split(device.id, k, cut);
                setPicked({ section: k, set: new Set() });
              }}
            >
              {cut ? `Split before ${(starts[k] as number) + cut + 1}` : "Split in half"}
            </Button>
            <Button
              size="sm"
              disabled={k >= sections.length - 1}
              onClick={() => merge(device.id, k)}
            >
              Merge with next
            </Button>
          </div>
        </div>
      )}
      <SectionEditor
        device={device}
        section={k}
        selected={selected}
        onSelect={(set) => setPicked({ section: k, set })}
      />
      <div className="button-row inspector-actions">
        <Button size="sm" onClick={() => api.identifyDevice(device.ip).catch(() => {})}>
          Identify
        </Button>
        <Button size="sm" variant="danger" onClick={() => remove(device.id)}>
          Remove light
        </Button>
      </div>
    </div>
  );
}
