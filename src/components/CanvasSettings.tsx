import { bands, CANVASES, canvasOption } from "../lib/canvases";
import type { Tuning } from "../lib/types";
import { useStore } from "../store";
import { Button, Select } from "../ui";
import { pct, Slider } from "./Slider";

const TUNING: { key: keyof Tuning; label: string; min: number; max: number; step: number }[] = [
  { key: "brightness", label: "Brightness", min: 0.2, max: 1.5, step: 0.05 },
  { key: "saturation", label: "Saturation", min: 0.5, max: 2, step: 0.05 },
  { key: "smoothing", label: "Smoothing", min: 0, max: 1, step: 0.05 },
];

/** What the lights follow, which screen, and how its colors are picked. */
export function CanvasSettings() {
  const settings = useStore((s) => s.settings);
  const monitors = useStore((s) => s.monitors);
  const setTuning = useStore((s) => s.setTuning);
  const setFps = useStore((s) => s.setFps);
  const setMonitor = useStore((s) => s.setMonitor);
  const setCanvas = useStore((s) => s.setCanvas);
  const resetTuning = useStore((s) => s.resetTuning);

  return (
    <div className="canvas-settings stack">
      <fieldset className="canvas-options" aria-label="Canvas source">
        {CANVASES.map((c) => (
          <button
            key={c.id}
            type="button"
            className="swatch-button"
            aria-pressed={c.id === settings.canvas}
            onClick={() => setCanvas(c.id)}
          >
            <span
              className="canvas-swatch"
              data-screen={c.id === "screen" || undefined}
              style={c.colors.length ? { background: bands(c.colors) } : undefined}
            />
            {c.label}
          </button>
        ))}
      </fieldset>
      {canvasOption(settings.canvas).screen && monitors.length > 1 && (
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
    </div>
  );
}
