// Node check of the .uaw decoder: frames out as raw RGB24 (compare with uaw_decode.py).
//   node test/uaw-decode-test.ts in.uaw out.rgb24 [--seeks]
import { readFileSync, writeFileSync } from "node:fs";
import { UawDecoder } from "../src/lib/uawDecode.ts";

const [inPath, outPath, flag] = process.argv.slice(2);
if (!inPath || !outPath) throw new Error("usage: uaw-decode-test.ts in.uaw out.rgb24 [--seeks]");
const dec = new UawDecoder(readFileSync(inPath));
const rgb = (a: Uint8ClampedArray) => {
  const o = Buffer.alloc((a.length / 4) * 3);
  for (let i = 0, j = 0; i < a.length; i += 4, j += 3) { o[j] = a[i]!; o[j + 1] = a[i + 1]!; o[j + 2] = a[i + 2]!; }
  return o;
};
const frames: Buffer[] = [];
for (let i = 0; i < dec.frames; i++) { dec.seek(i); frames.push(rgb(dec.rgba)); }
writeFileSync(outPath, Buffer.concat(frames));
console.log(`${inPath}: ${dec.frames} frames at ${dec.fpsNum}/${dec.fpsDen} fps`);
if (flag === "--seeks") {
  // random access must give exactly what playing straight through gave
  let bad = 0, state = 12345;
  const rnd = () => (state = (state * 1103515245 + 12345) >>> 0) / 4294967296;
  const fresh = new UawDecoder(readFileSync(inPath));
  for (let k = 0; k < 300; k++) {
    const i = Math.floor(rnd() * dec.frames);
    (k % 2 ? dec : fresh).seek(i);
    if (!rgb((k % 2 ? dec : fresh).rgba).equals(frames[i]!)) bad++;
  }
  console.log(`  300 random seeks: ${bad} mismatches`);
}
