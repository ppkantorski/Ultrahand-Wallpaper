// Node check of the GIF decoder: composed frames out as raw RGBA.
//   node test/gif-test.ts in.gif out.rgba
import { readFileSync, writeFileSync } from "node:fs";
import { GifCompositor, parseGif } from "../src/lib/gif.ts";

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) throw new Error("usage: gif-test.ts in.gif out.rgba");
const gif = parseGif(readFileSync(inPath));
const comp = new GifCompositor(gif);
const parts: Buffer[] = [];
for (let i = 0; i < gif.frames.length; i++) {
  comp.seek(i);
  parts.push(Buffer.from(comp.rgba));
}
writeFileSync(outPath, Buffer.concat(parts));
const delays = [...new Set(gif.frames.map((f) => f.delay))];
console.log(`${inPath}: ${gif.width}x${gif.height}, ${gif.frames.length} frames, ${gif.duration.toFixed(2)} s, delays ${delays.join("/")} s, disposals ${[...new Set(gif.frames.map((f) => f.disposal))].join("/")}, partial frames ${gif.frames.filter((f) => f.w !== gif.width || f.h !== gif.height).length}`);
