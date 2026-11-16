// Ultrahand animated wallpaper (.uaw) encoder.
//
// A TypeScript port of the overlay project's extra/make_uaw.py (same format, same
// decisions per frame), so the designer can write .uaw files in the browser. No DOM
// use: it runs in a Web Worker and under Node (see test/uaw-test.ts).
//
// .uaw format (little-endian), version 1
//   header, 32 bytes:
//     char[4] "UAW1"; u16 width (448); u16 height (720); u16 fpsNum; u16 fpsDen;
//     u32 frameCount; u32 maxRecordBytes; u32 firstFrameOffset (32); u8 reserved[8]
//   frame records, frameCount of them, each: u32 payloadBytes, then the payload:
//     u8 kind:
//       0 REPEAT  the picture stays as it is
//       1 KEY     every block, raster order (block = 4x4 px)
//       2 DELTA   s8 dx, s8 dy -- shift the whole current picture by (dx, dy) first
//                 (pixels shifted in from outside keep their old value);
//                 u8 changed[ceil(blocks / 8)] -- bit i (LSB first): block i follows;
//                 then one block per set bit, raster order
//       3 DELTA   as 2, but the changed blocks are given as runs (whichever is smaller):
//                 u16 runs, then runs x (u16 skip, u16 count); then the blocks
//   block, 10 bytes: u8 c0[3], u8 c1[3] (RGB888), u32 indices (2 bits per pixel, pixel 0
//     in the low bits, rows top to bottom); palette = c0, c1, (2*c0 + c1) / 3,
//     (c0 + 2*c1) / 3 (integer division, per channel). All pixels are opaque.

export const UAW_W = 448;
export const UAW_H = 720;
const W = UAW_W;
const H = UAW_H;
const BW = W / 4;
const BH = H / 4;
const NBLK = BW * BH;
const BITMAP_BYTES = (NBLK + 7) >> 3;

export type UawStats = {
  frames: number;
  key: number;
  repeat: number;
  delta: number;
  changedBlocks: number;
  /** File size so far, header included. */
  bytes: number;
  maxRecord: number;
};

/** Frame rate as the two u16 the header stores (30 -> 30/1, 29.97 -> 30000/1001). */
export function fpsToFraction(fps: number): [number, number] {
  if (!(fps > 0)) return [30, 1];
  const r = Math.round(fps);
  if (Math.abs(fps - r) < 0.005 && r <= 65535) return [Math.max(1, r), 1];
  const ntsc = Math.round((fps * 1001) / 1000);
  if (Math.abs(fps - (ntsc * 1000) / 1001) < 0.005 && ntsc * 1000 <= 65535) {
    return [ntsc * 1000, 1001];
  }
  let num = Math.round(fps * 1000);
  let den = 1000;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(num, den);
  num /= g;
  den /= g;
  while (num > 65535) {
    num = Math.round(num / 2);
    den = Math.max(1, Math.round(den / 2));
  }
  return [Math.max(1, num), den];
}

export function uawHeader(fpsNum: number, fpsDen: number, frames: number, maxRecord: number): Uint8Array {
  const out = new Uint8Array(32);
  const v = new DataView(out.buffer);
  out.set([0x55, 0x41, 0x57, 0x31], 0); // "UAW1"
  v.setUint16(4, W, true);
  v.setUint16(6, H, true);
  v.setUint16(8, fpsNum, true);
  v.setUint16(10, fpsDen, true);
  v.setUint32(12, frames, true);
  v.setUint32(16, maxRecord, true);
  v.setUint32(20, 32, true);
  return out;
}

// Round half to even, like numpy's rint.
function rint(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - Math.trunc(x)) === 0.5 && (r & 1) !== 0 ? r - 1 : r;
}

function clamp255(x: number): number {
  return x < 0 ? 0 : x > 255 ? 255 : x;
}

