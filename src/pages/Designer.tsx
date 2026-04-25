import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useHistory } from "@/hooks/use-history";
import { UploadZone } from "@/components/UploadZone";
import { EditorCanvas } from "@/components/EditorCanvas";
import { AdjustmentsPanel } from "@/components/AdjustmentsPanel";
import { TransformPanel, type Background } from "@/components/TransformPanel";
import {
  type Adjustments,
  type Transform,
  DEFAULT_ADJUSTMENTS,
  FRAME_H,
  FRAME_W,
  renderToCanvas,
} from "@/lib/imageProcessing";
import { ChevronLeft, ChevronRight, Download, FileImage, Layers, Redo2, Undo2, X } from "lucide-react";

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
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState<string>("wallpaper");
  const [exporting, setExporting] = useState<null | "rgba" | "png">(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [recaching, setRecaching] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);

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

  // Responsive display scale for the preview canvas
  const [displayScale, setDisplayScale] = useState(1);
  useEffect(() => {
    const compute = () => {
      const h = window.innerHeight;
      const w = window.innerWidth;
      const maxH = h - 150;
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
  }, [sidebarOpen]);

  const loadFile = useCallback(
    (file: File) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setImage(img);
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
    [toast, reset],
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
    setImage(null);
    setFileName("wallpaper");
    reset(DEFAULT_DOC);
  }, [reset]);

  const renderExportCanvas = useCallback(() => {
    if (!image) throw new Error("No image loaded");
    const canvas = document.createElement("canvas");
    canvas.width = FRAME_W;
    canvas.height = FRAME_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D context unavailable");
    renderToCanvas(ctx, image, transform, adjustments, {
      quality: "export",
      background,
    });
    return { canvas, ctx };
  }, [image, transform, adjustments, background]);

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
    if (!image) return;
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
  }, [image, renderExportCanvas, safeName, toast]);

  const handleExportPng = useCallback(async () => {
    if (!image) return;
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
  }, [image, renderExportCanvas, safeName, toast]);

  const dimensionLabel = useMemo(
    () => (image ? `${image.naturalWidth} × ${image.naturalHeight}` : null),
    [image],
  );

  // Selection state
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(false);

  // Compact-mode: the action buttons in the header drop their text
  // labels when there isn't enough horizontal room for them to render
  // neatly. We observe the header element itself (the scroll container)
  // so this reacts to viewport changes, sidebar open/close, and any
  // future content added to the header.
  //
  // Below ~520px the labels collapse to icon-only. Below the natural
  // width of banner + icon-only buttons + padding (~250px), the header
  // becomes horizontally scrollable so nothing ever truly overlaps.
  const headerRef = useRef<HTMLElement>(null);
  const [compactHeader, setCompactHeader] = useState(false);
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
    if (!image) setSelected(false);
  }, [image]);

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
  const imageRef = useRef(image);
  imageRef.current = image;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (tgt?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
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
  const checkForUpdate = useCallback(async (silent: boolean) => {
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;

      await reg.update();

      const activate = (sw: ServiceWorker) => {
        sessionStorage.setItem("swJustUpdated", "1");
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => window.location.reload(),
          { once: true },
        );
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

      if (!silent) {
        toast({ title: "Already up to date", description: "App is current." });
      }
    } catch {
      if (!silent) {
        toast({ title: "Server unreachable", description: "Using cached version." });
      }
    }
  }, [toast]);

  const toastRef = useRef(toast);
  toastRef.current = toast;
  const checkForUpdateRef = useRef(checkForUpdate);
  checkForUpdateRef.current = checkForUpdate;
  useEffect(() => {
    if (sessionStorage.getItem("swJustUpdated")) {
      sessionStorage.removeItem("swJustUpdated");
      toastRef.current({ title: "App updated", description: "You're on the latest version." });
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
          {image && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              data-testid="clear-image"
              title="Clear image"
              aria-label="Clear image"
            >
              <X className={`h-3.5 w-3.5 ${compactHeader ? "" : "mr-1.5"}`} />
              {!compactHeader && <span>Clear</span>}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPng}
            disabled={!image || exporting !== null}
            data-testid="export-png"
            title="Export as PNG"
            aria-label="Export as PNG"
          >
            <FileImage className={`h-3.5 w-3.5 ${compactHeader ? "" : "mr-1.5"}`} />
            {!compactHeader && <span>{exporting === "png" ? "Exporting…" : "PNG"}</span>}
          </Button>
          <Button
            size="sm"
            onClick={handleExportRgba}
            disabled={!image || exporting !== null}
            data-testid="export-rgba"
            title="Export as RGBA"
            aria-label="Export as RGBA"
            className="bg-primary/20 text-white hover:bg-primary/30 border-transparent"
          >
            <Download className={`h-3.5 w-3.5 ${compactHeader ? "" : "mr-1.5"}`} />
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
            >
              {image ? (
                <EditorCanvas
                  image={image}
                  transform={transform}
                  adjustments={adjustments}
                  background={background}
                  onTransformChange={setTransform}
                  onCommit={commit}
                  selected={selected}
                  displayScale={displayScale}
                  showOverlay={showOverlay}
                />
              ) : (
                <UploadZone onFile={loadFile} />
              )}
            </div>

            {/* Below-canvas info row */}
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
              <span>Frame 448 × 720</span>
              {dimensionLabel && (
                <>
                  <span className="opacity-40">•</span>
                  <span>Source {dimensionLabel}</span>
                </>
              )}
              {image && (
                <>
                  <span className="opacity-40">•</span>
                  <button
                    type="button"
                    onClick={() => setShowOverlay((v) => !v)}
                    title={showOverlay ? "Hide overlay frame" : "Show overlay frame"}
                    data-testid="toggle-overlay"
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
                      showOverlay
                        ? "text-[#22ff66] bg-[#22ff66]/10 hover:bg-[#22ff66]/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    <Layers className="h-3 w-3" />
                    Overlay {showOverlay ? "on" : "off"}
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
              <div className="px-5 pb-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Filename</span>
                  <span className="text-muted-foreground tabular-nums">.png / .rgba</span>
                </div>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="wallpaper"
                  disabled={!image}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="filename-input"
                  aria-label="Output filename"
                />
                {!image && (
                  <p className="text-[11px] text-muted-foreground">
                    Load an image to set the output name.
                  </p>
                )}
              </div>
            </div>

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
              hasImage={!!image}
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
