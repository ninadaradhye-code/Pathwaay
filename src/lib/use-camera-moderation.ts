import { useEffect, useRef, useState } from "react";

/**
 * Camera moderation, run in the student's own browser on their own camera:
 *
 *  - Away (classroom only): no face on camera for 60s starts a 2-minute
 *    countdown; a face coming back cancels it; reaching zero removes them.
 *  - Phone: a phone held in frame on two checks in a row is one incident.
 *    The frame has to clear before the next one counts; the third incident
 *    removes them.
 *  - Explicit content: only while a face is on camera, and only if it survives
 *    two re-checks, the camera is cut and they are removed immediately.
 *
 * Kept off the critical path, because it runs next to live video on student
 * laptops and phones:
 *  - Face detection is tiny (~10ms) and runs on the page every 2 seconds.
 *  - Phone detection (~250ms per frame) and the explicit-content model run in
 *    a background worker, so they never freeze the page, the chat or the
 *    video. The page only hands over a small 320px frame.
 *  - A slow check is never queued behind itself: the next one is scheduled
 *    only after the last one finishes.
 *
 * If a model cannot load (blocked CDN, old device), that check is skipped and
 * the classroom keeps working; nobody is removed by a check that is not running.
 */
export type RemovalReason = "away" | "phone" | "nsfw";

const LOOP_MS = 2000;
const AWAY_AFTER_MS = 60_000;
const AWAY_COUNTDOWN_S = 120;
const PHONE_EVERY_MS = 4000;
const PHONE_LABELS = ["cell phone", "mobile phone", "telephone"];
const PHONE_CONFIDENCE = 0.35;
const PHONE_INCIDENTS_MAX = 3;
const NSFW_EVERY_MS = 4000;
const NSFW_THRESHOLD = 0.85;
const NSFW_LOAD_DELAY_MS = 8000;
const FACE_GRACE_MS = 5000;
const FRAME_WIDTH = 320;

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const OBJECT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite";

type WorkerReply =
  | { type: "phone-ready" | "nsfw-ready" }
  | { type: "phone-error" | "nsfw-error"; message: string }
  | { type: "phone-result"; id: number; phone: boolean }
  | { type: "nsfw-result"; id: number; score: number };

