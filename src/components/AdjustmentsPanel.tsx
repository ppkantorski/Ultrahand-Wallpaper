import { type Adjustments, DEFAULT_ADJUSTMENTS } from "@/lib/imageProcessing";
import { AdjustmentSlider } from "./AdjustmentSlider";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

type Props = {
  adjustments: Adjustments;
  onChange: (next: Adjustments) => void;
};

const GROUPS: Array<{
  title: string;
  fields: Array<{
    key: keyof Adjustments;
    label: string;
    min: number;
    max: number;
    step: number;
  }>;
}> = [
  {
    title: "Light",
    fields: [
      { key: "exposure",   label: "Exposure",   min: -1, max: 1, step: 0.01 },
      { key: "brightness", label: "Brightness", min: -1, max: 1, step: 0.01 },
      { key: "highlights", label: "Highlights", min: -1, max: 1, step: 0.01 },
      { key: "shadows",    label: "Shadows",    min: -1, max: 1, step: 0.01 },
      { key: "contrast",   label: "Contrast",   min: -1, max: 1, step: 0.01 },
      { key: "blackPoint", label: "Black Point",min: -1, max: 1, step: 0.01 },
    ],
  },
  {
    title: "Color",
    fields: [
      { key: "saturation", label: "Saturation", min: -1, max: 1, step: 0.01 },
      { key: "vibrance",   label: "Vibrance",   min: -1, max: 1, step: 0.01 },
      { key: "warmth",     label: "Warmth",     min: -1, max: 1, step: 0.01 },
      { key: "tint",       label: "Tint",       min: -1, max: 1, step: 0.01 },
    ],
  },
  {
    title: "Detail",
    fields: [
      { key: "sharpness",  label: "Sharpness",  min: 0,  max: 1, step: 0.01 },
      { key: "definition", label: "Definition", min: -1, max: 1, step: 0.01 },
      { key: "vignette",   label: "Vignette",   min: -1, max: 1, step: 0.01 },
    ],
  },
];

export function AdjustmentsPanel({ adjustments, onChange }: Props) {
  const setField = (key: keyof Adjustments, v: number) =>
    onChange({ ...adjustments, [key]: v });

  const reset = () => onChange({ ...DEFAULT_ADJUSTMENTS });

  const isDefault = (Object.keys(DEFAULT_ADJUSTMENTS) as Array<keyof Adjustments>)
    .every((k) => Math.abs(adjustments[k] - DEFAULT_ADJUSTMENTS[k]) < 0.0001);

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-4 border-b">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          Adjustments
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={isDefault}
          data-testid="reset-adjustments"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Reset
        </Button>
      </div>
      <div className="px-5 py-4 space-y-6">
        {GROUPS.map((group) => (
          <div key={group.title} className="space-y-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
              {group.title}
            </div>
            <div className="space-y-3.5">
              {group.fields.map((f) => (
                <AdjustmentSlider
                  key={f.key}
                  label={f.label}
                  value={adjustments[f.key]}
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  onChange={(v) => setField(f.key, v)}
                  testId={`slider-${f.key}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}