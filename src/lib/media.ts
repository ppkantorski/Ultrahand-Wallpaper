// What the designer edits: a still image or a video. Both draw through renderToCanvas.

export type ImageMedia = {
  kind: "image";
  el: HTMLImageElement;
  width: number;
  height: number;
};

export type VideoMedia = {
  kind: "video";
  el: HTMLVideoElement;
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
  /** The video's own frame rate (measured; 30 when it can't be). */
  fps: number;
  /** Object URL backing the element; revoke when the video is dropped. */
  url: string;
};

export type Media = ImageMedia | VideoMedia;

export function isVideoFile(file: File) {
  return file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|ogv)$/i.test(file.name);
}

type FrameMeta = { mediaTime: number };
type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const COMMON_FPS = [12, 15, 20, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

/** Seeks and resolves once the frame at `time` can be drawn. */
export function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
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
    await new Promise<void>((resolve, reject) => {
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener(
        "error",
        () => reject(new Error("This browser can't play that video format.")),
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
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      fps,
      url,
    };
  } catch (err) {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    throw err;
  }
}

export function disposeMedia(media: Media | null) {
  if (media?.kind !== "video") return;
  media.el.pause();
  media.el.removeAttribute("src");
  media.el.load();
  URL.revokeObjectURL(media.url);
}
