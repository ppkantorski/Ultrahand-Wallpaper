// Runs the .uaw encoder off the main thread: frames in, records out, in order.
import { UawEncoder } from "./uaw";

type InMsg =
  | { type: "init"; quality: number }
  | { type: "frame"; rgb: ArrayBuffer }
  | { type: "finish"; fpsNum: number; fpsDen: number };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<InMsg>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

let encoder: UawEncoder | null = null;

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    encoder = new UawEncoder(m.quality);
  } else if (m.type === "frame") {
    const rec = encoder!.addFrame(new Uint8Array(m.rgb));
    scope.postMessage({ type: "record", record: rec.buffer, stats: { ...encoder!.stats } }, [rec.buffer]);
  } else if (m.type === "finish") {
    const header = encoder!.header(m.fpsNum, m.fpsDen);
    scope.postMessage({ type: "header", header: header.buffer, stats: { ...encoder!.stats } }, [header.buffer]);
  }
};