/** dst = src shifted by (dx, dy); pixels shifted in from outside keep src's value. */
function shiftInto(dst: Uint8Array, src: Uint8Array, dx: number, dy: number) {
  dst.set(src);
  const sx0 = Math.max(0, -dx);
  const sx1 = W - Math.max(0, dx);
  const sy0 = Math.max(0, -dy);
  const sy1 = H - Math.max(0, dy);
  const n = (sx1 - sx0) * 3;
  for (let y = sy0; y < sy1; y++) {
    const s = (y * W + sx0) * 3;
    dst.set(src.subarray(s, s + n), ((y + dy) * W + sx0 + dx) * 3);
  }
}

/** Per block: the largest per-channel |a - b| of its 16 pixels. */
function blockMaxDiff(a: Uint8Array, b: Uint8Array, out: Uint8Array) {
  for (let by = 0; by < BH; by++) {
    for (let bx = 0; bx < BW; bx++) {
      let m = 0;
      for (let r = 0; r < 4; r++) {
        let p = ((by * 4 + r) * W + bx * 4) * 3;
        for (let k = 0; k < 12; k++, p++) {
          const d = a[p]! - b[p]!;
          const ad = d < 0 ? -d : d;
          if (ad > m) m = ad;
        }
      }
      out[by * BW + bx] = m;
    }
  }
}

export class UawEncoder {
  /** Max per-channel error a block may keep before it is re-sent (lower = better, larger). */
  readonly quality: number;
  readonly stats: UawStats = { frames: 0, key: 0, repeat: 0, delta: 0, changedBlocks: 0, bytes: 32, maxRecord: 0 };

  private prev: Uint8Array | null = null; // previous source frame
  private shown = new Uint8Array(W * H * 3); // what the decoder shows
  private sent = new Uint8Array(W * H * 3); // the source as of each block's last send
  private scratchA = new Uint8Array(W * H * 3);
  private scratchB = new Uint8Array(W * H * 3);
  private gPrev = new Uint16Array(W * H);
  private gCur = new Uint16Array(W * H);
  private last: [number, number] = [0, 0];
  private eSrc = new Uint8Array(NBLK);
  private eBase = new Uint8Array(NBLK);
  private eSent = new Uint8Array(NBLK);
  private bad = new Uint8Array(NBLK);
  private blk = new Uint8Array(10);
  private dec = new Uint8Array(48);

  constructor(quality = 10) {
    this.quality = Math.max(1, Math.min(64, Math.round(quality)));
  }

  /** The decoded picture after the last frame (RGB24), e.g. for a preview. */
  get decoded(): Uint8Array {
    return this.shown;
  }

