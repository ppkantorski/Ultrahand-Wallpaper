// Renders a video frame by frame through the designer's transform + adjustments and
// encodes the result as an Ultrahand animated wallpaper (.uaw).
import {
  type Adjustments,
  type Transform,
  FRAME_H,
  FRAME_W,
  renderToCanvas,
} from "./imageProcessing";
import { type VideoMedia, seekVideo, seekVideoFrame } from "./media";
import { type UawStats, fpsToFraction } from "./uaw";

export type UawExportOptions = {
  media: VideoMedia;
  transform: Transform;
  adjustments: Adjustments;
  background: { kind: "transparent" } | { kind: "color"; color: string };
  /** Seconds into the video. */
  start: number;
  end: number;
  fps: number;
  /** Encoder tolerance, see UawEncoder (lower = better / larger). */
  quality: number;
  onProgress?: (done: number, total: number, stats: UawStats) => void;
  signal?: AbortSignal;
};

export type UawExportResult = { blob: Blob; stats: UawStats; fpsNum: number; fpsDen: number };

/** Frames the export will write for this range and rate. */
export function uawFrameCount(start: number, end: number, fps: number) {
  return Math.max(1, Math.round((end - start) * fps));
}

// Browsers stop decoding video in a hidden tab (seeks stall, or the picture drawn is a
// stale frame), so the export only advances while the page is visible.
function whenVisible(signal?: AbortSignal): Promise<void> {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (document.hidden && !signal?.aborted) return;
      document.removeEventListener("visibilitychange", done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    document.addEventListener("visibilitychange", done);
    signal?.addEventListener("abort", done);
  });
}

type WorkerReply =
  | { type: "record"; record: ArrayBuffer; stats: UawStats }
  | { type: "header"; header: ArrayBuffer; stats: UawStats };

export async function exportUaw(opts: UawExportOptions): Promise<UawExportResult> {
  const { media, start, end, fps, signal } = opts;
  const video = media.el;
  const total = uawFrameCount(start, end, fps);
  const [fpsNum, fpsDen] = fpsToFraction(fps);
  const rate = fpsNum / fpsDen;

  const canvas = document.createElement("canvas");
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D context unavailable");

  const worker = new Worker(new URL("./uaw.worker.ts", import.meta.url), { type: "module" });
  let fail: ((err: Error) => void) | null = null;
  let next: ((reply: WorkerReply) => void) | null = null;
  worker.onmessage = (e: MessageEvent<WorkerReply>) => next?.(e.data);
  worker.onerror = (e) => fail?.(new Error(e.message || "The encoder stopped unexpectedly."));
  const reply = () =>
    new Promise<WorkerReply>((resolve, reject) => {
      next = resolve;
      fail = reject;
    });

  const wasPaused = video.paused;
  const resumeAt = video.currentTime;
  video.pause();
  const parts: ArrayBuffer[] = [];
  try {
    worker.postMessage({ type: "init", quality: opts.quality });
    let stats: UawStats | null = null;
    // Sample times: output frame i shows the source frame on screen at start + i / rate.
    // The start is snapped to a source frame, and every time is nudged a little way into
    // that frame (0.37 of one: for the usual rate ratios no sample ever lands on a frame
    // boundary, where a seek could pick either neighbour).
    const srcFrame = 1 / (media.fps > 0 ? media.fps : 30);
    const first = Math.round(start / srcFrame) * srcFrame + 0.37 * srcFrame;
    // the last decodable moment: seeking to the very end shows nothing in some browsers
    const lastTime = Math.max(0, media.duration - 0.5 * srcFrame);
    for (let i = 0; i < total; i++) {
      await whenVisible(signal);
      if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
      const t = Math.min(first + i / rate, lastTime);
      try {
        // (waits for the frame to really be on screen, not just for the seek to finish)
        const confirmed = await seekVideoFrame(video, t, srcFrame);
        // The first seek is the long one, from wherever the playhead was. If the browser
        // couldn't confirm the new frame (Safari captured the playhead's old picture as
        // frame 0 here, which then flashed at every loop), give it more time and seek again.
        if (i === 0 && !confirmed) {
          await new Promise((r) => setTimeout(r, 400));
          await seekVideoFrame(video, t + 1e-3, srcFrame);
          await new Promise((r) => setTimeout(r, 200));
        }
      } catch (err) {
        // a stalled seek (the tab was hidden meanwhile, a slow disk): try once more
        await whenVisible(signal);
        if (signal?.aborted || video.readyState < 1) throw err;
        await seekVideoFrame(video, t + 1e-3, srcFrame);
      }
      if (document.hidden) {                  // hidden during the seek: redo this frame
        i--;
        continue;
      }
      renderToCanvas(ctx, media.source, media.width, media.height, opts.transform, opts.adjustments, {
        quality: "export",
        background: opts.background,
      });
      // .uaw pixels are opaque: empty areas become black
      const rgba = ctx.getImageData(0, 0, FRAME_W, FRAME_H).data;
      const rgb = new Uint8Array(FRAME_W * FRAME_H * 3);
      for (let p = 0, q = 0; p < rgba.length; p += 4, q += 3) {
        const a = rgba[p + 3]!;
        if (a === 255) {
          rgb[q] = rgba[p]!;
          rgb[q + 1] = rgba[p + 1]!;
          rgb[q + 2] = rgba[p + 2]!;
        } else if (a !== 0) {
          rgb[q] = (rgba[p]! * a + 127) / 255;
          rgb[q + 1] = (rgba[p + 1]! * a + 127) / 255;
          rgb[q + 2] = (rgba[p + 2]! * a + 127) / 255;
        }
      }
      const answer = reply();
      worker.postMessage({ type: "frame", rgb: rgb.buffer }, [rgb.buffer]);
      const r = await answer;
      if (r.type !== "record") throw new Error("Unexpected encoder reply.");
      parts.push(r.record);
      stats = r.stats;
      opts.onProgress?.(i + 1, total, r.stats);
    }
    const answer = reply();
    worker.postMessage({ type: "finish", fpsNum, fpsDen });
    const h = await answer;
    if (h.type !== "header") throw new Error("Unexpected encoder reply.");
    stats = h.stats;
    const blob = new Blob([h.header, ...parts], { type: "application/octet-stream" });
    return { blob, stats, fpsNum, fpsDen };
  } finally {
    worker.terminate();
    try {
      if (video.readyState >= 1) {            // still loaded (not cleared mid-export)
        await seekVideo(video, resumeAt);
        if (!wasPaused) void video.play().catch(() => {});
      }
    } catch {
      // the video went away mid-export; nothing to restore
    }
  }
}
