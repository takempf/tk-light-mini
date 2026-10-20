import {
  type CSSProperties,
  memo,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { sectionName, sectionStarts, sectionsOf } from "../lib/lights";
import { readSaved, saveLater } from "../lib/storage";
import type { AddedDevice, GoveeDevice } from "../lib/types";
import { useStore } from "../store";
import { Button, Eyebrow, Icon, Menu, Switch } from "../ui";
import { CanvasSettings } from "./CanvasSettings";
import { Inspector } from "./Inspector";
import { LightThumbnail } from "./LightThumbnail";

type Pane = "lights" | "details" | "canvas";
/** Each panel's share of the sidebar while open, in `fr`. */
type Sizes = Record<Pane, number>;

const SIZES_KEY = "tk-light-mini-panel-sizes";
/** Before the canvas panel resized: the Lights share of Lights and Details. */
const OLD_SPLIT_KEY = "tk-light-mini-panel-split";
const DEFAULT_SIZES: Sizes = { lights: 40, details: 60, canvas: 40 };
/** A panel keeps 20% to 80% of the pair a divider splits. */
const clampSplit = (value: number) => Math.max(20, Math.min(80, value));

function savedSizes(): Sizes {
  try {
    const saved: unknown = JSON.parse(readSaved(SIZES_KEY) ?? "null");
    if (saved && typeof saved === "object") {
      const sizes = { ...DEFAULT_SIZES };
      for (const pane of Object.keys(DEFAULT_SIZES) as Pane[]) {
        const v = (saved as Partial<Sizes>)[pane];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) sizes[pane] = v;
      }
      return sizes;
    }
  } catch {
    // Fall back to the old split, or the defaults.
  }
  const split = Number(readSaved(OLD_SPLIT_KEY) ?? 40);
  const lights = Number.isFinite(split) ? clampSplit(split) : 40;
  return { ...DEFAULT_SIZES, lights, details: 100 - lights };
}

/**
 * A bar between two open panels, `above` and `below`, that moves the line
 * between them by dragging or with the keyboard. Its value is `above`'s share
 * of the pair, in percent. Shown but inert when not `active`.
 */
function PaneDivider({
  label,
  active,
  className,
  controls,
  share,
  reset,
  measure,
  onResize,
  onResizing,
}: {
  label: string;
  active: boolean;
  className?: string;
  controls: string;
  share: number;
  /** The share a double-click goes back to. */
  reset: number;
  /** Both panels' height in pixels. */
  measure: () => number;
  onResize: (share: number) => void;
  onResizing: (on: boolean) => void;
}) {
  const drag = useRef<{ y: number; share: number; height: number; pointer: number } | null>(null);
  const resize = (value: number) => onResize(clampSplit(value));
  const endResize = () => {
    drag.current = null;
    onResizing(false);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator controls the pane sizes
    <div
      className={className ? `panel-divider ${className}` : "panel-divider"}
      aria-hidden={!active}
      tabIndex={active ? 0 : -1}
      role="separator"
      aria-label={label}
      aria-orientation="horizontal"
      aria-controls={controls}
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(share)}
      aria-valuetext={`${Math.round(share)}% and ${Math.round(100 - share)}%`}
      onPointerDown={(e) => {
        if (e.button !== 0 || !active) return;
        const height = measure();
        if (height <= 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, share, height, pointer: e.pointerId };
        onResizing(true);
      }}
      onPointerMove={(e) => {
        const start = drag.current;
        if (start && start.pointer === e.pointerId)
          resize(start.share + ((e.clientY - start.y) / start.height) * 100);
      }}
      onPointerUp={(e) => {
        if (drag.current?.pointer !== e.pointerId) return;
        endResize();
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={endResize}
      onLostPointerCapture={endResize}
      onDoubleClick={() => resize(reset)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 2;
        const values: Record<string, number> = {
          ArrowUp: share - step,
          ArrowDown: share + step,
          Home: 20,
          End: 80,
        };
        const value = values[e.key];
        if (value === undefined) return;
        e.preventDefault();
        resize(value);
      }}
    />
  );
}

