export interface Peer { identity: string; name: string; video?: MediaStreamTrack; }
export type LiveStatus = "connecting" | "connected" | "reconnecting" | "error";
export interface ClassroomVideo {
  status: LiveStatus; error: string | null; peers: Peer[]; localVideo: MediaStreamTrack | null;
  warningCount: number; removed: boolean; leave: () => Promise<void>;
  /** Leave without navigating away (e.g. into a private session). */
  release: () => Promise<void>;
}
export const CAMERA_ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: "f", scaleResolutionDownBy: 1, maxBitrate: 900_000 },
  { rid: "h", scaleResolutionDownBy: 2, maxBitrate: 350_000 },
  { rid: "q", scaleResolutionDownBy: 4, maxBitrate: 120_000 },
];
export const CAMERA_CONSTRAINTS: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } };
