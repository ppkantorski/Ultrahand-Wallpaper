// Node check of the encoder: raw RGB24 448x720 frames in, .uaw out.
//   node test/uaw-test.ts frames.rgb24 out.uaw [quality] [fps]
import { readFileSync, writeFileSync } from "node:fs";
import { UawEncoder, fpsToFraction, UAW_W, UAW_H } from "../src/lib/uaw.ts";

const [inPath, outPath, q = "10", fps = "30"] = process.argv.slice(2);
if (!inPath || !outPath) throw new Error("usage: uaw-test.ts frames.rgb24 out.uaw [quality] [fps]");
const data = readFileSync(inPath);
const n = UAW_W * UAW_H * 3;
const enc = new UawEncoder(Number(q));
const parts: Uint8Array[] = [];
const t0 = performance.now();
for (let o = 0; o + n <= data.length; o += n) parts.push(enc.addFrame(data.subarray(o, o + n)));
const ms = performance.now() - t0;
const [num, den] = fpsToFraction(Number(fps));
writeFileSync(outPath, Buffer.concat([enc.header(num, den), ...parts]));
const s = enc.stats;
console.log(`${outPath}: ${s.frames} frames at ${num}/${den} fps, ${(s.bytes / 1e6).toFixed(2)} MB, max record ${(s.maxRecord / 1024).toFixed(1)} KB`);
console.log(`  key ${s.key}, repeat ${s.repeat}, delta ${s.delta}, avg changed blocks per delta ${Math.round(s.changedBlocks / Math.max(1, s.delta))}, ${(ms / s.frames).toFixed(1)} ms/frame`);
