import { useEffect, useRef, useCallback, useMemo } from "react";
import {
  type Adjustments,
  type Transform,
  FRAME_W,
  FRAME_H,
  renderToCanvas,
} from "@/lib/imageProcessing";
import { type Background } from "./TransformPanel";

export type OverlayMode = "ultrahand" | "ultragb" | "off";

type Props = {
  image: HTMLImageElement;
  transform: Transform;
  adjustments: Adjustments;
  background: Background;
  selected?: boolean;
  onTransformChange: (next: Transform) => void;
  onCommit?: () => void;
  displayScale?: number;
  overlayMode?: OverlayMode;
};

type HandleId = "tl" | "tr" | "bl" | "br" | "l" | "r" | "t" | "b";

type HandleInfo = {
  cursor: string;
  ax: number;
  ay: number;
  hx: number;
  hy: number;
  axes: "w" | "h" | "both";
};

const HANDLES: Record<HandleId, HandleInfo> = {
  tl: { cursor: "nwse-resize", ax: 1, ay: 1, hx: 0, hy: 0, axes: "both" },
  tr: { cursor: "nesw-resize", ax: 0, ay: 1, hx: 1, hy: 0, axes: "both" },
  bl: { cursor: "nesw-resize", ax: 1, ay: 0, hx: 0, hy: 1, axes: "both" },
  br: { cursor: "nwse-resize", ax: 0, ay: 0, hx: 1, hy: 1, axes: "both" },
  l:  { cursor: "ew-resize",   ax: 1, ay: 0.5, hx: 0, hy: 0.5, axes: "w" },
  r:  { cursor: "ew-resize",   ax: 0, ay: 0.5, hx: 1, hy: 0.5, axes: "w" },
  t:  { cursor: "ns-resize",   ax: 0.5, ay: 1, hx: 0.5, hy: 0, axes: "h" },
  b:  { cursor: "ns-resize",   ax: 0.5, ay: 0, hx: 0.5, hy: 1, axes: "h" },
};

const HANDLE_IDS = Object.keys(HANDLES) as HandleId[];

const MIN_SCALE = 0.05;
const MAX_SCALE = 12;

