// What the designer edits: a still image or something that plays (a video file, an
// animated GIF, or an existing .uaw). Everything draws through renderToCanvas from `source`.
import { GifCompositor, parseGif } from "./gif";
import { UawDecoder } from "./uawDecode";

export type ImageMedia = {
  kind: "image";
  el: HTMLImageElement;
  /** What to draw. */
  source: CanvasImageSource;
  width: number;
  height: number;
};

/**
 * The part of HTMLVideoElement the designer uses. A real <video> is one; FramePlayer
 * (below) is another, so animated GIFs and .uaw files behave exactly like videos everywhere else.
 * Events used: "play", "pause", "seeked", "ended", "error", "loadeddata".
 */
export interface VideoLike extends EventTarget {
  readonly paused: boolean;
  currentTime: number;
  readonly duration: number;
  readonly readyState: number;
  readonly seeking: boolean;
  play(): Promise<void>;
  pause(): void;
  /** Per-frame callback, where the browser has one (real videos). */
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

export type VideoMedia = {
  kind: "video";
  el: VideoLike;
  /** What to draw: the <video> itself, or a GIF's canvas. */
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
  /** The source's own frame rate (measured; 30 when it can't be). */
  fps: number;
  /** Where it came from: only for wording. */
  format: "video" | "gif" | "uaw";
  /** Releases the decoder / object URL. */
  dispose: () => void;
};

export type Media = ImageMedia | VideoMedia;

export function isGifFile(file: File) {
  return file.type === "image/gif" || /\.gif$/i.test(file.name);
}

export function isUawFile(file: File) {
  return /\.uaw$/i.test(file.name);
}

export function isVideoFile(file: File) {
  return file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|ogv)$/i.test(file.name);
}

type FrameMeta = { mediaTime: number };
type RvfcVideo = HTMLVideoElement & Pick<VideoLike, "requestVideoFrameCallback" | "cancelVideoFrameCallback">;

const COMMON_FPS = [12, 15, 20, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

/** Seeks and resolves once the frame at `time` can be drawn. */
export function seekVideo(video: VideoLike, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 1e-4 && video.readyState >= 2 && !video.seeking) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("The video stopped responding while seeking."));
    }, 10000);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The video could not be decoded."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = time;
  });
}

/**
 * Measures the frame rate by playing a few frames (muted) and timing them, then snaps
 * to a common rate. Browsers don't expose it directly. Falls back to 30.
 */
async function measureFps(video: HTMLVideoElement): Promise<number> {
  const v = video as RvfcVideo;
  if (!v.requestVideoFrameCallback) return 30;
  const times: number[] = [];
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, 1500);
    const onFrame = (_now: number, meta: FrameMeta) => {
      if (done) return;
      times.push(meta.mediaTime);
      if (times.length >= 14) {
        clearTimeout(timer);
        finish();
      } else {
        v.requestVideoFrameCallback!(onFrame);
      }
    };
    v.requestVideoFrameCallback!(onFrame);
    video.play().catch(finish);
  });
  video.pause();
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i]! - times[i - 1]!;
    if (d > 0.001) deltas.push(d);
  }
  if (deltas.length < 4) return 30;
  deltas.sort((a, b) => a - b);
  const raw = 1 / deltas[deltas.length >> 1]!;
  let best = 30;
  for (const f of COMMON_FPS) if (Math.abs(f - raw) < Math.abs(best - raw)) best = f;
  return Math.abs(best - raw) / raw < 0.04 ? best : Math.round(raw * 100) / 100;
}

