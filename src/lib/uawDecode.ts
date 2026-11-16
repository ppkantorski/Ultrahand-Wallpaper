// Ultrahand animated wallpaper (.uaw) decoder: the reverse of uaw.ts, mirroring the
// overlay's player and extra/uaw_decode.py. No DOM use (also runs under Node, see
// test/uaw-decode-test.ts). The format is described at the top of uaw.ts.

const W = 448;
const H = 720;
const BW = W / 4;
const NBLK = BW * (H / 4);
const BITMAP_BYTES = (NBLK + 7) >> 3;

export class UawDecoder {
  readonly frames: number;
  readonly fpsNum: number;
  readonly fpsDen: number;
  /** The decoded picture, 448 * 720 * 4 (alpha always 255). */
  readonly rgba = new Uint8ClampedArray(W * H * 4);
  /** Frame currently in `rgba`, or -1 before the first seek. */
  index = -1;

  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly offsets: number[] = []; // payload start of each record
  private readonly lengths: number[] = [];
  // Pictures kept every `every` frames so that going back doesn't replay from frame 0
  // (only the first record is a KEY frame). At most ~32 of them (~40 MB for long clips).
  private readonly every: number;
  private readonly snapshots = new Map<number, Uint8ClampedArray>();
  private scratch: Uint8ClampedArray | null = null;

  /** Throws if the data is not a playable .uaw. */
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const v = this.view;
    if (bytes.length < 32 || String.fromCharCode(...bytes.subarray(0, 4)) !== "UAW1") {
      throw new Error("Not a .uaw file.");
    }
    if (v.getUint16(4, true) !== W || v.getUint16(6, true) !== H) {
      throw new Error("Unexpected .uaw picture size.");
    }
    this.fpsNum = v.getUint16(8, true);
    this.fpsDen = v.getUint16(10, true);
    const count = v.getUint32(12, true);
    let p = v.getUint32(20, true);
    if (!this.fpsNum || !this.fpsDen || p < 32) throw new Error("Damaged .uaw header.");
    // index the records; a cut-off file plays up to its last whole record
    for (let i = 0; i < count && p + 4 <= bytes.length; i++) {
      const len = v.getUint32(p, true);
      if (len < 1 || p + 4 + len > bytes.length) break;
      this.offsets.push(p + 4);
      this.lengths.push(len);
      p += 4 + len;
    }
    this.frames = this.offsets.length;
    if (!this.frames || bytes[this.offsets[0]!] !== 1) throw new Error("The .uaw has no key frame.");
    this.every = Math.max(30, Math.ceil(this.frames / 32));
    for (let i = 3; i < this.rgba.length; i += 4) this.rgba[i] = 255;
  }

  get fps() {
    return this.fpsNum / this.fpsDen;
  }

  /** Makes `rgba` show frame `i`. Returns false if it already did. */
  seek(i: number): boolean {
    i = Math.max(0, Math.min(this.frames - 1, i));
    if (i === this.index) return false;
    if (i < this.index || i - this.index > this.every) {
      // jump: restart from the nearest kept picture at or before i, if that is closer
      let s = Math.floor(i / this.every) * this.every;
      while (s > 0 && !this.snapshots.has(s)) s -= this.every;
      if (i < this.index || s > this.index) {
        const snap = s > 0 ? this.snapshots.get(s) : undefined;
        if (snap) {
          this.rgba.set(snap);
          this.index = s;
        } else {
          this.index = -1; // frame 0 is a KEY: it repaints everything
        }
      }
    }
    while (this.index < i) {
      this.step();
      if (this.index > 0 && this.index % this.every === 0 && !this.snapshots.has(this.index)) {
        this.snapshots.set(this.index, this.rgba.slice());
      }
    }
    return true;
  }

  private step() {
    const n = ++this.index;
    const b = this.bytes;
    let q = this.offsets[n]!;
    const end = q + this.lengths[n]!;
    const kind = b[q++]!;
    if (kind === 0) return; // REPEAT
    if (kind === 1) {
      for (let blk = 0; blk < NBLK && q + 10 <= end; blk++, q += 10) this.block(blk, q);
      return;
    }
    if (kind !== 2 && kind !== 3) return; // unknown record: keep the picture
    const dx = this.view.getInt8(q);
    const dy = this.view.getInt8(q + 1);
    q += 2;
    if (dx || dy) this.shift(dx, dy);
    if (kind === 2) {
      const bm = q;
      q += BITMAP_BYTES;
      for (let blk = 0; blk < NBLK && q + 10 <= end; blk++) {
        if (b[bm + (blk >> 3)]! & (1 << (blk & 7))) {
          this.block(blk, q);
          q += 10;
        }
      }
    } else {
      const runs = this.view.getUint16(q, true);
      let r = q + 2;
      q = r + runs * 4;
      let pos = 0;
      for (let k = 0; k < runs; k++, r += 4) {
        pos += this.view.getUint16(r, true);
        const cnt = this.view.getUint16(r + 2, true);
        for (let c = 0; c < cnt && pos < NBLK && q + 10 <= end; c++, pos++, q += 10) this.block(pos, q);
      }
    }
  }

  // Shift the whole picture; pixels shifted in from outside keep their old value.
  private shift(dx: number, dy: number) {
    const src = (this.scratch ??= new Uint8ClampedArray(this.rgba.length));
    src.set(this.rgba);
    const sx0 = Math.max(0, -dx), sx1 = W - Math.max(0, dx);
    const sy0 = Math.max(0, -dy), sy1 = H - Math.max(0, dy);
    const n = (sx1 - sx0) * 4;
    if (n <= 0) return;
    for (let y = sy0; y < sy1; y++) {
      const s = (y * W + sx0) * 4;
      this.rgba.set(src.subarray(s, s + n), ((y + dy) * W + sx0 + dx) * 4);
    }
  }

  // Paints block `blk` from the 10 bytes at q.
  private block(blk: number, q: number) {
    const b = this.bytes;
    const pal = blockPal;
    for (let c = 0; c < 3; c++) {
      const c0 = b[q + c]!, c1 = b[q + 3 + c]!;
      pal[c] = c0;
      pal[3 + c] = c1;
      pal[6 + c] = ((2 * c0 + c1) / 3) | 0;
      pal[9 + c] = ((c0 + 2 * c1) / 3) | 0;
    }
    let bits = (b[q + 6]! | (b[q + 7]! << 8) | (b[q + 8]! << 16) | (b[q + 9]! << 24)) >>> 0;
    const bx = blk % BW;
    const by = (blk - bx) / BW;
    const out = this.rgba;
    for (let r = 0; r < 4; r++) {
      let o = ((by * 4 + r) * W + bx * 4) * 4;
      for (let c = 0; c < 4; c++, o += 4, bits >>>= 2) {
        const j = (bits & 3) * 3;
        out[o] = pal[j]!;
        out[o + 1] = pal[j + 1]!;
        out[o + 2] = pal[j + 2]!;
      }
    }
  }
}

const blockPal = new Uint8Array(12);
