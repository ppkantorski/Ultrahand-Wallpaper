export type Adjustments = {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  blackPoint: number;
  saturation: number;
  vibrance: number;
  warmth: number;
  tint: number;
  sharpness: number;
  definition: number;
  vignette: number;
};

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  blackPoint: 0,
  saturation: 0,
  vibrance: 0,
  warmth: 0,
  tint: 0,
  sharpness: 0,
  definition: 0,
  vignette: 0,
};

export type Transform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export const FRAME_W = 448;
export const FRAME_H = 720;

function clamp(v: number, lo = 0, hi = 255) {
  return v < lo ? lo : v > hi ? hi : v;
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number) {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}

export function applyPixelAdjustments(imageData: ImageData, adj: Adjustments) {
  const d = imageData.data;
  const len = d.length;

  const exposure = Math.pow(2, adj.exposure * 1.5); // -1..1 -> ~0.35..2.83
  const brightness = adj.brightness * 60; // additive
  const contrast = 1 + adj.contrast; // 0..2
  const blackPoint = adj.blackPoint * 40;
  const warmth = adj.warmth * 40;
  const tint = adj.tint * 40;
  const satMul = 1 + adj.saturation;
  const vib = adj.vibrance;
  const hi = adj.highlights;
  const sh = adj.shadows;

  for (let i = 0; i < len; i += 4) {
    let r = d[i]!;
    let g = d[i + 1]!;
    let b = d[i + 2]!;

    // Exposure (multiplicative)
    r *= exposure;
    g *= exposure;
    b *= exposure;

    // Brightness (additive)
    r += brightness;
    g += brightness;
    b += brightness;

    // Black point: lift/lower the floor
    r = r - blackPoint;
    g = g - blackPoint;
    b = b - blackPoint;

    // Contrast around 128
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;

    // Highlights/Shadows tone curve (luma-based)
    if (hi !== 0 || sh !== 0) {
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      // Highlights: weight = lum^2 (only bright pixels)
      const hiW = lum * lum;
      // Shadows: weight = (1-lum)^2
      const shW = (1 - lum) * (1 - lum);
      const hiAdj = hi * 80 * hiW;
      const shAdj = sh * 80 * shW;
      r += hiAdj + shAdj;
      g += hiAdj + shAdj;
      b += hiAdj + shAdj;
    }

    // Warmth/Tint
    if (warmth !== 0) {
      r += warmth;
      b -= warmth;
    }
    if (tint !== 0) {
      g += tint;
    }

    // Saturation (HSL)
    if (satMul !== 1 || vib !== 0) {
      const [h, s, l] = rgbToHsl(clamp(r), clamp(g), clamp(b));
      let newS = s * satMul;
      if (vib !== 0) {
        // Vibrance: boost less-saturated colors more
        newS = newS + vib * (1 - newS);
      }
      newS = Math.max(0, Math.min(1, newS));
      const [nr, ng, nb] = hslToRgb(h!, newS, l!);
      r = nr!;
      g = ng!;
      b = nb!;
    }

    d[i] = clamp(r);
    d[i + 1] = clamp(g);
    d[i + 2] = clamp(b);
    // alpha left as is
  }
}

export function applyVignette(imageData: ImageData, amount: number) {
  if (amount === 0) return;
  const w = imageData.width;
  const h = imageData.height;
  const d = imageData.data;
  const cx = w / 2;
  const cy = h / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  const strength = Math.abs(amount);
  const sign = amount > 0 ? 1 : -1; // positive darkens, negative lightens
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
      // ease-in
      const v = Math.pow(dist, 2.2);
      const factor = 1 - sign * v * strength;
      const i = (y * w + x) * 4;
      d[i] = clamp(d[i]! * factor);
      d[i + 1] = clamp(d[i + 1]! * factor);
      d[i + 2] = clamp(d[i + 2]! * factor);
    }
  }
}

export function applyConvolution(
  imageData: ImageData,
  kernel: number[],
  divisor = 1,
) {
  const w = imageData.width;
  const h = imageData.height;
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);
  const k = kernel;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const px = Math.min(w - 1, Math.max(0, x + kx));
          const py = Math.min(h - 1, Math.max(0, y + ky));
          const idx = (py * w + px) * 4;
          const kv = k[(ky + 1) * 3 + (kx + 1)]!;
          r += src[idx]! * kv;
          g += src[idx + 1]! * kv;
          b += src[idx + 2]! * kv;
        }
      }
      const i = (y * w + x) * 4;
      out[i] = clamp(r / divisor);
      out[i + 1] = clamp(g / divisor);
      out[i + 2] = clamp(b / divisor);
      out[i + 3] = src[i + 3]!;
    }
  }
  imageData.data.set(out);
}

