import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { type Transform } from "@/lib/imageProcessing";
import { AlignCenterHorizontal, AlignCenterVertical, Maximize2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";

export type Background =
  | { kind: "transparent" }
  | { kind: "color"; color: string };

type Props = {
  transform: Transform;
  onChange: (t: Transform) => void;
  onFit: () => void;
  onFitH: () => void;
  onFitV: () => void;
  onReset: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  background: Background;
  onBackgroundChange: (bg: Background) => void;
  hasImage?: boolean;
};

export function TransformPanel({
  transform,
  onChange,
  onFit,
  onFitH,
  onFitV,
  onReset,
  onRotateLeft,
  onRotateRight,
  background,
  onBackgroundChange,
  hasImage = true,
}: Props) {
  return (
    <div className="border-b">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          Frame & Position
        </h2>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={!hasImage}
            data-testid="reset-transform"
            title="Reset transform"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Fit buttons row */}
      <div className="px-5 pb-3 flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={onFit}
          disabled={!hasImage}
          data-testid="fit-image"
          data-preserve-selection
          className="flex-1 text-xs"
          title="Fit image to frame (cover)"
        >
          <Maximize2 className="h-3.5 w-3.5 mr-1.5" />
          Fit
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onFitH}
          disabled={!hasImage}
          data-testid="fit-horizontal"
          data-preserve-selection
          className="flex-1 text-xs"
          title="Fit to frame width, center vertically"
        >
          <AlignCenterVertical className="h-3.5 w-3.5 mr-1.5" />
          Fit W
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onFitV}
          disabled={!hasImage}
          data-testid="fit-vertical"
          data-preserve-selection
          className="flex-1 text-xs"
          title="Fit to frame height, center horizontally"
        >
          <AlignCenterHorizontal className="h-3.5 w-3.5 mr-1.5" />
          Fit H
        </Button>
      </div>

      {/* Rotate buttons row */}
      <div className="px-5 pb-3 flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={onRotateLeft}
          disabled={!hasImage}
          data-testid="rotate-left"
          data-preserve-selection
          className="flex-1 text-xs"
          title="Rotate 90° counter-clockwise"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Rotate L
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onRotateRight}
          disabled={!hasImage}
          data-testid="rotate-right"
          data-preserve-selection
          className="flex-1 text-xs"
          title="Rotate 90° clockwise"
        >
          <RotateCw className="h-3.5 w-3.5 mr-1.5" />
          Rotate R
        </Button>
      </div>

      <div className="px-5 pb-4 space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Zoom</span>
            <span className="tabular-nums text-muted-foreground">
              {(transform.scale * 100).toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                onChange({ ...transform, scale: Math.max(0.1, transform.scale - 0.1) })
              }
              className="p-1.5 rounded-md hover-elevate text-muted-foreground"
              data-testid="zoom-out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <Slider
              value={[transform.scale]}
              min={0.1}
              max={4}
              step={0.01}
              onValueChange={(v) => onChange({ ...transform, scale: v[0]! })}
              className="flex-1"
              data-testid="zoom-slider"
            />
            <button
              onClick={() =>
                onChange({ ...transform, scale: Math.min(8, transform.scale + 0.1) })
              }
              className="p-1.5 rounded-md hover-elevate text-muted-foreground"
              data-testid="zoom-in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Drag to pan · Scroll or pinch to zoom
          </p>
        </div>

        <div className="space-y-2 pt-2 border-t">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Background</span>
            <span className="text-muted-foreground">
              {background.kind === "transparent"
                ? "Transparent (RGBA)"
                : background.color.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onBackgroundChange({ kind: "transparent" })}
              className={`flex-1 h-8 rounded-md border text-xs font-medium transition-colors ${
                background.kind === "transparent"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover-elevate"
              }`}
              data-testid="bg-transparent"
            >
              Transparent
            </button>
            <button
              onClick={() =>
                onBackgroundChange({
                  kind: "color",
                  color: background.kind === "color" ? background.color : "#000000",
                })
              }
              className={`flex-1 h-8 rounded-md border text-xs font-medium transition-colors ${
                background.kind === "color"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover-elevate"
              }`}
              data-testid="bg-color"
            >
              Solid color
            </button>
          </div>
          {background.kind === "color" && (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="color"
                value={background.color}
                onChange={(e) =>
                  onBackgroundChange({ kind: "color", color: e.target.value })
                }
                className="h-8 w-10 rounded-md border border-border bg-transparent cursor-pointer"
                data-testid="bg-color-input"
              />
              <input
                type="text"
                value={background.color}
                onChange={(e) =>
                  onBackgroundChange({ kind: "color", color: e.target.value })
                }
                className="flex-1 h-8 rounded-md border border-border bg-background px-2 text-xs font-mono uppercase"
                data-testid="bg-color-hex"
              />
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {background.kind === "transparent"
              ? "Empty areas export with a real alpha channel."
              : "Empty areas filled with the chosen color."}
          </p>
        </div>
      </div>
    </div>
  );
}
