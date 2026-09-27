import { api } from "../lib/api";
import {
  type AddedDevice,
  type GoveeDevice,
  type Rgb,
  WHITE_LED_SEGMENTS,
  ZONES,
  type Zone,
} from "../lib/types";
import { useStore } from "../store";
import { Accordion, Button, Eyebrow, Input, Panel, Switch, Toggle, ToggleGroup } from "../ui";
import { pct, Slider } from "./Slider";
import { css, useZoneColor } from "./ZonePreview";

const ZONE_LABEL: Record<Zone, string> = {
  top: "Top",
  left: "Left",
  bottom: "Bottom",
  right: "Right",
  all: "All",
};

function ZoneOption({ zone }: { zone: Zone }) {
  const color = useZoneColor(zone);
  return (
    <Toggle value={zone}>
      <span className="swatch" style={{ background: css(color) }} />
      {ZONE_LABEL[zone]}
    </Toggle>
  );
}

function LightRow({ device }: { device: AddedDevice }) {
  const rename = useStore((s) => s.renameDevice);
  const remove = useStore((s) => s.removeDevice);
  const setZone = useStore((s) => s.setZone);
  const setBrightness = useStore((s) => s.setDeviceBrightness);
  const setPower = useStore((s) => s.setPower);
  const setWhiteLeds = useStore((s) => s.setWhiteLeds);
  const setSegments = useStore((s) => s.setSegments);
  const defaultSegments = WHITE_LED_SEGMENTS[device.sku];
  const color = useZoneColor(device.zone);
  const dot = device.on
    ? (color?.map((v) => Math.min(255, Math.round(v * device.brightness))) as Rgb | undefined)
    : undefined;
  return (
    <Accordion.Item value={device.id} className="light" data-off={device.on ? undefined : ""}>
      <div className="light-head">
        <Accordion.Trigger className="light-trigger">
          <span className="dot" style={{ background: css(dot) }} />
          <span className="light-title">
            <span className="light-name">{device.name || device.sku}</span>
            <span className="meta">
              {device.sku} · {device.ip}
            </span>
          </span>
          <span className="meta light-summary">
            {device.on ? `${ZONE_LABEL[device.zone]} · ${pct(device.brightness)}` : "Off"}
          </span>
        </Accordion.Trigger>
        <Switch
          aria-label={`Power for ${device.name || device.sku}`}
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
          <ToggleGroup
            size="sm"
            className="zones"
            aria-label={`Zone for ${device.name}`}
            value={[device.zone]}
            onValueChange={([z]) => z && setZone(device.id, z as Zone)}
          >
            {ZONES.map((z) => (
              <ZoneOption key={z} zone={z} />
            ))}
          </ToggleGroup>
          <Slider
            label="Brightness"
            value={device.brightness}
            min={0}
            max={1.5}
            step={0.05}
            format={pct}
            onChange={(v) => setBrightness(device.id, v)}
          />
          {defaultSegments !== undefined && (
            <Switch
              checked={device.whiteLeds}
              onCheckedChange={(on: boolean) => setWhiteLeds(device.id, on)}
            >
              White LEDs (experimental)
            </Switch>
          )}
          {defaultSegments !== undefined && device.whiteLeds && (
            <Slider
              label="Segments"
              value={device.segments ?? defaultSegments}
              min={1}
              max={56}
              step={1}
              format={String}
              onChange={(v) => setSegments(device.id, v)}
            />
          )}
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
