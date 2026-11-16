import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatTime } from "./VideoTransport";

export type VideoSettings = {
  /** Seconds into the video: the part that becomes the wallpaper loop. */
  start: number;
  end: number;
  fps: number;
  /** Encoder tolerance, 4 (best, largest) .. 24 (smallest). */
  quality: number;
};

export type ExportProgress = { done: number; total: number; bytes: number };

type Props = {
  settings: VideoSettings;
  onChange: (next: VideoSettings) => void;
  duration: number;
  sourceFps: number;
  time: number;
  frames: number;
  progress: ExportProgress | null;
  onCancelExport: () => void;
};

const MIN_LENGTH = 0.1;

export function formatBytes(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Sidebar section for a loaded video: which part to use, frame rate, quality. */
export function VideoPanel({ settings, onChange, duration, sourceFps, time, frames, progress, onCancelExport }: Props) {
  const busy = progress !== null;
  // the video's own rate first (when the overlay can play it), then the usual lower ones
  const rates = [...new Set([sourceFps <= 30 ? sourceFps : 30, 30, 24, 20, 15])].sort((a, b) => b - a);
  const length = settings.end - settings.start;

  return (
    <div className="border-b" data-testid="video-panel">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Animation</h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {frames.toLocaleString()} frames · {length.toFixed(2)} s
        </span>
      </div>

      <div className="px-5 pb-4 space-y-4">
        {/* Trim */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Loop range</span>
            <span className="tabular-nums text-muted-foreground">
              {formatTime(settings.start)} – {formatTime(settings.end)}
            </span>
          </div>
          <Slider
            value={[settings.start, settings.end]}
            min={0}
            max={duration}
            step={0.01}
            minStepsBetweenThumbs={Math.ceil(MIN_LENGTH / 0.01)}
            disabled={busy}
            onValueChange={(v) => onChange({ ...settings, start: v[0]!, end: v[1]! })}
            data-testid="video-trim"
          />
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              disabled={busy || time > settings.end - MIN_LENGTH}
              onClick={() => onChange({ ...settings, start: Math.max(0, time) })}
              title="Start the loop at the frame shown"
              data-testid="video-start-here"
            >
              Start here
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              disabled={busy || time < settings.start + MIN_LENGTH}
              onClick={() => onChange({ ...settings, end: Math.min(duration, time) })}
              title="End the loop at the frame shown"
              data-testid="video-end-here"
            >
              End here
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={busy || (settings.start === 0 && settings.end === duration)}
              onClick={() => onChange({ ...settings, start: 0, end: duration })}
              title="Use the whole video"
              data-testid="video-trim-reset"
            >
              All
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The wallpaper repeats this part. Cut still intros or fades so the loop doesn't pause.
          </p>
        </div>

        {/* Frame rate */}
        <div className="space-y-2 pt-2 border-t">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Frame rate</span>
            <span className="text-muted-foreground tabular-nums">source {sourceFps} fps</span>
          </div>
          <div className="flex gap-1.5">
            {rates.map((r) => (
              <button
                key={r}
                type="button"
                disabled={busy}
                onClick={() => onChange({ ...settings, fps: r })}
                className={`flex-1 h-8 rounded-md border text-xs font-medium tabular-nums transition-colors disabled:opacity-50 ${
                  settings.fps === r
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover-elevate"
                }`}
                data-testid={`video-fps-${r}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Quality */}
        <div className="space-y-2 pt-2 border-t">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Quality</span>
            <span className="text-muted-foreground tabular-nums">
              {settings.quality <= 6 ? "Best" : settings.quality <= 12 ? "Balanced" : "Small file"} · {settings.quality}
            </span>
          </div>
          {/* shown reversed so right = better, like the other sliders */}
          <Slider
            value={[28 - settings.quality]}
            min={4}
            max={24}
            step={1}
            disabled={busy}
            onValueChange={(v) => onChange({ ...settings, quality: 28 - v[0]! })}
            data-testid="video-quality"
          />
          <p className="text-[11px] text-muted-foreground">
            Higher quality re-sends more of each frame: a larger file and more SD-card reading
            while it plays. Balanced (10) is what make_uaw.py uses.
          </p>
        </div>

        {progress && (
          <div className="space-y-2 pt-2 border-t" data-testid="video-progress">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Exporting .uaw…</span>
              <span className="tabular-nums text-muted-foreground">
                {progress.done} / {progress.total} · {formatBytes(progress.bytes)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-[#22ff66] transition-[width] duration-150"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={onCancelExport} data-testid="video-cancel">
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
