import { Slider } from "@/components/ui/slider";

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  testId: string;
  format?: (v: number) => string;
};

export function AdjustmentSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  testId,
  format,
}: Props) {
  const display = format
    ? format(value)
    : Math.abs(value) < 0.01
      ? "0"
      : (value > 0 ? "+" : "") + value.toFixed(2);
  const isDefault = Math.abs(value) < 0.0001;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={() => onChange(0)}
          className="font-medium text-foreground hover:text-primary transition-colors"
          title="Reset"
          data-testid={`${testId}-reset`}
        >
          {label}
        </button>
        <span
          className={
            isDefault
              ? "tabular-nums text-muted-foreground"
              : "tabular-nums text-foreground font-medium"
          }
        >
          {display}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0]!)}
        data-testid={testId}
      />
    </div>
  );
}