export function useCameraModeration(opts: {
  /** The student's own camera track. Checks pause while it is off. */
  track: MediaStreamTrack | null;
  /** Run the "away" countdown (classroom yes, private session no). */
  awayCheck: boolean;
  /** Called once when the student must be removed. */
  onRemove: (reason: RemovalReason) => void;
}) {
  const { track, awayCheck, onRemove } = opts;
  const [awaySecondsLeft, setAwaySecondsLeft] = useState<number | null>(null);
  const [phoneIncidents, setPhoneIncidents] = useState(0);
  const [phoneInFrame, setPhoneInFrame] = useState(false);

  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;
  const awayRef = useRef(awayCheck);
  awayRef.current = awayCheck;

  useEffect(() => {
    if (!track) return;
    let stopped = false;
    let removed = false;
    let loopTimer: number | undefined;
    let countdownTimer: number | undefined;
    let nsfwTimer: number | undefined;

    let face: import("@mediapipe/tasks-vision").FaceDetector | null = null;
    let phoneReady = false;
    let nsfwReady = false;
    let phoneBusy = false;
    let nsfwBusy = false;

    let lastFaceAt = Date.now();
    let lastPhoneCheck = 0;
    let lastNsfwCheck = 0;
    let phoneStreak = 0;
    let phoneIncidentOpen = false;
    let incidents = 0;
    let awayDeadline: number | null = null;

    const probe = document.createElement("video");
    probe.muted = true;
    probe.playsInline = true;
    probe.srcObject = new MediaStream([track]);
    void probe.play().catch(() => undefined);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // ---- background worker for the heavy checks -------------------------
    let worker: Worker | null = null;
    let nextId = 1;
    const waiting = new Map<number, (v: number | boolean) => void>();
    const ask = <T extends number | boolean>(msg: object, frame: ImageBitmap) =>
      new Promise<T>((resolve) => {
        if (!worker) {
          frame.close();
          return resolve(false as T);
        }
        const id = nextId++;
        waiting.set(id, resolve as (v: number | boolean) => void);
        worker.postMessage({ ...msg, id, frame }, [frame]);
      });
    try {
      worker = new Worker(new URL("./moderation.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<WorkerReply>) => {
        const m = e.data;
        if (m.type === "phone-ready") {
          phoneReady = true;
          console.info("[moderation] phone check running in the background");
        } else if (m.type === "nsfw-ready") {
          nsfwReady = true;
          console.info("[moderation] content check running in the background");
        } else if (m.type === "phone-error" || m.type === "nsfw-error")
          console.warn(`[moderation] ${m.type}`, m.message);
        else if (m.type === "phone-result") waiting.get(m.id)?.(m.phone);
        else if (m.type === "nsfw-result") waiting.get(m.id)?.(m.score);
        if ("id" in m) waiting.delete(m.id);
      };
      worker.postMessage({ type: "init", wasm: WASM, objectModel: OBJECT_MODEL });
      // The explicit-content model is the heaviest; load it a little later so
      // it never competes with joining.
      nsfwTimer = window.setTimeout(() => {
        worker?.postMessage({ type: "init-nsfw" });
      }, NSFW_LOAD_DELAY_MS);
    } catch (err) {
      worker = null;
      console.warn("[moderation] background checks unavailable", err);
    }

    const remove = (reason: RemovalReason) => {
      if (removed) return;
      removed = true;
      stopped = true;
      window.clearTimeout(loopTimer);
      window.clearInterval(countdownTimer);
      setAwaySecondsLeft(null);
      onRemoveRef.current(reason);
    };

    const clearAway = () => {
      if (awayDeadline === null) return;
      awayDeadline = null;
      window.clearInterval(countdownTimer);
      setAwaySecondsLeft(null);
    };

    const startAway = () => {
      if (awayDeadline !== null) return;
      awayDeadline = Date.now() + AWAY_COUNTDOWN_S * 1000;
      setAwaySecondsLeft(AWAY_COUNTDOWN_S);
      countdownTimer = window.setInterval(() => {
        if (awayDeadline === null) return;
        const left = Math.max(0, Math.ceil((awayDeadline - Date.now()) / 1000));
        setAwaySecondsLeft(left);
        if (left === 0) remove("away");
      }, 1000);
    };

    const grabFrame = () => {
      if (!ctx || probe.readyState < 2 || !probe.videoWidth) return false;
      const w = FRAME_WIDTH;
      const h = Math.round((probe.videoHeight / probe.videoWidth) * w) || 180;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(probe, 0, 0, w, h);
      return true;
    };

    const checkPhone = async () => {
      phoneBusy = true;
      try {
        const phone = await ask<boolean>(
          { type: "phone", labels: PHONE_LABELS, minScore: PHONE_CONFIDENCE },
          await createImageBitmap(canvas),
        );
        if (stopped) return;
        if (phone) {
          phoneStreak += 1;
          if (phoneStreak >= 2 && !phoneIncidentOpen) {
            phoneIncidentOpen = true;
            incidents += 1;
            setPhoneIncidents(incidents);
            setPhoneInFrame(true);
            if (incidents >= PHONE_INCIDENTS_MAX) remove("phone");
          }
        } else {
          phoneStreak = 0;
          if (phoneIncidentOpen) {
            phoneIncidentOpen = false;
            setPhoneInFrame(false);
          }
        }
      } finally {
        phoneBusy = false;
      }
    };

    // Explicit content: only with a person on camera (an empty chair or a
    // wall is not a violation), and only if it survives two more looks.
    const checkNsfw = async () => {
      nsfwBusy = true;
      try {
        const score = await ask<number>({ type: "nsfw" }, await createImageBitmap(canvas));
        if (stopped || score < NSFW_THRESHOLD) return;
        let confirmed = 0;
        for (let i = 0; i < 2; i++) {
          await new Promise((r) => setTimeout(r, 400));
          if (stopped || !grabFrame()) return;
          const again = await ask<number>({ type: "nsfw" }, await createImageBitmap(canvas));
          if (again >= NSFW_THRESHOLD) confirmed += 1;
        }
        if (confirmed === 2) remove("nsfw");
      } finally {
        nsfwBusy = false;
      }
    };

    const tick = () => {
      const camOn = track.readyState === "live" && track.enabled;
      if (!camOn || !grabFrame()) return;
      const now = Date.now();

      if (face) {
        try {
          if ((face.detect(canvas).detections ?? []).length > 0) lastFaceAt = now;
        } catch {
          /* transient */
        }
        if (now - lastFaceAt < LOOP_MS * 1.5 || !awayRef.current) clearAway();
        else if (now - lastFaceAt >= AWAY_AFTER_MS) startAway();
      }

      if (phoneReady && !phoneBusy && now - lastPhoneCheck >= PHONE_EVERY_MS) {
        lastPhoneCheck = now;
        void checkPhone().catch(() => undefined);
      }

      if (
        nsfwReady &&
        !nsfwBusy &&
        now - lastNsfwCheck >= NSFW_EVERY_MS &&
        now - lastFaceAt <= FACE_GRACE_MS
      ) {
        lastNsfwCheck = now;
        void checkNsfw().catch(() => undefined);
      }
    };

    const loop = () => {
      if (stopped) return;
      try {
        tick();
      } catch {
        /* keep going */
      }
      loopTimer = window.setTimeout(loop, LOOP_MS);
    };

    // Face model (small) on the page. CPU on purpose: the GPU path stalls the
    // page for seconds while it warms up on weaker laptops.
    void (async () => {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM);
        if (stopped) return;
        face = await vision.FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate: "CPU" },
          runningMode: "IMAGE",
        });
        if (stopped) {
          face.close();
          return;
        }
        lastFaceAt = Date.now();
      } catch (err) {
        console.warn("[moderation] face detection unavailable", err);
      }
    })();
    loop();

    return () => {
      stopped = true;
      window.clearTimeout(loopTimer);
      window.clearTimeout(nsfwTimer);
      window.clearInterval(countdownTimer);
      probe.srcObject = null;
      face?.close();
      worker?.terminate();
      waiting.clear();
      setAwaySecondsLeft(null);
    };
  }, [track]);

  return {
    /** Seconds until removal for being away, or null when present. */
    awaySecondsLeft,
    phoneIncidents,
    phoneInFrame,
    phoneIncidentsMax: PHONE_INCIDENTS_MAX,
  };
}
