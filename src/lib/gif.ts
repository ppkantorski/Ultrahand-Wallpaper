// GIF decoder: parses a GIF87a / GIF89a file and composes its frames (disposal modes,
// transparency, interlacing). No DOM use, so it also runs under Node (test/gif-test.ts).
// Written here rather than using the browser's ImageDecoder so animated GIFs work the
// same in every browser.

export type GifFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Palette indices, w * h, row order (already de-interlaced). */
  pixels: Uint8Array;
  /** RGB triples. */
  palette: Uint8Array;
  /** Palette index that is see-through, or -1. */
  transparent: number;
  /** 0 / 1 keep, 2 clear the frame's area, 3 restore what was there before. */
  disposal: number;
  /** Seconds this frame stays up. */
  delay: number;
};

export type Gif = { width: number; height: number; frames: GifFrame[]; duration: number };

function lzw(minCode: number, data: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const MAX = 4096;
  const prefix = new Int16Array(MAX);
  const suffix = new Uint8Array(MAX);
  const stack = new Uint8Array(MAX + 1);
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let mask = (1 << size) - 1;
  let avail = clear + 2;
  let old = -1;
  let first = 0;
  let bits = 0;
  let cur = 0;
  let o = 0;
  let sp = 0;
  for (let c = 0; c < clear; c++) suffix[c] = c;
  for (let i = 0; i < data.length && o < count; ) {
    cur |= data[i++]! << bits;
    bits += 8;
    while (bits >= size && o < count) {
      let code = cur & mask;
      cur >>= size;
      bits -= size;
      if (code === clear) {
        size = minCode + 1;
        mask = (1 << size) - 1;
        avail = clear + 2;
        old = -1;
        continue;
      }
      if (code === eoi) return out;
      if (old === -1) {
        if (code >= clear) return out; // corrupt: stop with what we have
        out[o++] = code;
        old = code;
        first = code;
        continue;
      }
      const inCode = code;
      if (code >= avail) {
        // the code being defined right now: previous string + its own first pixel
        if (code > avail) return out;
        stack[sp++] = first;
        code = old;
      }
      while (code >= clear) {
        stack[sp++] = suffix[code]!;
        code = prefix[code]!;
      }
      first = suffix[code]!;
      stack[sp++] = first;
      if (avail < MAX) {
        prefix[avail] = old;
        suffix[avail] = first;
        avail++;
        if ((avail & mask) === 0 && avail < MAX) {
          size++;
          mask = (1 << size) - 1;
        }
      }
      old = inCode;
      while (sp > 0 && o < count) out[o++] = stack[--sp]!;
      sp = 0;
    }
  }
  return out;
}

