import type { Tuning } from "../lib/types";
import { useStore } from "../store";
import { Button, Icon, Popover, Select } from "../ui";
import { pct, Slider } from "./Slider";

const TUNING: { key: keyof Tuning; label: string; min: number; max: number; step: number }[] = [
  { key: "brightness", label: "Brightness", min: 0.2, max: 1.5, step: 0.05 },
  { key: "saturation", label: "Saturation", min: 0.5, max: 2, step: 0.05 },
  { key: "smoothing", label: "Smoothing", min: 0, max: 1, step: 0.05 },
];

/** Which screen to follow, and how its colors are picked. */
export function SettingsPopover() {
  const settings = useStore((s) => s.settings);
  const monitors = useStore((s) => s.monitors);
  const setTuning = useStore((s) => s.setTuning);
  const setFps = useStore((s) => s.setFps);
  const setMonitor = useStore((s) => s.setMonitor);
  const resetTuning = useStore((s) => s.resetTuning);

  return (
    <Popover.Root>
      <Popover.Trigger render={<Button variant="ghost" size="sm" aria-label="Settings" />}>
        <Icon name="sliders" />
      </Popover.Trigger>
      <Popover.Popup className="settings stack" side="bottom" align="end">
        <Popover.Title>Screen</Popover.Title>
        {monitors.length > 1 && (
          <Select
            aria-label="Monitor"
            size="sm"
            value={settings.monitor}
            onValueChange={(v) => v !== null && setMonitor(v)}
            items={monitors.map((m) => ({
              value: m.index,
              label: `${m.name} (${m.width}×${m.height})`,
            }))}
          />
        )}
        {TUNING.map((t) => (
          <Slider
            key={t.key}
            label={t.label}
            value={settings.tuning[t.key]}
            min={t.min}
            max={t.max}
            step={t.step}
            format={pct}
            onChange={(v) => setTuning({ [t.key]: v })}
          />
        ))}
        <Slider
          label="Sample rate"
          value={settings.fps}
          min={10}
          max={60}
          step={5}
          format={(v) => `${v} fps`}
          onChange={setFps}
        />
        <Button variant="ghost" size="sm" onClick={resetTuning}>
          Reset tuning
        </Button>
      </Popover.Popup>
    </Popover.Root>
  );
}
