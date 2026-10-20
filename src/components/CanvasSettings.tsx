import { bands, CANVASES, canvasOption } from "../lib/canvases";
import { controlsOf, controlValue, formatControl } from "../lib/controls";
import { pickedPalette, recolor } from "../lib/palettes";
import type { CanvasSource, Tuning } from "../lib/types";
import { useStore } from "../store";
import { Button, Select } from "../ui";
import { PaletteSettings } from "./PaletteSettings";
import { pct, Slider } from "./Slider";

const TUNING: { key: keyof Tuning; label: string; min: number; max: number; step: number }[] = [
  { key: "brightness", label: "Brightness", min: 0.2, max: 1.5, step: 0.05 },
  { key: "saturation", label: "Saturation", min: 0.5, max: 2, step: 0.05 },
  { key: "smoothing", label: "Smoothing", min: 0, max: 1, step: 0.05 },
];

/** The canvas's own settings, like its speed, as sliders. */
function CanvasControls({ canvas }: { canvas: CanvasSource }) {
  const values = useStore((s) => s.settings.controls[canvas]);
  const setControl = useStore((s) => s.setControl);
  const resetControls = useStore((s) => s.resetControls);
  const controls = controlsOf(canvas);
  if (!controls.length) return null;
  return (
    <div className="canvas-controls stack">
      {controls.map((c) => (
        <Slider
          key={c.key}
          label={c.label}
          value={controlValue(c, values)}
          min={c.min}
          max={c.max}
          step={c.step}
          format={(v) => formatControl(c, v)}
          onChange={(v) => setControl(canvas, c.key, v)}
        />
      ))}
      <Button variant="ghost" size="sm" disabled={!values} onClick={() => resetControls(canvas)}>
        Reset {canvasOption(canvas).label.toLowerCase()}
      </Button>
    </div>
  );
}

/** What the lights follow, which screen, and how its colors are picked. */
export function CanvasSettings() {
  const settings = useStore((s) => s.settings);
  const palettes = useStore((s) => s.palettes);
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
              style={
                c.colors.length
                  ? {
                      background: bands(
                        recolor(c.id, c.colors, pickedPalette(c.id, settings.palettes, palettes)),
                      ),
                    }
                  : undefined
              }
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
      <PaletteSettings canvas={settings.canvas} />
      <CanvasControls canvas={settings.canvas} />
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
