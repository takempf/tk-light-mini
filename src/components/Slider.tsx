import { Slider as BaseSlider } from "@base-ui/react/slider";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}

/** tk-design-system's slider markup, with our own value formatting. */
export function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <BaseSlider.Root
      className="tk-slider"
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onChange(v as number)}
    >
      <div className="tk-range-header">
        <BaseSlider.Label className="tk-range-label">{label}</BaseSlider.Label>
        <BaseSlider.Value className="tk-range-value">
          {(_, [v]) => format(v ?? value)}
        </BaseSlider.Value>
      </div>
      <BaseSlider.Control className="tk-slider-control">
        <BaseSlider.Track className="tk-slider-track">
          <BaseSlider.Indicator className="tk-slider-indicator" />
          <BaseSlider.Thumb className="tk-slider-thumb" />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;

/** A fraction of the screen's height, like CSS `vh`. */
export const vh = (v: number) => `${Math.round(v * 100)}vh`;