/** Parses a GIF. Throws if the data is not one. */
export function parseGif(bytes: Uint8Array): Gif {
  if (bytes.length < 13 || String.fromCharCode(...bytes.subarray(0, 3)) !== "GIF") {
    throw new Error("Not a GIF file.");
  }
  const u16 = (p: number) => bytes[p]! | (bytes[p + 1]! << 8);
  const width = u16(6);
  const height = u16(8);
  const flags = bytes[10]!;
  let p = 13;
  let globalPalette: Uint8Array | null = null;
  if (flags & 0x80) {
    const n = 3 * (2 << (flags & 7));
    globalPalette = bytes.subarray(p, p + n);
    p += n;
  }
  const frames: GifFrame[] = [];
  let transparent = -1;
  let disposal = 0;
  let delay = 0.1;
  const skipBlocks = () => {
    while (p < bytes.length) {
      const n = bytes[p++]!;
      if (n === 0) break;
      p += n;
    }
  };
  while (p < bytes.length) {
    const tag = bytes[p++]!;
    if (tag === 0x3b) break; // trailer
    if (tag === 0x21) {
      const label = bytes[p++]!;
      if (label === 0xf9 && bytes[p] === 4) {
        // graphic control: applies to the next image
        const f = bytes[p + 1]!;
        disposal = (f >> 2) & 7;
        const cs = u16(p + 2);
        // browsers treat 0 / 1 hundredths as 10 (a "0 delay" GIF would spin the CPU)
        delay = (cs <= 1 ? 10 : cs) / 100;
        transparent = f & 1 ? bytes[p + 4]! : -1;
      }
      skipBlocks();
    } else if (tag === 0x2c) {
      const x = u16(p);
      const y = u16(p + 2);
      const w = u16(p + 4);
      const h = u16(p + 6);
      const f = bytes[p + 8]!;
      p += 9;
      let palette = globalPalette;
      if (f & 0x80) {
        const n = 3 * (2 << (f & 7));
        palette = bytes.subarray(p, p + n);
        p += n;
      }
      const minCode = bytes[p++]!;
      // gather the data sub-blocks
      let total = 0;
      for (let q = p; q < bytes.length; ) {
        const n = bytes[q]!;
        if (n === 0) break;
        total += n;
        q += n + 1;
      }
      const data = new Uint8Array(total);
      for (let o = 0; p < bytes.length; ) {
        const n = bytes[p++]!;
        if (n === 0) break;
        data.set(bytes.subarray(p, p + n), o);
        o += n;
        p += n;
      }
      if (w > 0 && h > 0 && palette && minCode >= 1 && minCode <= 8) {
        let pixels = lzw(minCode, data, w * h);
        if (f & 0x40) {
          // interlaced: rows arrive as every 8th, then 8th from 4, 4th from 2, odd rows
          const de = new Uint8Array(w * h);
          let src = 0;
          for (const [from, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) {
            for (let row = from; row < h; row += step, src += w) {
              de.set(pixels.subarray(src, src + w), row * w);
            }
          }
          pixels = de;
        }
        frames.push({ x, y, w, h, pixels, palette, transparent, disposal, delay });
      }
      transparent = -1;
      disposal = 0;
      delay = 0.1;
    } else {
      break; // unknown block: stop with the frames read so far
    }
  }
  if (!width || !height || frames.length === 0) throw new Error("The GIF has no picture.");
  return { width, height, frames, duration: frames.reduce((t, f) => t + f.delay, 0) };
}

/**
 * Composes a GIF's frames in order into one RGBA picture. Going forward is cheap (one
 * frame at a time); going back replays from the first frame.
 */
export class GifCompositor {
  readonly gif: Gif;
  /** The composed picture, width * height * 4 (alpha 0 where nothing was drawn). */
  readonly rgba: Uint8ClampedArray;
  /** Frame currently in `rgba`, or -1 before the first seek. */
  index = -1;
  private saved: Uint8ClampedArray | null = null;

  constructor(gif: Gif) {
    this.gif = gif;
    this.rgba = new Uint8ClampedArray(gif.width * gif.height * 4);
  }

  /** Makes `rgba` show frame `i`. Returns false if it already did. */
  seek(i: number): boolean {
    const n = this.gif.frames.length;
    i = Math.max(0, Math.min(n - 1, i));
    if (i === this.index) return false;
    if (i < this.index) {
      this.rgba.fill(0);
      this.index = -1;
      this.saved = null;
    }
    while (this.index < i) this.step();
    return true;
  }

  private step() {
    const { width: W, height: H, frames } = this.gif;
    const out = this.rgba;
    const prev = this.index >= 0 ? frames[this.index]! : null;
    if (prev) {
      if (prev.disposal === 2) {
        const x0 = Math.max(0, prev.x), x1 = Math.min(W, prev.x + prev.w);
        for (let y = Math.max(0, prev.y); y < Math.min(H, prev.y + prev.h); y++) {
          out.fill(0, (y * W + x0) * 4, (y * W + x1) * 4);
        }
      } else if (prev.disposal === 3 && this.saved) {
        out.set(this.saved);
      }
    }
    const f = frames[++this.index]!;
    if (f.disposal === 3) {
      if (!this.saved) this.saved = new Uint8ClampedArray(out.length);
      this.saved.set(out);
    }
    const pal = f.palette;
    const colours = pal.length / 3;
    for (let row = 0; row < f.h; row++) {
      const y = f.y + row;
      if (y < 0 || y >= H) continue;
      for (let col = 0; col < f.w; col++) {
        const x = f.x + col;
        if (x < 0 || x >= W) continue;
        const c = f.pixels[row * f.w + col]!;
        if (c === f.transparent || c >= colours) continue;
        const o = (y * W + x) * 4;
        out[o] = pal[c * 3]!;
        out[o + 1] = pal[c * 3 + 1]!;
        out[o + 2] = pal[c * 3 + 2]!;
        out[o + 3] = 255;
      }
    }
  }
}
