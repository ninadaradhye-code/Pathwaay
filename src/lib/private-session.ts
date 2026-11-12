/** Shared (browser + server) constants and types for private help sessions. */

/** Most people in one private session: the asker plus up to five helpers. */
export const PRIVATE_SESSION_MAX = 6;

export type ModerationAction = "mute" | "unmute" | "remove" | "mute_all";

export interface SessionInfo {
  id: string;
  classroomId: string;
  hostId: string;
  hostName: string;
  startedByName: string;
  topic: string;
}

export interface SessionPeer {
  userId: string;
  name: string;
  isHost: boolean;
  micOn: boolean;
  camOn: boolean;
  hostMuted: boolean;
  video?: MediaStreamTrack;
  audio?: MediaStreamTrack;
}

export type PrivateStatus = "connecting" | "live" | "ended" | "removed" | "left" | "error";
