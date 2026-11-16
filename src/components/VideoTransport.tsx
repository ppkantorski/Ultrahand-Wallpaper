import { Pause, Play } from "lucide-react";
import { Slider } from "@/components/ui/slider";

type Props = {
  playing: boolean;
  time: number;
  duration: number;
  /** The part that will be exported; shown as the bright span of the bar. */
  start: number;
  end: number;
  disabled?: boolean;
  onToggle: () => void;
  onSeek: (time: number) => void;
};

export function formatTime(t: number) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
}

/** Play / pause and a scrub bar, shown under the canvas while a video is loaded. */
export function VideoTransport({ playing, time, duration, start, end, disabled, onToggle, onSeek }: Props) {
  const left = duration > 0 ? (start / duration) * 100 : 0;
  const width = duration > 0 ? ((end - start) / duration) * 100 : 100;
  return (
    <div className="flex w-full items-center gap-2.5" data-preserve-selection data-testid="video-transport">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#22ff66]/10 text-[#22ff66] transition-colors hover:bg-[#22ff66]/20 disabled:opacity-40"
        title={playing ? "Pause (Space)" : "Play (Space)"}
        aria-label={playing ? "Pause" : "Play"}
        data-testid="video-play"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
      </button>
      <div className="relative flex-1">
        {/* the export range, behind the scrubber */}
        <div
          className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#22ff66]/25"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
        <Slider
          value={[Math.min(time, duration)]}
          min={0}
          max={duration}
          step={0.01}
          disabled={disabled}
          onValueChange={(v) => onSeek(v[0]!)}
          data-testid="video-scrub"
        />
      </div>
      <span className="flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {formatTime(time)} / {formatTime(duration)}
      </span>
    </div>
  );
}
