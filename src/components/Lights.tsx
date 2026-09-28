import { useState } from "react";
import { api } from "../lib/api";
import { sourceLabel } from "../lib/colors";
import type { AddedDevice, GoveeDevice, Rgb, Source } from "../lib/types";
import { segmentSources, useStore } from "../store";
import { Accordion, Button, Eyebrow, Input, Panel, Switch } from "../ui";
import { ColorPicker } from "./ColorPicker";
import { PathEditor } from "./PathEditor";
import { SegmentBar } from "./SegmentBar";
import { pct, Slider } from "./Slider";
import { css, useSourceColor } from "./ZonePreview";

/** The one source all of `sources` share, if they do. */
const shared = (sources: Source[]) =>
  sources.every((s) => s === sources[0]) ? sources[0] : undefined;

function LightRow({ device }: { device: AddedDevice }) {
  const rename = useStore((s) => s.renameDevice);
  const remove = useStore((s) => s.removeDevice);
  const setColor = useStore((s) => s.setColor);
  const setBrightness = useStore((s) => s.setDeviceBrightness);
  const setPower = useStore((s) => s.setPower);
  const setRazer = useStore((s) => s.setRazer);
  const setSegments = useStore((s) => s.setSegments);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState(false);
  const name = device.name || device.sku;
  const sources = device.razer ? segmentSources(device) : [];
  const selected = [...picked].filter((i) => i < sources.length).sort((a, b) => a - b);
  const mixed = sources.some((s) => s !== device.color);
  const color = useSourceColor(device.color, device.ip);
  const dot = device.on
    ? (color?.map((v) => Math.min(255, Math.round(v * device.brightness))) as Rgb | undefined)
    : undefined;
  const target =
    selected.length === 0
      ? "Whole light"
      : selected.length === 1
        ? `Segment ${(selected[0] ?? 0) + 1}`
        : `${selected.length} segments`;
  return (
    <Accordion.Item value={device.id} className="light" data-off={device.on ? undefined : ""}>
      <div className="light-head">
        <Accordion.Trigger className="light-trigger">
          <span className="dot" style={{ background: css(dot) }} />
          <span className="light-title">
            <span className="light-name">{name}</span>
            <span className="meta">
              {device.sku} · {device.ip}
            </span>
          </span>
          <span className="meta light-summary">
            {device.on
              ? `${mixed ? "Segments" : sourceLabel(device.color)} · ${pct(device.brightness)}`
              : "Off"}
          </span>
        </Accordion.Trigger>
        <Switch
          aria-label={`Power for ${name}`}
          checked={device.on}
          onCheckedChange={(on: boolean) => setPower(device.id, on)}
        />
      </div>
      <Accordion.Panel className="light-panel">
        <div className="light-body stack">
          <Input
            size="sm"
            aria-label={`Name for ${device.id}`}
            value={device.name}
            onChange={(e) => rename(device.id, e.target.value)}
          />
          <Switch checked={device.razer} onCheckedChange={(on: boolean) => setRazer(device.id, on)}>
            Razer streaming (experimental)
          </Switch>
          {device.razer && (
            <>
              <Slider
                label="Segments"
                value={sources.length}
                min={1}
                max={100}
                step={1}
                format={String}
                onChange={(v) => setSegments(device.id, v)}
              />
              <SegmentBar
                label={`Segments of ${name}`}
                ip={device.ip}
                sources={sources}
                selected={new Set(selected)}
                onSelect={setPicked}
              />
            </>
          )}
          <div className="stack path-block">
            <div className="path-head">
              <span className="meta">
                Path ·{" "}
                {device.path
                  ? `${device.path.points.length} points${device.razer ? `, ${sources.length} segments` : ""}`
                  : "none"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={editing}
                onClick={() => setEditing(!editing)}
              >
                {editing ? "Done" : device.path ? "Edit path" : "Draw path"}
              </Button>
            </div>
            {editing && <PathEditor device={device} segments={device.razer ? sources.length : 1} />}
          </div>
          <div className="stack picker-block">
            <span className="meta">Color · {target}</span>
            <ColorPicker
              label={`Color for ${name}`}
              ip={device.ip}
              hasPath={!!device.path}
              value={
                selected.length ? shared(selected.map((i) => sources[i] as Source)) : device.color
              }
              onPick={(c) => setColor(device.id, c, selected)}
            />
          </div>
          <Slider
            label="Brightness"
            value={device.brightness}
            min={0}
            max={1.5}
            step={0.05}
            format={pct}
            onChange={(v) => setBrightness(device.id, v)}
          />
          <div className="light-actions">
            <Button size="sm" onClick={() => api.identifyDevice(device.ip).catch(() => {})}>
              Identify
            </Button>
            <Button size="sm" variant="danger" onClick={() => remove(device.id)}>
              Remove
            </Button>
          </div>
        </div>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

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

/** Your lights, then any new ones the scan found, in one list. */
export function Lights() {
  const devices = useStore((s) => s.devices);
  const discovered = useStore((s) => s.discovered);
  const scanning = useStore((s) => s.scanning);
  const scanError = useStore((s) => s.scanError);
  const scan = useStore((s) => s.scan);
  const added = new Set(devices.map((d) => d.id));
  const found = discovered.filter((d) => !added.has(d.id));
  const empty = devices.length === 0 && found.length === 0;

  return (
    <Panel as="section" className="stack">
      <header className="panel-head">
        <Eyebrow as="h2">Lights</Eyebrow>
        <Button variant="ghost" size="sm" onClick={() => scan()} disabled={scanning}>
          {scanning ? "Scanning…" : "Scan"}
        </Button>
      </header>
      {scanError && <p className="error">{scanError}</p>}
      {empty ? (
        <p className="empty">
          {scanning
            ? "Looking for Govee lights…"
            : "No lights found. Turn on “LAN Control” for each device in the Govee Home app, then scan again."}
        </p>
      ) : (
        <Accordion.Root multiple className="lights">
          {devices.map((d) => (
            <LightRow key={d.id} device={d} />
          ))}
          {found.map((d) => (
            <FoundRow key={d.id} device={d} />
          ))}
        </Accordion.Root>
      )}
    </Panel>
  );
}
