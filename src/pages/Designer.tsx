import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useHistory } from "@/hooks/use-history";
import { UploadZone } from "@/components/UploadZone";
import { EditorCanvas, type OverlayMode } from "@/components/EditorCanvas";
import { AdjustmentsPanel } from "@/components/AdjustmentsPanel";
import { TransformPanel, type Background } from "@/components/TransformPanel";
import { VideoPanel, type ExportProgress, type VideoSettings, formatBytes } from "@/components/VideoPanel";
import { VideoTransport } from "@/components/VideoTransport";
import {
  type Adjustments,
  type PreviewDepth,
  type Transform,
  DEFAULT_ADJUSTMENTS,
  FRAME_H,
  FRAME_W,
  renderToCanvas,
} from "@/lib/imageProcessing";
import { type Media, disposeMedia, isVideoFile, loadVideo } from "@/lib/media";
import { exportUaw, uawFrameCount } from "@/lib/uawExport";
import { ChevronLeft, ChevronRight, FileImage, Film, Layers, Redo2, Undo2, X } from "lucide-react";

const DEFAULT_TRANSFORM: Transform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
};

type Doc = {
  transform: Transform;
  adjustments: Adjustments;
  background: Background;
};

const DEFAULT_DOC: Doc = {
  transform: DEFAULT_TRANSFORM,
  adjustments: DEFAULT_ADJUSTMENTS,
  background: { kind: "transparent" },
};

