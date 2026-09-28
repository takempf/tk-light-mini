import { css, sourceLabel } from "../lib/colors";
import { sectionsOf, segmentSources } from "../lib/lights";
import { useSourceColor } from "../lib/live";
import type { AddedDevice, GoveeDevice, Rgb } from "../lib/types";
import { useStore } from "../store";
import { Button, Eyebrow, Switch } from "../ui";
import { Inspector } from "./Inspector";
import { pct } from "./Slider";

/** What a light is doing, in a few words. */
function status(d: AddedDevice): string {
  if (!d.on) return "Off";
  const sections = sectionsOf(d);
  const what = sections.some((s) => !s.path && s.color === "path")
    ? "Not placed"
    : sections.length > 1
      ? `${sections.length} sections`
      : sourceLabel(sections[0]?.color ?? "path");
  return `${what} · ${pct(d.brightness)}`;
}

function LightRow({ device }: { device: AddedDevice }) {
  const select = useStore((s) => s.select);
  const setPower = useStore((s) => s.setPower);
  const name = device.name || device.sku;
  const color = useSourceColor(segmentSources(device)[0] ?? "path", device.ip, 0);
  const dot = device.on
    ? (color?.map((v) => Math.min(255, Math.round(v * device.brightness))) as Rgb | undefined)
    : undefined;
  return (
    <div className="light" data-off={device.on ? undefined : ""}>
      <button
        type="button"
        className="light-open"
        aria-label={`Edit ${name}`}
        onClick={() => select({ id: device.id, section: 0 })}
      >
        <span className="dot" style={{ background: css(dot) }} />
        <span className="light-title">
          <span className="light-name">{name}</span>
          <span className="meta">{status(device)}</span>
        </span>
      </button>
      <Switch
        aria-label={`Power for ${name}`}
        checked={device.on}
        onCheckedChange={(on: boolean) => setPower(device.id, on)}
      />
    </div>
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

/** Your lights, then any new ones the scan found. */
function LightList() {
  const devices = useStore((s) => s.devices);
  const discovered = useStore((s) => s.discovered);
  const scanning = useStore((s) => s.scanning);
  const scanError = useStore((s) => s.scanError);
  const scan = useStore((s) => s.scan);
  const added = new Set(devices.map((d) => d.id));
  const found = discovered.filter((d) => !added.has(d.id));
  const empty = devices.length === 0 && found.length === 0;

  return (
    <div className="stack">
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
  );
}

/** The light list, or the selected light's settings. */
export function Sidebar() {
  const selection = useStore((s) => s.selection);
  const device = useStore((s) => s.devices.find((d) => d.id === selection?.id));
  return (
    <aside className="sidebar">
      {device && selection ? (
        <Inspector key={device.id} device={device} section={selection.section} />
      ) : (
        <LightList />
      )}
    </aside>
  );
}