  /**
   * Encodes one 448x720 RGB24 frame and returns its record (u32 length + payload).
   * The frame buffer is not kept.
   */
  addFrame(cur: Uint8Array): Uint8Array {
    if (cur.length !== W * H * 3) throw new Error(`frame must be ${W * H * 3} bytes of RGB24`);
    const st = this.stats;
    let payload: Uint8Array;

    const g1 = this.gCur;
    for (let i = 0, p = 0; i < W * H; i++, p += 3) g1[i] = cur[p]! + cur[p + 1]! + cur[p + 2]!;

    if (!this.prev) {
      // KEY: every block
      payload = new Uint8Array(1 + NBLK * 10);
      payload[0] = 1;
      for (let b = 0; b < NBLK; b++) {
        this.encodeBlock(cur, b);
        payload.set(this.blk, 1 + b * 10);
        this.writeBlock(this.shown, b);
      }
      this.sent.set(cur);
      this.prev = new Uint8Array(W * H * 3);
      st.key++;
    } else {
      const [dx, dy] = this.bestShift(this.gPrev, g1);
      const moved = dx !== 0 || dy !== 0;
      if (moved) this.last = [dx, dy];

      // which blocks' source content changed (after the shift)
      let srcPrev = this.prev;
      if (moved) {
        shiftInto(this.scratchA, this.prev, dx, dy);
        srcPrev = this.scratchA;
      }
      blockMaxDiff(cur, srcPrev, this.eSrc);
      const srcThr = Math.max(3, this.quality >> 1);

      let base = this.shown;
      if (moved) {
        shiftInto(this.scratchB, this.shown, dx, dy);
        base = this.scratchB;
        shiftInto(this.scratchA, this.sent, dx, dy);
        const t = this.sent;
        this.sent = this.scratchA;
        this.scratchA = t;
      }
      blockMaxDiff(cur, base, this.eBase);
      blockMaxDiff(cur, this.sent, this.eSent);

      const bad = this.bad;
      const q = this.quality;
      const blocks: number[] = [];
      let nBad = 0;
      for (let by = 0; by < BH; by++) {
        // pixels shifted in from outside are stale: always re-send them
        const staleRow = moved && ((dy > 0 && by * 4 < dy) || (dy < 0 && by * 4 + 3 >= H + dy));
        for (let bx = 0; bx < BW; bx++) {
          const b = by * BW + bx;
          const stale = staleRow || (moved && ((dx > 0 && bx * 4 < dx) || (dx < 0 && bx * 4 + 3 >= W + dx)));
          // tolerance follows brightness: the same error is far more visible on a dark block
          let sum = 0;
          for (let r = 0; r < 4; r++) {
            const g = (by * 4 + r) * W + bx * 4;
            sum += g1[g]! + g1[g + 1]! + g1[g + 2]! + g1[g + 3]!;
          }
          const lum = sum / 48;
          const tol = Math.min(q, Math.max(2, (q * (lum + 32)) / 160));
          const eBase = this.eBase[b]!;
          // a block is a candidate once its source has drifted from what it was when it was
          // last sent (slow fades add up), not only on a big frame-to-frame jump
          const drift = this.eSent[b]! > Math.max(3, 0.5 * tol);
          let send = false;
          if (stale || (eBase > tol && (drift || this.eSrc[b]! > srcThr))) {
            this.encodeBlock(cur, b);
            // re-send only blocks that a new block actually improves
            let eNew = 0;
            const dec = this.dec;
            for (let r = 0, k = 0; r < 4; r++) {
              let p = ((by * 4 + r) * W + bx * 4) * 3;
              for (let c = 0; c < 12; c++, p++, k++) {
                const d = cur[p]! - dec[k]!;
                const ad = d < 0 ? -d : d;
                if (ad > eNew) eNew = ad;
              }
            }
            send = stale || eBase > eNew + Math.max(1, 0.4 * tol);
          }
          if (send) {
            bad[b] = 1;
            nBad++;
            for (let k = 0; k < 10; k++) blocks.push(this.blk[k]!);
            this.writeBlock(base, b);
            for (let r = 0; r < 4; r++) {
              const p = ((by * 4 + r) * W + bx * 4) * 3;
              this.sent.set(cur.subarray(p, p + 12), p);
            }
          } else {
            bad[b] = 0;
          }
        }
      }

      if (nBad === 0 && !moved) {
        payload = new Uint8Array([0]); // REPEAT
        st.repeat++;
      } else {
        if (moved) {
          const t = this.shown;
          this.shown = this.scratchB;
          this.scratchB = t;
        }
        // changed blocks as runs or as a bitmap, whichever is smaller
        const runs: number[] = [];
        let pos = 0;
        let i = 0;
        while (i < NBLK) {
          if (!bad[i]) {
            i++;
            continue;
          }
          let j = i;
          while (j < NBLK && bad[j]) j++;
          runs.push(i - pos, j - i);
          pos = j;
          i = j;
        }
        const runBytes = 2 + runs.length * 2;
        const useRuns = runBytes < BITMAP_BYTES;
        const listBytes = useRuns ? runBytes : BITMAP_BYTES;
        payload = new Uint8Array(3 + listBytes + blocks.length);
        const v = new DataView(payload.buffer);
        payload[0] = useRuns ? 3 : 2;
        v.setInt8(1, dx);
        v.setInt8(2, dy);
        if (useRuns) {
          v.setUint16(3, runs.length / 2, true);
          for (let k = 0; k < runs.length; k++) v.setUint16(5 + k * 2, runs[k]!, true);
        } else {
          for (let b = 0; b < NBLK; b++) if (bad[b]) payload[3 + (b >> 3)]! |= 1 << (b & 7);
        }
        payload.set(blocks, 3 + listBytes);
        st.delta++;
        st.changedBlocks += nBad;
      }
    }

    this.prev.set(cur);
    const t = this.gPrev;
    this.gPrev = this.gCur;
    this.gCur = t;

    const rec = new Uint8Array(4 + payload.length);
    new DataView(rec.buffer).setUint32(0, payload.length, true);
    rec.set(payload, 4);
    st.frames++;
    st.bytes += rec.length;
    if (payload.length > st.maxRecord) st.maxRecord = payload.length;
    return rec;
  }