export function applySharpness(imageData: ImageData, amount: number) {
  if (amount <= 0) return;
  const a = amount;
  const k = [
    0, -a, 0,
    -a, 1 + 4 * a, -a,
    0, -a, 0,
  ];
  applyConvolution(imageData, k, 1);
}

export function applyDefinition(imageData: ImageData, amount: number) {
  if (amount === 0) return;
  // Soft local-contrast: blur copy, blend difference back
  const w = imageData.width;
  const h = imageData.height;
  const src = imageData.data;
  // 3x3 box blur
  const blurred = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, c = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const px = Math.min(w - 1, Math.max(0, x + kx));
          const py = Math.min(h - 1, Math.max(0, y + ky));
          const idx = (py * w + px) * 4;
          r += src[idx]!;
          g += src[idx + 1]!;
          b += src[idx + 2]!;
          c++;
        }
      }
      const i = (y * w + x) * 4;
      blurred[i] = r / c;
      blurred[i + 1] = g / c;
      blurred[i + 2] = b / c;
      blurred[i + 3] = src[i + 3]!;
    }
  }
  const k = amount * 1.5;
  for (let i = 0; i < src.length; i += 4) {
    src[i] = clamp(src[i]! + (src[i]! - blurred[i]!) * k);
    src[i + 1] = clamp(src[i + 1]! + (src[i + 1]! - blurred[i + 1]!) * k);
    src[i + 2] = clamp(src[i + 2]! + (src[i + 2]! - blurred[i + 2]!) * k);
  }
}

export function quantizeToRGBA4444(imageData: ImageData) {
  // Simulates RGBA4444 storage: take the high 4 bits of each channel and
  // replicate them into the low 4 bits. This matches what hardware does
  // when expanding a 4-bit channel back to 8 bits, so the preview reflects
  // the exact colors the wallpaper would display in that format.
  //
  //   0x00 -> 0x00,  0x10 -> 0x11,  0x80 -> 0x88,  0xFF -> 0xFF
  //
  // Result: 16 representable values per channel (16^4 = 65,536 total RGBA
  // combinations), with visible banding in smooth gradients.
  const d = imageData.data;
  const len = d.length;
  for (let i = 0; i < len; i += 4) {
    const r = d[i]!;
    const g = d[i + 1]!;
    const b = d[i + 2]!;
    const a = d[i + 3]!;
    d[i]     = (r & 0xf0) | (r >> 4);
    d[i + 1] = (g & 0xf0) | (g >> 4);
    d[i + 2] = (b & 0xf0) | (b >> 4);
    d[i + 3] = (a & 0xf0) | (a >> 4);
  }
}

export function renderToCanvas(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  transform: Transform,
  adj: Adjustments,
  options: {
    quality?: "preview" | "export";
    background?: { kind: "transparent" } | { kind: "color"; color: string };
  } = {},
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // Clear, then optionally fill with a solid background
  ctx.clearRect(0, 0, w, h);
  const bg = options.background ?? { kind: "transparent" };
  if (bg.kind === "color") {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
  }

  // Compute drawn image rect: at scale=1, image's longest side fits the frame (cover)
  const baseScale = Math.max(w / image.width, h / image.height);
  const scale = baseScale * transform.scale;
  const dw = image.width * scale;
  const dh = image.height * scale;
  const dx = (w - dw) / 2 + transform.offsetX;
  const dy = (h - dh) / 2 + transform.offsetY;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = options.quality === "export" ? "high" : "medium";
  ctx.drawImage(image, dx, dy, dw, dh);

  // Pixel adjustments
  const imageData = ctx.getImageData(0, 0, w, h);

  applyPixelAdjustments(imageData, adj);

  if (adj.definition !== 0) {
    applyDefinition(imageData, adj.definition);
  }
  if (adj.sharpness > 0) {
    applySharpness(imageData, adj.sharpness);
  }
  if (adj.vignette !== 0) {
    applyVignette(imageData, adj.vignette);
  }

  // Preview-only: quantize to RGBA4444 so what you see matches what the
  // wallpaper will look like at that bit depth. Exports stay 8-bit.
  if (options.quality === "preview") {
    quantizeToRGBA4444(imageData);
  }

  ctx.putImageData(imageData, 0, 0);
}