/** A panel's open state, remembered across launches. */
function useSavedOpen(key: string, initial: boolean) {
  const [open, setOpen] = useState(() => {
    const saved = readSaved(key);
    return saved === null ? initial : saved === "true";
  });
  useEffect(() => saveLater(key, () => String(open)), [key, open]);
  return [open, setOpen] as const;
}

const COLLAPSED_KEY = "tk-light-mini-collapsed-lights";

/** Ids of lights whose sections are folded away. */
function collapsedLights(): string[] {
  try {
    const ids: unknown = JSON.parse(readSaved(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveCollapsed(id: string, collapsed: boolean) {
  const ids = collapsedLights().filter((other) => other !== id);
  if (collapsed) ids.push(id);
  saveLater(COLLAPSED_KEY, () => JSON.stringify(ids));
}

function PanelHeading({
  title,
  controls,
  expanded,
  onToggle,
}: {
  title: string;
  controls: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Eyebrow as="h2" className="panel-title">
      <button
        type="button"
        className="panel-title-button"
        aria-expanded={expanded}
        aria-controls={controls}
        onClick={onToggle}
      >
        <Icon name="chevron-right" />
        <span className="panel-title-text">{title}</span>
      </button>
    </Eyebrow>
  );
}

/** One light and its sections. Re-renders only when the light changes. */
const LightRow = memo(function LightRow({ device }: { device: AddedDevice }) {
  const [expanded, setExpanded] = useState(() => !collapsedLights().includes(device.id));
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setPower = useStore((s) => s.setPower);
  const setSectionPower = useStore((s) => s.setSectionPower);
  const setHoveredLight = useStore((s) => s.setHoveredLight);
  const name = device.name || device.sku;
  const sections = sectionsOf(device);
  const starts = sectionStarts(sections);
  const grouped = sections.length > 0;
  const active = selection?.id === device.id;
  return (
    <div
      className="light-group"
      onPointerEnter={() => setHoveredLight(device.id)}
      onPointerLeave={() => setHoveredLight(null)}
    >
      <div
        className="light"
        data-off={device.on ? undefined : ""}
        data-selected={(active && selection.section === null) || undefined}
      >
        {grouped ? (
          <button
            type="button"
            className="layer-expand"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
            aria-expanded={expanded}
            onClick={() => {
              saveCollapsed(device.id, expanded);
              setExpanded(!expanded);
            }}
          >
            <Icon name="chevron-right" />
          </button>
        ) : (
          <span className="layer-indent" />
        )}
        <button
          type="button"
          className="light-open"
          aria-label={`Edit ${name}`}
          aria-pressed={active && selection.section === null}
          onClick={() => select({ id: device.id, section: null })}
        >
          <LightThumbnail device={device} />
          <span className="light-name">{name}</span>
        </button>
        <Switch
          aria-label={`Power for ${name}`}
          checked={device.on}
          onCheckedChange={(on: boolean) => setPower(device.id, on)}
        />
      </div>
      {grouped && (
        // Kept mounted so collapsing can animate.
        <div className="layer-collapse" aria-hidden={!expanded} inert={!expanded}>
          <div className="layer-collapse-inner">
            <fieldset className="layer-children" aria-label={`Sections for ${name}`}>
              {sections.map((section, i) => {
                const start = starts[i] ?? 0;
                const range =
                  section.count > 1 ? `${start + 1}–${start + section.count}` : `${start + 1}`;
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: sections are ordered positions
                    key={i}
                    className="layer-path-row"
                    data-off={!device.on || section.on === false ? "" : undefined}
                    data-selected={(active && selection.section === i) || undefined}
                    onPointerEnter={() => setHoveredLight(device.id, i)}
                    onPointerLeave={() => setHoveredLight(device.id)}
                  >
                    <button
                      type="button"
                      className="light-open layer-path"
                      aria-label={`${sectionName(section, i)} (${range})`}
                      aria-pressed={active && selection.section === i}
                      onClick={() => select({ id: device.id, section: i })}
                    >
                      <LightThumbnail device={device} section={i} />
                      <span className="light-name">{sectionName(section, i)}</span>
                    </button>
                    <Switch
                      aria-label={`Power for ${name} ${sectionName(section, i)}`}
                      checked={section.on !== false}
                      onCheckedChange={(on: boolean) => setSectionPower(device.id, i, on)}
                    />
                  </div>
                );
              })}
            </fieldset>
          </div>
        </div>
      )}
    </div>
  );
});

/** A light the scan found that isn't added yet. */
function FoundRow({ device }: { device: GoveeDevice }) {
  const add = useStore((s) => s.addDevice);
  const name = device.sku || "Govee";
  return (
    <div className="light found">
      <span className="dot" />
      <span className="light-title">
        <span className="light-name">{name}</span>
        <span className="meta">
          {device.ip} · {device.id}
        </span>
      </span>
      <Button size="sm" aria-label={`Add ${name}`} onClick={() => add(device)}>
        Add
      </Button>
    </div>
  );
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Save the light setup to a file, or load one in its place. */
function SetupMenu({ onError }: { onError: (message: string | null) => void }) {
  const exportSetup = useStore((s) => s.exportSetup);
  const importSetup = useStore((s) => s.importSetup);
  const hasLights = useStore((s) => s.devices.length > 0);
  const run = (action: () => Promise<boolean>) => {
    onError(null);
    action().catch((e) => onError(errorText(e)));
  };
  return (
    <Menu.Root>
      <Menu.Trigger render={<Button variant="ghost" size="sm" square aria-label="Setup file" />}>
        <Icon name="menu" />
      </Menu.Trigger>
      <Menu.Popup side="bottom" align="end" size="sm">
        <Menu.Item onClick={() => run(importSetup)}>Import setup…</Menu.Item>
        <Menu.Item disabled={!hasLights} onClick={() => run(exportSetup)}>
          Export setup…
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
}

/** Your lights, then any new ones the scan found. */
function LightList({
  expanded,
  bodyId,
  onToggle,
}: {
  expanded: boolean;
  bodyId: string;
  onToggle: () => void;
}) {
  const devices = useStore((s) => s.devices);
  const discovered = useStore((s) => s.discovered);
  const scanning = useStore((s) => s.scanning);
  const scanError = useStore((s) => s.scanError);
  const scan = useStore((s) => s.scan);
  const [setupError, setSetupError] = useState<string | null>(null);
  const added = new Set(devices.map((d) => d.id));
  const found = discovered.filter((d) => !added.has(d.id));
  const empty = devices.length === 0 && found.length === 0;

  return (
    <div className="light-list">
      <header className="panel-head">
        <PanelHeading title="Lights" controls={bodyId} expanded={expanded} onToggle={onToggle} />
        <div className="panel-actions">
          <Button variant="ghost" size="sm" onClick={() => scan()} disabled={scanning}>
            {scanning ? "Scanning…" : "Scan"}
          </Button>
          <SetupMenu onError={setSetupError} />
        </div>
      </header>
      <div id={bodyId} className="panel-body stack" aria-hidden={!expanded} inert={!expanded}>
        {scanError && <p className="error">{scanError}</p>}
        {setupError && <p className="error">{setupError}</p>}
        {empty ? (
          <p className="empty">
            {scanning
              ? "Looking for Govee lights…"
              : "No lights found. Turn on “LAN Control” for each device in the Govee Home app, then scan again."}
          </p>
        ) : (
          <div className="lights">
            {devices.map((d) => (
              <LightRow key={d.id} device={d} />
            ))}
            {found.length > 0 && devices.length > 0 && (
              <Eyebrow as="h3" className="found-head">
                Found
              </Eyebrow>
            )}
            {found.map((d) => (
              <FoundRow key={d.id} device={d} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Collapsible lights, details, and canvas settings in the sidebar. */
export function Sidebar() {
  const selection = useStore((s) => s.selection);
  const device = useStore((s) => s.devices.find((d) => d.id === selection?.id));
  const panes: Record<Pane, RefObject<HTMLElement | null>> = {
    lights: useRef<HTMLElement>(null),
    details: useRef<HTMLElement>(null),
    canvas: useRef<HTMLElement>(null),
  };
  const [sizes, setSizes] = useState(savedSizes);
  const [resizing, setResizing] = useState(false);
  const [lightsOpen, setLightsOpen] = useSavedOpen("tk-light-mini-lights-open", true);
  const [detailsOpen, setDetailsOpen] = useSavedOpen("tk-light-mini-details-open", true);
  const [canvasOpen, setCanvasOpen] = useSavedOpen("tk-light-mini-canvas-open", false);
  const layersId = useId();
  const lightsBodyId = useId();
  const detailsId = useId();
  const detailsBodyId = useId();
  const canvasId = useId();
  const canvasBodyId = useId();
  const bothOpen = lightsOpen && detailsOpen;
  // The canvas divider moves the line to the nearest open panel above.
  const aboveCanvas: Pane | null = detailsOpen ? "details" : lightsOpen ? "lights" : null;
  const ids: Record<Pane, string> = { lights: layersId, details: detailsId, canvas: canvasId };
  const names: Record<Pane, string> = { lights: "Lights", details: "Details", canvas: "Canvas" };
  // Saved once a drag settles, not on every move.
  useEffect(() => saveLater(SIZES_KEY, () => JSON.stringify(sizes)), [sizes]);
  /** What a divider between `a` and `b` needs. */
  const pair = (a: Pane, b: Pane) => ({
    controls: `${ids[a]} ${ids[b]}`,
    share: (sizes[a] / (sizes[a] + sizes[b])) * 100,
    reset: (DEFAULT_SIZES[a] / (DEFAULT_SIZES[a] + DEFAULT_SIZES[b])) * 100,
    measure: () =>
      (panes[a].current?.getBoundingClientRect().height ?? 0) +
      (panes[b].current?.getBoundingClientRect().height ?? 0),
    onResize: (share: number) =>
      setSizes((s) => {
        const total = s[a] + s[b];
        const size = (total * share) / 100;
        return { ...s, [a]: size, [b]: total - size };
      }),
    onResizing: setResizing,
  });
  return (
    <aside
      className="sidebar"
      aria-label="Lights, details, and canvas"
      data-resizing={resizing || undefined}
      style={
        {
          "--layers-size": `${sizes.lights}fr`,
          "--details-size": `${sizes.details}fr`,
          "--layers-row": `minmax(var(--panel-head-h), ${lightsOpen ? sizes.lights : 0}fr)`,
          "--details-row": `minmax(var(--panel-head-h), ${detailsOpen ? sizes.details : 0}fr)`,
          "--divider-size": bothOpen ? "7px" : "0px",
          "--canvas-divider-size": canvasOpen && aboveCanvas ? "7px" : "var(--tk-border-width)",
          "--canvas-row": `minmax(var(--panel-head-h), ${canvasOpen ? sizes.canvas : 0}fr)`,
        } as CSSProperties
      }
    >
      <section ref={panes.lights} id={layersId} className="layers-pane" aria-label="Lights">
        <LightList
          expanded={lightsOpen}
          bodyId={lightsBodyId}
          onToggle={() => setLightsOpen((open) => !open)}
        />
      </section>
      <PaneDivider
        label="Resize Lights and Details"
        active={bothOpen}
        {...pair("lights", "details")}
      />
      <section ref={panes.details} id={detailsId} className="details-pane" aria-label="Details">
        <header className="panel-head">
          <PanelHeading
            title="Details"
            controls={detailsBodyId}
            expanded={detailsOpen}
            onToggle={() => setDetailsOpen((open) => !open)}
          />
        </header>
        <div
          id={detailsBodyId}
          className="panel-body"
          aria-hidden={!detailsOpen}
          inert={!detailsOpen}
        >
          {device && selection ? (
            <Inspector
              key={`${device.id}:${selection.section}`}
              device={device}
              section={selection.section}
            />
          ) : (
            <p className="empty">No light selected.</p>
          )}
        </div>
      </section>
      <PaneDivider
        className="canvas-divider"
        label={`Resize ${names[aboveCanvas ?? "details"]} and Canvas`}
        active={canvasOpen && aboveCanvas !== null}
        {...pair(aboveCanvas ?? "details", "canvas")}
      />
      <section ref={panes.canvas} id={canvasId} className="canvas-pane" aria-label="Canvas options">
        <header className="panel-head">
          <PanelHeading
            title="Canvas"
            controls={canvasBodyId}
            expanded={canvasOpen}
            onToggle={() => setCanvasOpen((open) => !open)}
          />
        </header>
        <div id={canvasBodyId} className="panel-body" aria-hidden={!canvasOpen} inert={!canvasOpen}>
          <CanvasSettings />
        </div>
      </section>
    </aside>
  );
}