  /** The 32-byte file header for everything added so far. */
  header(fpsNum: number, fpsDen: number): Uint8Array {
    return uawHeader(fpsNum, fpsDen, this.stats.frames, this.stats.maxRecord);
  }

  // Encodes block b of img into this.blk (10 bytes) and this.dec (its 16 decoded pixels).
  private encodeBlock(img: Uint8Array, b: number) {
    const bx = b % BW;
    const by = (b - bx) / BW;
    const px = encPx;
    let mr = 0, mg = 0, mb = 0;
    for (let r = 0, k = 0; r < 4; r++) {
      let p = ((by * 4 + r) * W + bx * 4) * 3;
      for (let c = 0; c < 4; c++, p += 3, k += 3) {
        const R = img[p]!, G = img[p + 1]!, B = img[p + 2]!;
        px[k] = R; px[k + 1] = G; px[k + 2] = B;
        mr += R; mg += G; mb += B;
      }
    }
    mr /= 16; mg /= 16; mb /= 16;
    // principal axis of the block's colours by power iteration (flat blocks: no axis)
    let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
    for (let k = 0; k < 48; k += 3) {
      const dr = px[k]! - mr, dg = px[k + 1]! - mg, db = px[k + 2]! - mb;
      cxx += dr * dr; cxy += dr * dg; cxz += dr * db; cyy += dg * dg; cyz += dg * db; czz += db * db;
    }
    let vx = 0.5773502691896258, vy = vx, vz = vx;
    for (let it = 0; it < 8; it++) {
      const nx = cxx * vx + cxy * vy + cxz * vz;
      const ny = cxy * vx + cyy * vy + cyz * vz;
      const nz = cxz * vx + cyz * vy + czz * vz;
      const n = Math.max(Math.sqrt(nx * nx + ny * ny + nz * nz), 1e-6);
      vx = nx / n; vy = ny / n; vz = nz / n;
    }
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 48; k += 3) {
      const t = (px[k]! - mr) * vx + (px[k + 1]! - mg) * vy + (px[k + 2]! - mb) * vz;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    // try the full range and a slightly inset range; keep the lower-error fit
    let bestErr = Infinity;
    const pal = encPal;
    const idx = encIdx;
    for (let pass = 0; pass < 2; pass++) {
      const f = pass === 0 ? 0 : 0.08;
      const a = lo + (hi - lo) * f;
      const e = hi - (hi - lo) * f;
      for (let c = 0; c < 3; c++) {
        const m = c === 0 ? mr : c === 1 ? mg : mb;
        const v = c === 0 ? vx : c === 1 ? vy : vz;
        const c0 = clamp255(rint(m + v * a));
        const c1 = clamp255(rint(m + v * e));
        pal[c] = c0;
        pal[3 + c] = c1;
        pal[6 + c] = Math.floor((2 * c0 + c1) / 3);
        pal[9 + c] = Math.floor((c0 + 2 * c1) / 3);
      }
      let err = 0;
      for (let k = 0, i = 0; k < 48; k += 3, i++) {
        const R = px[k]!, G = px[k + 1]!, B = px[k + 2]!;
        let best = 0, bd = Infinity;
        for (let j = 0; j < 4; j++) {
          const dr = R - pal[j * 3]!, dg = G - pal[j * 3 + 1]!, db = B - pal[j * 3 + 2]!;
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; best = j; }
        }
        idx[i] = best;
        err += bd;
      }
      if (err < bestErr) {
        bestErr = err;
        const blk = this.blk;
        for (let c = 0; c < 6; c++) blk[c] = pal[c]!;
        let bits = 0;
        for (let i = 0; i < 16; i++) bits |= idx[i]! << (2 * i);
        bits >>>= 0;
        blk[6] = bits & 255; blk[7] = (bits >>> 8) & 255; blk[8] = (bits >>> 16) & 255; blk[9] = bits >>> 24;
        const dec = this.dec;
        for (let i = 0; i < 16; i++) {
          const j = idx[i]! * 3;
          dec[i * 3] = pal[j]!; dec[i * 3 + 1] = pal[j + 1]!; dec[i * 3 + 2] = pal[j + 2]!;
        }
      }
    }
  }

  // Writes the decoded pixels of the block just encoded (this.dec) into img at block b.
  private writeBlock(img: Uint8Array, b: number) {
    const bx = b % BW;
    const by = (b - bx) / BW;
    for (let r = 0; r < 4; r++) {
      img.set(this.dec.subarray(r * 12, r * 12 + 12), ((by * 4 + r) * W + bx * 4) * 3);
    }
  }

  // Whole-picture shift (dx, dy) that best maps the previous frame onto this one, or
  // (0, 0). Candidates: an estimate from 1-D comparisons of the column and row sums and
  // the previous frame's shift (scrolling is steady), each with its 8 neighbours; only
  // those and "no shift" are compared on the picture itself (every 4th row).
  private bestShift(g0: Uint16Array, g1: Uint16Array): [number, number] {
    const RNG = 16;
    const c0 = shiftCols0, c1 = shiftCols1, r0 = shiftRows0, r1 = shiftRows1;
    c0.fill(0); c1.fill(0);
    for (let y = 0; y < H; y++) {
      let s0 = 0, s1 = 0;
      const o = y * W;
      for (let x = 0; x < W; x++) {
        const a = g0[o + x]!, b = g1[o + x]!;
        s0 += a; s1 += b;
        c0[x]! += a; c1[x]! += b;
      }
      r0[y] = s0; r1[y] = s1;
    }
    const best1d = (a: Float64Array, b: Float64Array, n: number, r: number) => {
      let be = 0;
      for (let i = 0; i < n; i++) be += Math.abs(a[i]! - b[i]!);
      be /= n;
      let bd = 0;
      for (let d = -r; d <= r; d++) {
        if (d === 0) continue;
        const a0 = Math.max(0, -d), b0 = Math.max(0, d), len = n - Math.abs(d);
        let e = 0;
        for (let i = 0; i < len; i++) e += Math.abs(a[a0 + i]! - b[b0 + i]!);
        e /= len;
        if (e < be) { be = e; bd = d; }
      }
      return bd;
    };
    const dx0 = best1d(c0, c1, W, RNG);
    const dy0 = best1d(r0, r1, H, RNG >> 1);
    const err = (dx: number, dy: number) => {
      const ya = Math.max(0, -dy), yb = Math.max(0, dy), rows = H - Math.abs(dy);
      const xa = Math.max(0, -dx), xb = Math.max(0, dx), cols = W - Math.abs(dx);
      let e = 0, n = 0;
      for (let k = 0; k < rows; k += 4) {
        const oa = (ya + k) * W + xa, ob = (yb + k) * W + xb;
        for (let j = 0; j < cols; j++) {
          const d = g0[oa + j]! - g1[ob + j]!;
          e += d < 0 ? -d : d;
        }
        n += cols;
      }
      return e / n;
    };
    let be = err(0, 0), bx = 0, by = 0;
    if (be === 0) return [0, 0]; // identical frames
    const tried = new Set<number>([0]);
    for (const [cx, cy] of [[dx0, dy0], this.last] as [number, number][]) {
      for (let dy = cy - 1; dy <= cy + 1; dy++) {
        for (let dx = cx - 1; dx <= cx + 1; dx++) {
          const key = dx * 1000 + dy;
          if (tried.has(key) || Math.abs(dx) > RNG || Math.abs(dy) > RNG >> 1) continue;
          tried.add(key);
          const e = err(dx, dy);
          if (e < be) { be = e; bx = dx; by = dy; }
        }
      }
    }
    return [bx, by];
  }
}

const encPx = new Float64Array(48);
const encPal = new Int32Array(12);
const encIdx = new Uint8Array(16);
const shiftCols0 = new Float64Array(W);
const shiftCols1 = new Float64Array(W);
const shiftRows0 = new Float64Array(H);
const shiftRows1 = new Float64Array(H);
