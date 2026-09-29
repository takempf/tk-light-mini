import { useEffect } from "react";
import { api } from "../lib/api";
import { isSet, resolveCalibration, STEPS, type Step, testColor } from "../lib/calibration";
import { css, rgbHex } from "../lib/colors";
import type { AddedDevice, Rgb } from "../lib/types";
import { type Calibrating, useStore } from "../store";
import { Button, Icon, Switch } from "../ui";
import { pct, Slider } from "./Slider";

const TITLES: Record<Step, string> = {
  white: "White",
  gamma: "Dark grey",
  red: "Red",
  green: "Green",
  blue: "Blue",
  yellow: "Yellow",
  cyan: "Cyan",
  magenta: "Magenta",
};

const HINTS: Partial<Record<Step, string>> = {
  white:
    "Make the wall the same white as the screen: lower the color it has too much of. Then set Brightness so the wall is about as bright as the screen. Over 100% only lifts dim colors.",
  gamma:
    "Set Gamma so the wall is as dim as the screen. Higher is darker. Compare with the white step if it helps.",
};

const hint = (step: Step) =>
  HINTS[step] ??
  `Make the wall the same ${TITLES[step].toLowerCase()} as the screen. A little of another color shifts the hue.`;

const CHANNELS = ["Red", "Green", "Blue"] as const;

/** Full screen test colors, and the controls to match the light to them. */
export function Calibrator() {
  const calibrating = useStore((s) => s.calibrating);
  const device = useStore((s) => s.devices.find((d) => d.id === s.calibrating?.id));
  if (!calibrating || !device) return null;
  return <CalibrationView calibrating={calibrating} device={device} />;
}

function CalibrationView({
  calibrating,
  device,
}: {
  calibrating: Calibrating;
  device: AddedDevice;
}) {
  const update = useStore((s) => s.updateCalibrating);
  const stop = useStore((s) => s.stopCalibration);
  const setCalibration = useStore((s) => s.setCalibration);
  const setBrightness = useStore((s) => s.setDeviceBrightness);
  // The monitor the lights sit around.
  const monitor = useStore((s) => s.monitors.find((m) => m.index === s.settings.monitor)?.name);
  const { step, raw } = calibrating;
  const index = STEPS.indexOf(step);
  const name = device.name || device.sku;
  const resolved = resolveCalibration(device.calibration);

  useEffect(() => {
    let restore: (() => Promise<void>) | undefined;
    let closed = false;
    api
      .fullscreen(monitor)
      .then((r) => {
        if (closed) void r();
        else restore = r;
      })
      .catch((e) => console.error("fullscreen", e));
    return () => {
      closed = true;
      restore?.().catch((e) => console.error("fullscreen", e));
    };
  }, [monitor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stop();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop]);

  const go = (s: Step) => update({ step: s, raw: false });
  // An edit shows its result, even while comparing.
  const set = (value: number | Rgb) => {
    setCalibration(device.id, step, typeof value === "number" ? value : rgbHex(value));
    if (raw) update({ raw: false });
  };

  return (
    <div
      className="calibrate"
      role="dialog"
      aria-label={`Calibrate ${name}`}
      style={{ background: css(testColor(step)) }}
    >
      <div className="calibrate-panel stack">
        <div className="calibrate-head">
          <span className="calibrate-title">Calibrate {name}</span>
          <span className="meta">
            {index + 1} of {STEPS.length}
          </span>
          <Button size="sm" variant="ghost" aria-label="Close calibration" onClick={stop}>
            <Icon name="close" />
          </Button>
        </div>
        <fieldset className="calibrate-steps" aria-label="Steps">
          {STEPS.map((s) => (
            <button
              key={s}
              type="button"
              className="swatch-button"
              aria-pressed={s === step}
              data-set={isSet(device.calibration, s) || undefined}
              onClick={() => go(s)}
            >
              <span className="chip" style={{ background: css(testColor(s)) }} />
              {TITLES[s]}
            </button>
          ))}
        </fieldset>
        <p className="calibrate-hint">{hint(step)}</p>
        {step === "gamma" ? (
          <Slider
            label="Gamma"
            value={resolved.gamma}
            min={0.5}
            max={3}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={set}
          />
        ) : (
          CHANNELS.map((label, i) => (
            <Slider
              key={label}
              label={label}
              value={resolved[step][i] as number}
              min={0}
              max={255}
              step={1}
              format={String}
              onChange={(v) => set(resolved[step].map((c, k) => (k === i ? v : c)) as Rgb)}
            />
          ))
        )}
        {step === "white" && (
          <Slider
            label="Brightness"
            value={device.brightness}
            min={0}
            max={1.5}
            step={0.05}
            format={pct}
            onChange={(v) => setBrightness(device.id, v)}
          />
        )}
        {!device.razer && (
          <p className="meta">Some lights fade for a few seconds after each change.</p>
        )}
        <div className="calibrate-actions">
          <Switch checked={!raw} onCheckedChange={(on: boolean) => update({ raw: !on })}>
            Calibrated
          </Switch>
          <Button
            size="sm"
            disabled={!isSet(device.calibration, step)}
            onClick={() => setCalibration(device.id, step, undefined)}
          >
            Reset
          </Button>
          <span className="calibrate-gap" />
          <Button size="sm" disabled={index === 0} onClick={() => go(STEPS[index - 1] as Step)}>
            Back
          </Button>
          {index < STEPS.length - 1 ? (
            <Button size="sm" variant="primary" onClick={() => go(STEPS[index + 1] as Step)}>
              Next
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={stop}>
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