export function EditorCanvas({
  image,
  transform,
  adjustments,
  background,
  selected = false,
  onTransformChange,
  onCommit,
  displayScale = 0.7,
  overlayMode = "off",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const onChangeRef = useRef(onTransformChange);
  onChangeRef.current = onTransformChange;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // Track all active pointers for pinch-to-zoom
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);

  // Pan state
  const panRef = useRef<{
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  // Resize state
  const resizeRef = useRef<{
    handle: HandleId;
    startClientX: number;
    startClientY: number;
    startScale: number;
    startDw: number;
    startDh: number;
    anchorX: number;
    anchorY: number;
  } | null>(null);

  // Wheel-zoom lock: while the user is actively scrolling/wheel-zooming we
  // block new pan gestures from starting, and while a pan is active we
  // ignore wheel events. This prevents the Magic Mouse "swipe while dragging"
  // accident where a finger slide mid-pan fires scroll events and resizes.
  const wheelActiveRef = useRef(false);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-render whenever inputs change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    renderToCanvas(ctx, image, transform, adjustments, {
      quality: "preview",
      background,
    });
  }, [image, transform, adjustments, background]);

  // Keyboard nudging
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (tgt?.isContentEditable) return;
      const step = 1;
      let dx = 0;
      let dy = 0;
      switch (e.key) {
        case "ArrowLeft":  dx = -step; break;
        case "ArrowRight": dx =  step; break;
        case "ArrowUp":    dy = -step; break;
        case "ArrowDown":  dy =  step; break;
        default: return;
      }
      e.preventDefault();
      onChangeRef.current({
        ...transformRef.current,
        offsetX: transformRef.current.offsetX + dx,
        offsetY: transformRef.current.offsetY + dy,
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Clean up the wheel debounce timer on unmount
  useEffect(() => {
    return () => {
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, []);

  const imageRect = useMemo(() => {
    const baseScale = Math.max(FRAME_W / image.width, FRAME_H / image.height);
    const dw = image.width * baseScale * transform.scale;
    const dh = image.height * baseScale * transform.scale;
    const cx = FRAME_W / 2 + transform.offsetX;
    const cy = FRAME_H / 2 + transform.offsetY;
    return {
      baseScale,
      dw,
      dh,
      left: cx - dw / 2,
      top: cy - dh / 2,
      right: cx + dw / 2,
      bottom: cy + dh / 2,
    };
  }, [image, transform]);

  // ==== Pan / Pinch handlers ====
  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pts = [...activePointersRef.current.values()];

    if (pts.length >= 2) {
      panRef.current = null;
      const dist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
      pinchRef.current = { startDist: dist, startScale: transformRef.current.scale };
    } else {
      pinchRef.current = null;
      // Don't start a pan while a wheel-zoom gesture is still settling
      if (!wheelActiveRef.current) {
        panRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startOffsetX: transformRef.current.offsetX,
          startOffsetY: transformRef.current.offsetY,
        };
      }
    }
  }, []);

  const onCanvasPointerMove = useCallback(
    (e: React.PointerEvent) => {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...activePointersRef.current.values()];

      if (pts.length >= 2 && pinchRef.current) {
        const dist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
        const factor = dist / pinchRef.current.startDist;
        const next = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, pinchRef.current.startScale * factor),
        );
        onChangeRef.current({ ...transformRef.current, scale: next });
        return;
      }

      const drag = panRef.current;
      if (!drag) return;
      const dx = (e.clientX - drag.startX) / displayScale;
      const dy = (e.clientY - drag.startY) / displayScale;
      onChangeRef.current({
        ...transformRef.current,
        offsetX: drag.startOffsetX + dx,
        offsetY: drag.startOffsetY + dy,
      });
    },
    [displayScale],
  );

  const onCanvasPointerUp = useCallback((e: React.PointerEvent) => {
    activePointersRef.current.delete(e.pointerId);
    const pts = [...activePointersRef.current.values()];

    if (pts.length < 2) {
      if (pinchRef.current) {
        pinchRef.current = null;
        onCommitRef.current?.();
      }
    }

    if (pts.length === 0) {
      if (panRef.current) {
        panRef.current = null;
        onCommitRef.current?.();
      }
    }
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    // If a pointer-pan is in progress, ignore scroll/wheel entirely — this is
    // the main cause of the Magic Mouse "drag then accidentally resize" bug.
    if (panRef.current) return;

    // Mark wheel as active and debounce the "settled" signal so a pan cannot
    // start until the inertial scroll has fully stopped (~300 ms of silence).
    wheelActiveRef.current = true;
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => {
      wheelActiveRef.current = false;
      wheelTimerRef.current = null;
    }, 300);

    const delta = -e.deltaY * 0.0015;
    const next = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, transformRef.current.scale * (1 + delta)),
    );
    onChangeRef.current({ ...transformRef.current, scale: next });
  }, []);

  // ==== Handle drag handlers ====
  const startResize = useCallback(
    (handle: HandleId) => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      const info = HANDLES[handle];
      const anchorX = imageRect.left + info.ax * imageRect.dw;
      const anchorY = imageRect.top + info.ay * imageRect.dh;
      resizeRef.current = {
        handle,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startScale: transform.scale,
        startDw: imageRect.dw,
        startDh: imageRect.dh,
        anchorX,
        anchorY,
      };
    },
    [imageRect, transform.scale],
  );

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const info = HANDLES[r.handle];
      const mdxCanvas = (e.clientX - r.startClientX) / displayScale;
      const mdyCanvas = (e.clientY - r.startClientY) / displayScale;
      const sx = info.hx > info.ax ? 1 : info.hx < info.ax ? -1 : 0;
      const sy = info.hy > info.ay ? 1 : info.hy < info.ay ? -1 : 0;
      const proposedDw = sx === 0 ? r.startDw : r.startDw + sx * mdxCanvas;
      const proposedDh = sy === 0 ? r.startDh : r.startDh + sy * mdyCanvas;
      let factor: number;
      if (info.axes === "w") {
        factor = proposedDw / r.startDw;
      } else if (info.axes === "h") {
        factor = proposedDh / r.startDh;
      } else {
        const fw = proposedDw / r.startDw;
        const fh = proposedDh / r.startDh;
        factor = Math.abs(fw - 1) > Math.abs(fh - 1) ? fw : fh;
      }
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, r.startScale * factor));
      const baseScale = imageRect.baseScale;
      const newDw = image.width * baseScale * newScale;
      const newDh = image.height * baseScale * newScale;
      const newCx = r.anchorX + (0.5 - info.ax) * newDw;
      const newCy = r.anchorY + (0.5 - info.ay) * newDh;
      onChangeRef.current({
        scale: newScale,
        offsetX: newCx - FRAME_W / 2,
        offsetY: newCy - FRAME_H / 2,
      });
    },
    [displayScale, image, imageRect.baseScale],
  );

  const onResizePointerUp = useCallback(() => {
    if (resizeRef.current) {
      resizeRef.current = null;
      onCommitRef.current?.();
    }
  }, []);

  const frameDisplayW = FRAME_W * displayScale;
  const frameDisplayH = FRAME_H * displayScale;

  return (
    <div className="relative" style={{ width: frameDisplayW, height: frameDisplayH }}>
      <div
        className="absolute inset-0 shadow-2xl overflow-hidden checker-bg"
        style={{
          boxShadow:
            "0 0 0 2px #22ff66, 0 0 16px rgba(34, 255, 102, 0.45), 0 25px 50px -12px rgba(0, 0, 0, 0.8)",
        }}
      >
        <canvas
          ref={canvasRef}
          width={FRAME_W}
          height={FRAME_H}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
          onWheel={onWheel}
          className="block w-full h-full cursor-grab active:cursor-grabbing touch-none select-none"
          data-testid="editor-canvas"
        />

        {/* Overlay frame — sits above canvas, never exported, pointer-events off.
            Different modes render different reference frames so users can
            preview against the on-device chrome of different overlays. */}
        {overlayMode !== "off" && (
          <img
            src={`${import.meta.env.BASE_URL}${overlayMode === "ultragb" ? "gb_overlay.png" : "overlay.png"}`}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
            data-testid="overlay-frame"
            data-overlay-mode={overlayMode}
          />
        )}
      </div>

      {selected && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: imageRect.left * displayScale,
            top: imageRect.top * displayScale,
            width: imageRect.dw * displayScale,
            height: imageRect.dh * displayScale,
          }}
        >
          <div className="absolute inset-0 outline-dashed outline-1 outline-primary/70" />
          {HANDLE_IDS.map((id) => {
            const info = HANDLES[id];
            return (
              <div
                key={id}
                role="slider"
                aria-label={`Resize ${id}`}
                data-testid={`handle-${id}`}
                onPointerDown={startResize(id)}
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
                onPointerCancel={onResizePointerUp}
                className="absolute pointer-events-auto bg-primary border border-background shadow-md"
                style={{
                  left: `${info.hx * 100}%`,
                  top: `${info.hy * 100}%`,
                  width: 12,
                  height: 12,
                  marginLeft: -6,
                  marginTop: -6,
                  borderRadius: 3,
                  cursor: info.cursor,
                  touchAction: "none",
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
