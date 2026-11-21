/// <reference lib="webworker" />
/**
 * Background thread for the heavy camera checks (phone detection and explicit
 * content), so they never block the page, the chat or the video while they
 * run. The page sends one small frame at a time as an ImageBitmap; this
 * worker answers with what it saw.
 */
import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";

type InMsg =
  | { type: "init"; wasm: string; objectModel: string }
  | { type: "init-nsfw" }
  | { type: "phone"; id: number; frame: ImageBitmap; labels: string[]; minScore: number }
  | { type: "nsfw"; id: number; frame: ImageBitmap };

let objects: ObjectDetector | null = null;
let nsfwModel: import("nsfwjs").NSFWJS | null = null;
const scratch = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(224, 224) : null;

const post = (m: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

// MediaPipe loads its WASM glue as a classic script. Module workers have no
// importScripts, so MediaPipe falls back to a `self.import` hook when one is
// defined: run the script in global scope so it can register ModuleFactory.
(self as unknown as { import: (url: string) => Promise<void> }).import = async (url: string) => {
  const code = await (await fetch(url)).text();
  (0, eval)(`${code}
;self.ModuleFactory = ModuleFactory;`);
};

async function initNsfw() {
  try {
    const tf = await import("@tensorflow/tfjs");
    // WebGL in a worker needs OffscreenCanvas; otherwise fall back to the CPU.
    try {
      await tf.setBackend("webgl");
    } catch {
      await tf.setBackend("cpu");
    }
    await tf.ready();
    const lib = await import("nsfwjs");
    nsfwModel = await lib.load();
    post({ type: "nsfw-ready", backend: tf.getBackend() });
  } catch (err) {
    post({ type: "nsfw-error", message: String(err) });
  }
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === "init") {
    try {
      const fileset = await FilesetResolver.forVisionTasks(msg.wasm);
      objects = await ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: msg.objectModel, delegate: "CPU" },
        runningMode: "IMAGE",
        scoreThreshold: 0.3,
        maxResults: 5,
      });
      post({ type: "phone-ready" });
    } catch (err) {
      post({ type: "phone-error", message: String(err) });
    }
    return;
  }

  if (msg.type === "init-nsfw") {
    if (!nsfwModel) void initNsfw();
    return;
  }

  if (msg.type === "phone") {
    let phone = false;
    try {
      if (objects) {
        const res = objects.detect(msg.frame);
        const labels = new Set(msg.labels);
        phone = (res.detections ?? []).some((d) =>
          (d.categories ?? []).some(
            (c) =>
              labels.has((c.categoryName ?? "").toLowerCase()) && (c.score ?? 0) >= msg.minScore,
          ),
        );
      }
    } catch {
      /* transient */
    }
    msg.frame.close();
    post({ type: "phone-result", id: msg.id, phone });
    return;
  }

  if (msg.type === "nsfw") {
    let score = 0;
    try {
      if (nsfwModel && scratch) {
        const ctx = scratch.getContext("2d")!;
        ctx.drawImage(msg.frame, 0, 0, 224, 224);
        const preds = await nsfwModel.classify(scratch as unknown as HTMLCanvasElement, 5);
        const by = (n: string) => preds.find((p) => p.className === n)?.probability ?? 0;
        // Strongest explicit class, and only if it beats the ordinary classes.
        const explicit = Math.max(by("Porn"), by("Hentai"));
        const benign = Math.max(by("Neutral"), by("Drawing"));
        score = explicit > benign ? explicit : 0;
      }
    } catch {
      /* transient */
    }
    msg.frame.close();
    post({ type: "nsfw-result", id: msg.id, score });
  }
};