/** Loads a video file into a paused, muted element showing its first frame. */
export async function loadVideo(file: File): Promise<VideoMedia> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.loop = false;
  try {
    // What the browser can open depends on the browser: MP4 / MOV / WEBM nearly everywhere,
    // MKV in Chrome and Edge, and only with video it has a decoder for (H.264, VP9, AV1;
    // HEVC only on some devices).
    const cantPlay = /\.mkv$/i.test(file.name)
      ? "This browser can't play this MKV. Chrome and Edge open MKV files with H.264, VP9 or AV1 video; otherwise convert it to MP4 first."
      : "This browser can't play that video format. Try converting it to MP4 (H.264).";
    await new Promise<void>((resolve, reject) => {
      // some unsupported files never report an error: don't wait forever
      const timer = setTimeout(() => reject(new Error(cantPlay)), 15000);
      video.addEventListener(
        "loadeddata",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error(cantPlay));
        },
        { once: true },
      );
      video.src = url;
    });
    if (!video.videoWidth || !video.videoHeight) throw new Error("The file has no video track.");
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("The video's length can't be read.");
    }
    const fps = await measureFps(video);    // plays a few frames to time them
    video.pause();
    await seekVideo(video, 0);
    video.pause();                          // hand it over paused on its first frame
    return {
      kind: "video",
      el: video,
      source: video,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      fps,
      format: "video",
      dispose: () => {
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      },
    };
  } catch (err) {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Plays a list of frames with the same interface as a <video>: play / pause,
 * currentTime, and the events the designer listens for. The current frame is in
 * `canvas`. Used for animated GIFs and .uaw files.
 */
export class FramePlayer extends EventTarget implements VideoLike {
  readonly canvas: HTMLCanvasElement;
  readonly duration: number;
  readonly readyState = 4;
  readonly seeking = false;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly ends: number[]; // when each frame stops showing
  private readonly seekFrame: (index: number) => boolean;
  private time = 0;
  private playing = false;
  private raf = 0;
  private lastTick = 0;

  /**
   * @param rgba the decoder's picture buffer (width * height * 4), updated by seekFrame
   * @param ends when each frame stops showing, in seconds (the last is the length)
   * @param seekFrame makes `rgba` show a frame; false if it already did
   */
  constructor(width: number, height: number, rgba: Uint8ClampedArray, ends: number[], seekFrame: (index: number) => boolean) {
    super();
    this.ends = ends;
    this.seekFrame = seekFrame;
    this.duration = ends[ends.length - 1]!;
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.image = new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height);
    this.show();
  }

  get paused() {
    return !this.playing;
  }

  get currentTime() {
    return this.time;
  }

  set currentTime(t: number) {
    this.time = Math.max(0, Math.min(Number.isFinite(t) ? t : 0, this.duration));
    this.lastTick = performance.now();
    this.show();
    setTimeout(() => this.dispatchEvent(new Event("seeked")), 0);
  }

  play(): Promise<void> {
    if (!this.playing) {
      if (this.time >= this.duration) this.time = 0;
      this.playing = true;
      this.lastTick = performance.now();
      this.raf = requestAnimationFrame(this.tick);
      this.dispatchEvent(new Event("play"));
    }
    return Promise.resolve();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.dispatchEvent(new Event("pause"));
  }

  private tick = (now: number) => {
    if (!this.playing) return;
    this.time += (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (this.time >= this.duration) {
      // like a video without `loop`: stop on the last frame and say so
      this.time = this.duration;
      this.playing = false;
      this.show();
      this.dispatchEvent(new Event("pause"));
      this.dispatchEvent(new Event("ended"));
      return;
    }
    this.show();
    this.raf = requestAnimationFrame(this.tick);
  };

  // Puts the frame for the current time on the canvas.
  private show() {
    // (binary search: a .uaw can have thousands of frames)
    let lo = 0, hi = this.ends.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.time >= this.ends[mid]!) lo = mid + 1;
      else hi = mid;
    }
    if (this.seekFrame(lo)) this.ctx.putImageData(this.image, 0, 0);
  }
}

/**
 * Loads an animated GIF as a video source. Resolves null for a GIF with a single frame
 * (a still: load it as an image instead).
 */
export async function loadGif(file: File): Promise<VideoMedia | null> {
  const gif = parseGif(new Uint8Array(await file.arrayBuffer()));
  if (gif.frames.length < 2) return null;
  const comp = new GifCompositor(gif);
  let t = 0;
  const ends = gif.frames.map((f) => (t += f.delay));
  const player = new FramePlayer(gif.width, gif.height, comp.rgba, ends, (i) => comp.seek(i));
  return {
    kind: "video",
    el: player,
    source: player.canvas,
    width: gif.width,
    height: gif.height,
    duration: gif.duration,
    // average rate (frame delays may vary): exporting at it yields one frame per GIF frame
    fps: Math.round((gif.frames.length / gif.duration) * 100) / 100,
    format: "gif",
    dispose: () => player.pause(),
  };
}

/** Loads an Ultrahand animated wallpaper (.uaw) as a video source. */
export async function loadUaw(file: File): Promise<VideoMedia> {
  const dec = new UawDecoder(new Uint8Array(await file.arrayBuffer()));
  const ends = Array.from({ length: dec.frames }, (_, i) => (i + 1) / dec.fps);
  const player = new FramePlayer(448, 720, dec.rgba, ends, (i) => dec.seek(i));
  return {
    kind: "video",
    el: player,
    source: player.canvas,
    width: 448,
    height: 720,
    duration: dec.frames / dec.fps,
    fps: Math.round(dec.fps * 100) / 100,
    format: "uaw",
    dispose: () => player.pause(),
  };
}

export function disposeMedia(media: Media | null) {
  if (media?.kind === "video") media.dispose();
}