export function Designer() {
  const { toast } = useToast();
  // What is being edited: a still image, or a video (animated wallpaper).
  const [media, setMedia] = useState<Media | null>(null);
  const mediaRef = useRef<Media | null>(null);
  const video = media?.kind === "video" ? media : null;
  // Swaps the edited media, releasing the previous video (element + object URL).
  const replaceMedia = useCallback((next: Media | null) => {
    if (mediaRef.current !== next) disposeMedia(mediaRef.current);
    mediaRef.current = next;
    setMedia(next);
  }, []);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [fileName, setFileName] = useState<string>("wallpaper");
  const [exporting, setExporting] = useState<null | "rgba" | "png" | "uaw">(null);
  // Preview colour depth: as stored (default), or as RGBA4444 output looks.
  const [previewDepth, setPreviewDepth] = useState<PreviewDepth>("8888");

  // Video only: the part to use, its frame rate and quality; and playback state.
  const [videoSettings, setVideoSettings] = useState<VideoSettings>({ start: 0, end: 0, fps: 30, quality: 10 });
  const videoSettingsRef = useRef(videoSettings);
  videoSettingsRef.current = videoSettings;
  const [playing, setPlaying] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportingRef = useRef(exporting);
  exportingRef.current = exporting;
  // compactHeader is hoisted here so sidebarOpen can be derived from it
  // before the displayScale effect (which needs the sidebar width).
  const headerRef = useRef<HTMLElement>(null);
  const [compactHeader, setCompactHeader] = useState(false);

  // Two independent memories — one per layout mode.
  // Toggling always writes to the current mode's memory, so resizing
  // back and forth always restores the right state for each mode.
  const [sidebarOpenNormal, setSidebarOpenNormal] = useState(true);
  const [sidebarOpenCompact, setSidebarOpenCompact] = useState(false);
  const sidebarOpen = compactHeader ? sidebarOpenCompact : sidebarOpenNormal;
  const setSidebarOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      if (compactHeader) {
        setSidebarOpenCompact((p) => (typeof next === "function" ? next(p) : next));
      } else {
        setSidebarOpenNormal((p) => (typeof next === "function" ? next(p) : next));
      }
    },
    [compactHeader],
  );

  const [recaching, setRecaching] = useState(false);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("ultrahand");

  const { state: doc, set: setDoc, commit, undo, redo, reset, canUndo, canRedo } =
    useHistory<Doc>(DEFAULT_DOC);
  const { transform, adjustments, background } = doc;

  const setTransform = useCallback(
    (next: Transform) => setDoc((d) => ({ ...d, transform: next })),
    [setDoc],
  );
  const setAdjustments = useCallback(
    (next: Adjustments) => setDoc((d) => ({ ...d, adjustments: next })),
    [setDoc],
  );
  const setBackground = useCallback(
    (next: Background) => setDoc((d) => ({ ...d, background: next })),
    [setDoc],
  );

  const isVideo = !!video;

  // Responsive display scale for the preview canvas
  const [displayScale, setDisplayScale] = useState(1);
  useEffect(() => {
    const compute = () => {
      const h = window.innerHeight;
      const w = window.innerWidth;
      const maxH = h - 150 - (isVideo ? 44 : 0); // room for the transport bar
      const sidebarW = sidebarOpen ? 320 : 0;
      const maxW = w - sidebarW - 96;
      const s = Math.max(
        0.4,
        Math.min(1, Math.min(maxH / FRAME_H, maxW / FRAME_W)),
      );
      setDisplayScale(s);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [sidebarOpen, isVideo]);

  const loadFile = useCallback(
    (file: File) => {
      if (isVideoFile(file)) {
        setLoadingVideo(true);
        loadVideo(file)
          .then((m) => {
            replaceMedia(m);
            reset(DEFAULT_DOC);
            setFileName(file.name.replace(/\.[^.]+$/, "") || "wallpaper");
            // the video's own rate when the overlay can play it, else 30
            setVideoSettings({ start: 0, end: m.duration, fps: m.fps <= 30 ? m.fps : 30, quality: 10 });
            setVideoTime(0);
          })
          .catch((err) => {
            toast({
              title: "Couldn't load video",
              description: (err as Error).message,
              variant: "destructive",
            });
          })
          .finally(() => setLoadingVideo(false));
        return;
      }

      const asImage = (img: HTMLImageElement): Media => ({
        kind: "image",
        el: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      const isRgba = /\.rgba$/i.test(file.name);

      if (isRgba) {
        // Raw RGBA8888 — Ultrahand wallpaper format. The format has no
        // header, so we can't infer dimensions from the file itself; the
        // byte count must match exactly FRAME_W × FRAME_H × 4. Anything
        // else gets rejected to avoid loading garbage.
        const expectedBytes = FRAME_W * FRAME_H * 4;
        if (file.size !== expectedBytes) {
          toast({
            title: "Invalid .rgba file",
            description: `Expected ${expectedBytes.toLocaleString()} bytes (${FRAME_W} × ${FRAME_H} RGBA8888), got ${file.size.toLocaleString()}.`,
            variant: "destructive",
          });
          return;
        }
        file
          .arrayBuffer()
          .then((buf) => {
            // ImageData wants a Uint8ClampedArray of length width*height*4.
            const data = new Uint8ClampedArray(buf);
            const imageData = new ImageData(data, FRAME_W, FRAME_H);
            const canvas = document.createElement("canvas");
            canvas.width = FRAME_W;
            canvas.height = FRAME_H;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              toast({
                title: "Couldn't decode .rgba",
                description: "Canvas 2D context unavailable.",
                variant: "destructive",
              });
              return;
            }
            ctx.putImageData(imageData, 0, 0);
            // Convert to a PNG data URL so the rest of the pipeline (which
            // expects an HTMLImageElement) needs no special-casing.
            const url = canvas.toDataURL("image/png");
            const img = new Image();
            img.onload = () => {
              replaceMedia(asImage(img));
              reset(DEFAULT_DOC);
              setFileName(file.name.replace(/\.[^.]+$/, "") || "wallpaper");
            };
            img.onerror = () => {
              toast({
                title: "Couldn't load image",
                description: "Failed to render decoded RGBA data.",
                variant: "destructive",
              });
            };
            img.src = url;
          })
          .catch((err) => {
            toast({
              title: "Couldn't read .rgba",
              description: (err as Error).message,
              variant: "destructive",
            });
          });
        return;
      }

      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        replaceMedia(asImage(img));
        reset(DEFAULT_DOC);
        setFileName(file.name.replace(/\.[^.]+$/, "") || "wallpaper");
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        toast({
          title: "Couldn't load image",
          description: "That file doesn't appear to be a valid image.",
          variant: "destructive",
        });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
    [toast, reset, replaceMedia],
  );

  // Fit: cover (scale=1, both centered) — preserves the current rotation
  const handleFit = useCallback(() => {
    setTransform({ scale: 1, offsetX: 0, offsetY: 0, rotation: transform.rotation });
  }, [transform.rotation, setTransform]);

  // Fit W: center horizontally (X axis), keep scale and vertical position
  const handleFitH = useCallback(() => {
    setTransform({ ...transform, offsetX: 0 });
  }, [transform, setTransform]);

  // Fit H: center vertically (Y axis), keep scale and horizontal position
  const handleFitV = useCallback(() => {
    setTransform({ ...transform, offsetY: 0 });
  }, [transform, setTransform]);

  // Rotate by ±90°, normalized to [0, 360). Uses (x % 360 + 360) % 360
  // so we never end up with negatives even when rotating left from 0.
  const handleRotateLeft = useCallback(() => {
    setTransform({
      ...transform,
      rotation: (((transform.rotation - 90) % 360) + 360) % 360,
    });
  }, [transform, setTransform]);

  const handleRotateRight = useCallback(() => {
    setTransform({
      ...transform,
      rotation: (transform.rotation + 90) % 360,
    });
  }, [transform, setTransform]);

  const handleClear = useCallback(() => {
    exportAbortRef.current?.abort();
    replaceMedia(null);
    setFileName("wallpaper");
    reset(DEFAULT_DOC);
  }, [reset, replaceMedia]);

  const renderExportCanvas = useCallback(() => {
    if (!media) throw new Error("Nothing loaded");
    const canvas = document.createElement("canvas");
    canvas.width = FRAME_W;
    canvas.height = FRAME_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D context unavailable");
    // (a video exports the frame on screen)
    renderToCanvas(ctx, media.el, media.width, media.height, transform, adjustments, {
      quality: "export",
      background,
    });
    return { canvas, ctx };
  }, [media, transform, adjustments, background]);

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const safeName = useMemo(() => {
    const trimmed = (fileName || "").trim();
    const cleaned = trimmed.replace(/[\\/:*?"<>|]/g, "_");
    return cleaned || "wallpaper";
  }, [fileName]);

  const handleExportRgba = useCallback(async () => {
    if (!media) return;
    setExporting("rgba");
    try {
      const { ctx } = renderExportCanvas();
      const imageData = ctx.getImageData(0, 0, FRAME_W, FRAME_H);
      const blob = new Blob([imageData.data.buffer], {
        type: "application/octet-stream",
      });
      triggerDownload(blob, `${safeName}.rgba`);
      toast({
        title: "Wallpaper exported",
        description: `${safeName}.rgba · 448 × 720 raw RGBA8888 (${imageData.data.byteLength.toLocaleString()} bytes)`,
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  }, [media, renderExportCanvas, safeName, toast]);

  const handleExportPng = useCallback(async () => {
    if (!media) return;
    setExporting("png");
    try {
      const { canvas } = renderExportCanvas();
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) throw new Error("Failed to encode PNG");
      triggerDownload(blob, `${safeName}.png`);
      toast({
        title: "Wallpaper exported",
        description: `${safeName}.png · 448 × 720 RGBA PNG`,
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  }, [media, renderExportCanvas, safeName, toast]);

  // ==== Video: animated wallpaper (.uaw) export ====
  const videoFrames = video ? uawFrameCount(videoSettings.start, videoSettings.end, videoSettings.fps) : 0;

  const handleExportUaw = useCallback(async () => {
    if (!video || exportingRef.current) return;
    const { start, end, fps, quality } = videoSettingsRef.current;
    const abort = new AbortController();
    exportAbortRef.current = abort;
    setExporting("uaw");
    setExportProgress({ done: 0, total: uawFrameCount(start, end, fps), bytes: 32 });
    try {
      const { blob, stats, fpsNum, fpsDen } = await exportUaw({
        media: video,
        transform,
        adjustments,
        background,
        start,
        end,
        fps,
        quality,
        signal: abort.signal,
        onProgress: (done, total, st) => setExportProgress({ done, total, bytes: st.bytes }),
      });
      triggerDownload(blob, `${safeName}.uaw`);
      const seconds = stats.frames / (fpsNum / fpsDen);
      toast({
        title: "Animated wallpaper exported",
        description: `${safeName}.uaw · ${stats.frames} frames at ${+(fpsNum / fpsDen).toFixed(2)} fps · ${formatBytes(blob.size)} (${(blob.size / 1e6 / seconds).toFixed(2)} MB/s while playing)`,
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast({ title: "Export failed", description: (err as Error).message, variant: "destructive" });
      }
    } finally {
      exportAbortRef.current = null;
      setExportProgress(null);
      setExporting(null);
    }
  }, [video, transform, adjustments, background, safeName, toast]);

  // ==== Video: playback (looping the chosen range) ====
  useEffect(() => {
    if (!video) {
      setPlaying(false);
      return;
    }
    const el = video.el;
    const restart = () => {
      if (exportingRef.current) return;
      el.currentTime = videoSettingsRef.current.start;
      void el.play().catch(() => {});
    };
    // The button always mirrors the element itself (never a remembered guess): set now,
    // on every play / pause event, and re-checked each frame below.
    const syncPlaying = () => setPlaying(!el.paused);
    syncPlaying();
    const onPlay = syncPlaying;
    const onPause = syncPlaying;
    const onSeeked = () => setVideoTime(el.currentTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("ended", restart);
    let raf = 0;
    let lastShown = 0;
    const tick = (now: number) => {
      syncPlaying();                          // (no re-render when unchanged)
      if (!el.paused && !exportingRef.current) {
        if (el.currentTime >= videoSettingsRef.current.end - 0.005) restart();
        if (now - lastShown > 100) {          // the readout: 10 times a second is plenty
          lastShown = now;
          setVideoTime(el.currentTime);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("ended", restart);
    };
  }, [video]);

  const togglePlay = useCallback(() => {
    if (!video || exportingRef.current) return;
    const el = video.el;
    if (!el.paused) {
      el.pause();
      return;
    }
    const { start, end } = videoSettingsRef.current;
    if (el.currentTime < start || el.currentTime >= end - 0.005) el.currentTime = start;
    void el.play().catch(() => {});
  }, [video]);

  const seekTo = useCallback(
    (t: number) => {
      if (!video || exportingRef.current) return;
      video.el.currentTime = Math.max(0, Math.min(t, video.duration));
      setVideoTime(t);
    },
    [video],
  );

  // Changing the range shows the frame at the edge being moved (while paused).
  const changeVideoSettings = useCallback(
    (next: VideoSettings) => {
      const prev = videoSettingsRef.current;
      setVideoSettings(next);
      if (!video || !video.el.paused) return;
      if (next.start !== prev.start) seekTo(next.start);
      else if (next.end !== prev.end) seekTo(Math.max(next.start, next.end - 1 / next.fps));
    },
    [video, seekTo],
  );

  // Release the video when the page goes away.
  useEffect(() => () => disposeMedia(mediaRef.current), []);

  const dimensionLabel = useMemo(
    () => (media ? `${media.width} × ${media.height}` : null),
    [media],
  );

  // Selection state
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(false);

  // Drag-over state for the replace-image drop target
  const [draggingOver, setDraggingOver] = useState(false);
  const dragCounterRef = useRef(0); // tracks nested dragenter/dragleave pairs

  // Compact-mode: the action buttons in the header drop their text
  // labels when there isn't enough horizontal room for them to render
  // neatly. We observe the header element itself (the scroll container)
  // so this reacts to viewport changes, sidebar open/close, and any
  // future content added to the header.
  //
  // Below ~520px the labels collapse to icon-only. Below the natural
  // width of banner + icon-only buttons + padding (~250px), the header
  // becomes horizontally scrollable so nothing ever truly overlaps.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const THRESHOLD = 520;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setCompactHeader(width < THRESHOLD);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const tgt = e.target as Node | null;
      if (!tgt) return;
      // If the clicked element (or any ancestor) is marked data-preserve-selection,
      // don't change the current selection state at all — e.g. TransformPanel buttons
      // that update the transform but should keep the image focused with handles visible.
      if ((tgt as Element).closest?.("[data-preserve-selection]")) return;
      if (editorAreaRef.current && editorAreaRef.current.contains(tgt)) {
        setSelected(true);
      } else {
        setSelected(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);
  useEffect(() => {
    if (!media) setSelected(false);
  }, [media]);

  // Paste image from clipboard
  const loadFileRef = useRef(loadFile);
  loadFileRef.current = loadFile;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            loadFileRef.current(file);
          }
          break;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Undo / Redo / Delete keyboard shortcuts
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;
  const handleClearRef = useRef(handleClear);
  handleClearRef.current = handleClear;
  const imageRef = useRef(media);
  imageRef.current = media;
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (tgt?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      // Space → play / pause a loaded video
      if (k === " " && !mod && imageRef.current?.kind === "video" && tag !== "BUTTON") {
        e.preventDefault();
        togglePlayRef.current();
        return;
      }
      // Delete / Backspace → clear the loaded image
      if ((k === "Delete" || k === "Backspace") && !mod && imageRef.current) {
        e.preventDefault();
        handleClearRef.current();
        return;
      }
      if (!mod) return;
      const kl = k.toLowerCase();
      if (kl === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      } else if ((kl === "z" && e.shiftKey) || kl === "y") {
        e.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Shared SW update logic.
  // silent=true → no toast when already up to date (used on mount).
  // silent=false → toasts for all outcomes (used on logo click).
  //
  // We set the swJustUpdated flag BEFORE triggering the update, then
  // clear it only if we determine no reload will happen. This is robust
  // against the reload coming from any path — our own controllerchange
  // listener, vite-plugin-pwa's internal listener, or the browser's
  // natural SW lifecycle. As long as a reload happens for any reason
  // while the flag is set, the post-reload toast fires.
  const checkForUpdate = useCallback(async (silent: boolean) => {
    if (!("serviceWorker" in navigator)) return;
    sessionStorage.setItem("swJustUpdated", "1");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        sessionStorage.removeItem("swJustUpdated");
        return;
      }

      await reg.update();

      const activate = (sw: ServiceWorker) => {
        sw.postMessage({ type: "SKIP_WAITING" });
      };

      if (reg.waiting) {
        activate(reg.waiting);
        return;
      }

      if (reg.installing) {
        reg.installing.addEventListener("statechange", function () {
          if (this.state === "installed" && reg.waiting) activate(reg.waiting);
        });
        return;
      }

      // No update found — clear the pre-set flag so the next mount
      // doesn't show a stale "App updated" toast.
      sessionStorage.removeItem("swJustUpdated");
      if (!silent) {
        toast({ title: "Already up to date", description: "App is current." });
      }
    } catch {
      sessionStorage.removeItem("swJustUpdated");
      if (!silent) {
        toast({ title: "Server unreachable", description: "Using cached version." });
      }
    }
  }, [toast]);

  const toastRef = useRef(toast);
  toastRef.current = toast;
  const checkForUpdateRef = useRef(checkForUpdate);
  checkForUpdateRef.current = checkForUpdate;

  // Permanent listener for SW takeovers from any source: vite-plugin-pwa's
  // background auto-update, manual SKIP_WAITING (logo click), browser's
  // natural SW lifecycle, etc. Without this, auto-updates would activate
  // silently and the user would never know the app refreshed.
  //
  // Skip the first event if no controller existed when we mounted — that's
  // the page acquiring its initial SW on a fresh visit, not an update.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    let suppressedFirstChange = false;
    const onControllerChange = () => {
      if (!hadController && !suppressedFirstChange) {
        suppressedFirstChange = true;
        return;
      }
      sessionStorage.setItem("swJustUpdated", "1");
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem("swJustUpdated")) {
      sessionStorage.removeItem("swJustUpdated");
      toastRef.current({ title: "App updated", description: "You're now running the latest version." });
    }
    checkForUpdateRef.current(true);
  }, []);

  const handleLogoClick = useCallback(async () => {
    if (recaching) return;
    setRecaching(true);
    await checkForUpdate(false);
    setRecaching(false);
  }, [recaching, checkForUpdate]);

  return (
    <div className="h-screen w-full flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header — horizontally scrollable when content is too wide to fit.
          Both the banner and the action buttons keep their natural widths
          (flex-shrink-0); ml-auto pushes the buttons to the right whenever
          there's spare room, otherwise the user can scroll. */}
      <header
        ref={headerRef}
        className="flex items-center gap-3 px-6 py-3 border-b bg-card/50 backdrop-blur overflow-x-auto overflow-y-hidden"
      >
        <div className="flex items-center gap-3 flex-shrink-0">
          <img
            src={`${import.meta.env.BASE_URL}ultrahand_banner.png`}
            alt="Ultrahand"
            onClick={handleLogoClick}
            className={`h-9 w-auto select-none cursor-pointer transition-opacity ${recaching ? "opacity-50 animate-pulse" : "hover:opacity-80"}`}
            draggable={false}
            title="Click to check for updates"
            data-testid="banner"
          />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {video && (
            <Button
              size="sm"
              onClick={handleExportUaw}
              disabled={exporting !== null}
              data-testid="export-uaw"
              title="Export as an animated wallpaper (.uaw)"
              aria-label="Export as UAW"
              className="bg-[#ff3b3b]/20 text-white hover:bg-[#ff3b3b]/30 border-transparent"
            >
              <Film className={`h-3.5 w-3.5 ${compactHeader ? "" : "mr-1.5"}`} />
              {!compactHeader && (
                <span>
                  {exporting === "uaw" && exportProgress
                    ? `${Math.round((exportProgress.done / Math.max(1, exportProgress.total)) * 100)}%`
                    : "UAW"}
                </span>
              )}
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleExportPng}
            disabled={!media || exporting !== null}
            data-testid="export-png"
            title={video ? "Export the frame shown as PNG" : "Export as PNG"}
            aria-label="Export as PNG"
            className="bg-[#22ff66]/20 text-white hover:bg-[#22ff66]/30 border-transparent"
          >
            <FileImage className={`h-3.5 w-3.5 ${compactHeader ? "" : "mr-1.5"}`} />
            {!compactHeader && <span>{exporting === "png" ? "Exporting…" : "PNG"}</span>}
          </Button>
          <Button
            size="sm"
            onClick={handleExportRgba}
            disabled={!media || exporting !== null}
            data-testid="export-rgba"
            title={video ? "Export the frame shown as RGBA" : "Export as RGBA"}
            aria-label="Export as RGBA"
            className="bg-primary/20 text-white hover:bg-primary/30 border-transparent"
          >
            <FileImage className={`h-3.5 w-3.5 ${compactHeader ? "" : "mr-1.5"}`} />
            {!compactHeader && <span>{exporting === "rgba" ? "Exporting…" : "RGBA"}</span>}
          </Button>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex min-h-0">
        {/* Canvas area */}
        <main className="flex-1 flex items-center justify-center p-8 bg-black min-w-0">
          <div className="flex flex-col items-center gap-3">
            <div
              ref={editorAreaRef}
              style={{ width: FRAME_W * displayScale, height: FRAME_H * displayScale }}
              onDragEnter={media ? (e) => {
                e.preventDefault();
                dragCounterRef.current += 1;
                if (dragCounterRef.current === 1) setDraggingOver(true);
              } : undefined}
              onDragLeave={media ? () => {
                dragCounterRef.current -= 1;
                if (dragCounterRef.current === 0) setDraggingOver(false);
              } : undefined}
              onDragOver={media ? (e) => e.preventDefault() : undefined}
              onDrop={media ? (e) => {
                e.preventDefault();
                dragCounterRef.current = 0;
                setDraggingOver(false);
                const file = e.dataTransfer.files[0];
                if (file) loadFile(file);
              } : undefined}
              className="relative"
            >
              {media ? (
                <>
                  <EditorCanvas
                    media={media}
                    previewDepth={previewDepth}
                    transform={transform}
                    adjustments={adjustments}
                    background={background}
                    onTransformChange={setTransform}
                    onCommit={commit}
                    selected={selected}
                    displayScale={displayScale}
                    overlayMode={overlayMode}
                  />
                  {/* Drop-to-replace overlay — shown while dragging a new image over the canvas */}
                  {draggingOver && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded pointer-events-none"
                      style={{ background: "rgba(0,0,0,0.6)", border: "2px dashed #22ff66", boxShadow: "0 0 16px rgba(34,255,102,0.35)" }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22ff66" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      <span className="text-sm font-medium" style={{ color: "#22ff66" }}>Drop to replace</span>
                    </div>
                  )}
                </>
              ) : (
                <UploadZone onFile={loadFile} />
              )}
              {loadingVideo && (
                <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-black/70 text-sm text-muted-foreground">
                  Loading video…
                </div>
              )}
            </div>

            {/* Video: play / pause + scrub, right under the picture */}
            {video && (
              <div style={{ width: FRAME_W * displayScale }}>
                <VideoTransport
                  playing={playing}
                  time={videoTime}
                  duration={video.duration}
                  start={videoSettings.start}
                  end={videoSettings.end}
                  disabled={exporting !== null}
                  onToggle={togglePlay}
                  onSeek={seekTo}
                />
              </div>
            )}

            {/* Below-canvas info row */}
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
              <span>Frame 448 × 720</span>
              {dimensionLabel && (
                <>
                  <span className="opacity-40">•</span>
                  <span>
                    Source {dimensionLabel}
                    {video ? ` · ${video.fps} fps` : ""}
                  </span>
                </>
              )}
              {media && (
                <>
                  <span className="opacity-40">•</span>
                  <button
                    type="button"
                    onClick={() => setPreviewDepth((d) => (d === "8888" ? "4444" : "8888"))}
                    title={
                      previewDepth === "8888"
                        ? "Showing full colour (RGBA8888). Click to preview RGBA4444, as shown on overlay heaps below 8 MB."
                        : "Previewing RGBA4444 (overlay heaps below 8 MB). Click for full colour. Exports are always 8-bit."
                    }
                    data-testid="toggle-depth"
                    data-preview-depth={previewDepth}
                    data-preserve-selection
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
                      previewDepth === "4444"
                        ? "text-[#22ff66] bg-[#22ff66]/10 hover:bg-[#22ff66]/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    {previewDepth === "8888" ? "RGBA8888" : "RGBA4444 preview"}
                  </button>
                  <span className="opacity-40">•</span>
                  <button
                    type="button"
                    onClick={() =>
                      setOverlayMode((m) =>
                        m === "ultrahand" ? "ultragb" : m === "ultragb" ? "off" : "ultrahand",
                      )
                    }
                    title={
                      overlayMode === "ultrahand"
                        ? "Switch to UltraGB overlay"
                        : overlayMode === "ultragb"
                          ? "Hide overlay"
                          : "Show Ultrahand overlay"
                    }
                    data-testid="toggle-overlay"
                    data-overlay-mode={overlayMode}
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
                      overlayMode !== "off"
                        ? "text-[#22ff66] bg-[#22ff66]/10 hover:bg-[#22ff66]/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    <Layers className="h-3 w-3" />
                    {overlayMode === "ultrahand"
                      ? "Ultrahand"
                      : overlayMode === "ultragb"
                        ? "UltraGB"
                        : "off"}
                  </button>
                </>
              )}
            </div>
          </div>
        </main>

        {/* Sidebar */}
        <aside
          className={`relative flex-shrink-0 border-l bg-card flex flex-col transition-[width] duration-200 ease-in-out ${
            sidebarOpen ? "w-80" : "w-0"
          }`}
        >
          {/* Collapse toggle — sits on the left edge, always visible */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="absolute -left-[18px] top-1/2 -translate-y-1/2 z-20 flex h-12 w-[18px] items-center justify-center rounded-l-md border border-r-0 bg-card text-muted-foreground hover:text-foreground shadow-sm"
            title={sidebarOpen ? "Collapse panel" : "Expand panel"}
            aria-label={sidebarOpen ? "Collapse panel" : "Expand panel"}
          >
            {sidebarOpen
              ? <ChevronRight className="h-3 w-3" />
              : <ChevronLeft className="h-3 w-3" />}
          </button>

          {/* Scrollable content — both panels stack naturally */}
          <div className={`overflow-y-auto flex-1 ${sidebarOpen ? "" : "invisible pointer-events-none"}`}>
            {/* File section — undo/redo + output filename */}
            <div className="border-b">
              <div className="flex items-center justify-between px-5 py-4">
                <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                  File
                </h2>
                <div className="flex items-center gap-1.5">
                  {media && (
                    <div className="flex items-center border rounded-md p-0.5 bg-background/60">
                      <button
                        type="button"
                        onClick={handleClear}
                        className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover-elevate hover:text-destructive"
                        aria-label="Clear"
                        title={video ? "Clear video" : "Clear image"}
                        data-testid="clear-image"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-0.5 border rounded-md p-0.5 bg-background/60">
                    <button
                      type="button"
                      onClick={undo}
                      disabled={!canUndo}
                      className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover-elevate disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      aria-label="Undo"
                      title="Undo (⌘Z)"
                      data-testid="undo"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={redo}
                      disabled={!canRedo}
                      className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover-elevate disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      aria-label="Redo"
                      title="Redo (⇧⌘Z)"
                      data-testid="redo"
                    >
                      <Redo2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="px-5 pb-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Filename</span>
                  <span className="text-muted-foreground tabular-nums">{video ? ".uaw / .png / .rgba" : ".png / .rgba"}</span>
                </div>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="wallpaper"
                  disabled={!media}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="filename-input"
                  aria-label="Output filename"
                />
                {!media && (
                  <p className="text-[11px] text-muted-foreground">
                    Load an image or video to set the output name.
                  </p>
                )}
              </div>
            </div>

            {video && (
              <VideoPanel
                settings={videoSettings}
                onChange={changeVideoSettings}
                duration={video.duration}
                sourceFps={video.fps}
                time={videoTime}
                frames={videoFrames}
                progress={exportProgress}
                onCancelExport={() => exportAbortRef.current?.abort()}
              />
            )}
            <TransformPanel
              transform={transform}
              onChange={setTransform}
              onFit={handleFit}
              onFitH={handleFitH}
              onFitV={handleFitV}
              onReset={() => setTransform(DEFAULT_TRANSFORM)}
              onRotateLeft={handleRotateLeft}
              onRotateRight={handleRotateRight}
              background={background}
              onBackgroundChange={setBackground}
              hasImage={!!media}
              isVideo={!!video}
            />
            <AdjustmentsPanel
              adjustments={adjustments}
              onChange={setAdjustments}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
