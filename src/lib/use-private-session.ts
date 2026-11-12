import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  heartbeatPrivate,
  inviteToPrivate,
  leavePrivate,
  listInvitablePrivate,
  moderatePrivate,
  openPrivateSession,
  pullPrivateTracks,
  pushPrivateTracks,
  renegotiatePrivate,
} from "@/lib/private-sessions.functions";
import { CAMERA_CONSTRAINTS } from "@/lib/classroom-video";
import type {
  ModerationAction,
  PrivateStatus,
  SessionInfo,
  SessionPeer,
} from "@/lib/private-session";

const HEARTBEAT_MS = 5000;
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

type RosterRow = {
  user_id: string;
  name: string;
  is_host: boolean;
  status: "joined" | "left" | "removed";
  mic_on: boolean;
  cam_on: boolean;
  host_muted: boolean;
  media_version: number;
};

export type ToggleResult = "ok" | "unavailable" | "host-muted" | "failed";

/**
 * One person's connection to a private help session: their camera + mic on the
 * Cloudflare SFU, everyone else's media, and the live roster (mic/cam state,
 * host mute, removal) from the database.
 */
export function usePrivateSession(opts: { sessionId: string; accessToken: string | null }) {
  const { sessionId, accessToken } = opts;
  const [status, setStatus] = useState<PrivateStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [me, setMe] = useState<{ userId: string; name: string } | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [peers, setPeers] = useState<SessionPeer[]>([]);
  const [localVideo, setLocalVideo] = useState<MediaStreamTrack | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [hasCam, setHasCam] = useState(false);
  const [hostMuted, setHostMuted] = useState(false);
  // Everyone other than the host who took part, kept after they leave so the
  // host can rate them at the end.
  const [helpers, setHelpers] = useState<Array<{ userId: string; name: string }>>([]);

  const ticketRef = useRef<string | null>(null);
  const statusRef = useRef<PrivateStatus>("connecting");
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const camTrackRef = useRef<MediaStreamTrack | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const micOnRef = useRef(false);
  const camOnRef = useRef(false);
  const hostMutedRef = useRef(false);
  const beatRef = useRef<(() => Promise<void>) | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!sessionId || !accessToken) return;
    let disposed = false;
    let myId: string | null = null;
    let pc: RTCPeerConnection | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let heartbeatTimer: number | undefined;
    let failures = 0;
    let pullQueue: Promise<void> = Promise.resolve();

    const roster = new Map<string, RosterRow>();
    const media = new Map<string, { video?: MediaStreamTrack; audio?: MediaStreamTrack }>();
    const pulledVersion = new Map<string, number>();
    const mids = new Map<string, { userId: string; kind: "audio" | "video" }>();
    const everJoined = new Map<string, string>();

    const setPhase = (s: PrivateStatus) => {
      statusRef.current = s;
      setStatus(s);
    };

    const render = () => {
      if (disposed) return;
      setPeers(
        [...roster.values()]
          .filter((r) => r.user_id !== myId && r.status === "joined")
          .sort((a, b) => Number(b.is_host) - Number(a.is_host) || a.name.localeCompare(b.name))
          .map((r) => ({
            userId: r.user_id,
            name: r.name || "Student",
            isHost: r.is_host,
            micOn: r.mic_on,
            camOn: r.cam_on,
            hostMuted: r.host_muted,
            video: media.get(r.user_id)?.video,
            audio: media.get(r.user_id)?.audio,
          })),
      );
      setHelpers([...everJoined].map(([userId, name]) => ({ userId, name })));
    };

    const stopMedia = () => {
      window.clearInterval(heartbeatTimer);
      micTrackRef.current?.stop();
      camTrackRef.current?.stop();
      micTrackRef.current = null;
      camTrackRef.current = null;
      pc?.close();
      pc = null;
      if (channel) {
        const c = channel;
        channel = null;
        void supabase.removeChannel(c);
      }
    };
    stopRef.current = stopMedia;

    const finish = (s: PrivateStatus, message?: string) => {
      if (disposed || ["ended", "removed", "left", "error"].includes(statusRef.current)) return;
      if (message) setError(message);
      setPhase(s);
      stopMedia();
    };

    const applyHostMuted = (muted: boolean) => {
      if (muted === hostMutedRef.current) return;
      hostMutedRef.current = muted;
      setHostMuted(muted);
      if (muted && micTrackRef.current) {
        micTrackRef.current.enabled = false;
        micOnRef.current = false;
        setMicOn(false);
      }
    };

    const doPull = async (userIds: string[]) => {
      const ticket = ticketRef.current;
      if (!pc || !ticket || disposed) return;
      const r = await pullPrivateTracks({ data: { ticket, userIds } });
      r.tracks.forEach((t) => {
        if (t.mid) mids.set(t.mid, { userId: t.userId, kind: t.kind });
      });
      if (r.requiresImmediateRenegotiation && r.sessionDescription && pc) {
        await pc.setRemoteDescription(r.sessionDescription);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await renegotiatePrivate({ data: { ticket, sdp: answer.sdp ?? "" } });
      }
    };

    // Pull anyone who has published something we have not received yet.
    // Serialised: Cloudflare renegotiations must not overlap.
    const reconcile = () => {
      if (disposed || !pc) return;
      const want = [...roster.values()].filter(
        (r) =>
          r.user_id !== myId &&
          r.status === "joined" &&
          r.media_version > 0 &&
          (pulledVersion.get(r.user_id) ?? 0) < r.media_version,
      );
      if (!want.length) return;
      want.forEach((r) => pulledVersion.set(r.user_id, r.media_version));
      const ids = want.map((r) => r.user_id);
      pullQueue = pullQueue
        .then(() => doPull(ids))
        .catch(() => {
          // Retried on the next heartbeat tick.
          ids.forEach((id) => pulledVersion.delete(id));
        });
    };

    const upsertRow = (row: RosterRow) => {
      if (disposed || !row?.user_id) return;
      roster.set(row.user_id, row);
      if (row.user_id === myId) {
        if (row.status === "removed") {
          finish("removed", "The host removed you from this private session.");
          return;
        }
        applyHostMuted(row.host_muted);
      } else if (row.status === "joined") {
        if (!row.is_host) everJoined.set(row.user_id, row.name || "Student");
      } else {
        media.delete(row.user_id);
        pulledVersion.delete(row.user_id);
      }
      render();
      reconcile();
    };

    const beat = async () => {
      const ticket = ticketRef.current;
      if (!ticket || disposed || statusRef.current !== "live") return;
      try {
        const r = await heartbeatPrivate({
          data: { ticket, micOn: micOnRef.current, camOn: camOnRef.current },
        });
        if (disposed) return;
        failures = 0;
        if (r.status === "removed") {
          finish("removed", "The host removed you from this private session.");
          return;
        }
        if (r.sessionStatus === "ended") {
          finish("ended");
          return;
        }
        if (r.status !== "joined") {
          finish("error", "You were disconnected from this private session.");
          return;
        }
        applyHostMuted(r.hostMuted);
        reconcile();
      } catch {
        if (++failures >= 3) finish("error", "Connection to the private session was lost.");
      }
    };
    beatRef.current = beat;

    const run = async () => {
      // Camera + mic if allowed; fall back to whichever is available. Nobody is
      // forced to show their face in a private session.
      let stream: MediaStream | null = null;
      for (const c of [
        { video: CAMERA_CONSTRAINTS, audio: AUDIO_CONSTRAINTS },
        { audio: AUDIO_CONSTRAINTS },
        { video: CAMERA_CONSTRAINTS },
      ] as MediaStreamConstraints[]) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(c);
          break;
        } catch {
          /* try the next combination */
        }
      }
      if (disposed) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      const mic = stream?.getAudioTracks()[0] ?? null;
      const cam = stream?.getVideoTracks()[0] ?? null;
      micTrackRef.current = mic;
      camTrackRef.current = cam;
      micOnRef.current = !!mic;
      camOnRef.current = !!cam;
      setHasMic(!!mic);
      setHasCam(!!cam);
      setMicOn(!!mic);
      setCamOn(!!cam);
      setLocalVideo(cam);

      const opened = await openPrivateSession({ data: { sessionId, accessToken } });
      if (disposed) return;
      ticketRef.current = opened.ticket;
      myId = opened.me.userId;
      setMe(opened.me);
      setInfo(opened.session);
      setIsHost(opened.isHost);

      pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        bundlePolicy: "max-bundle",
      });
      pc.ontrack = (e) => {
        const mid = e.transceiver?.mid;
        const who = mid ? mids.get(mid) : undefined;
        if (!who) return;
        const entry = media.get(who.userId) ?? {};
        entry[who.kind] = e.track;
        media.set(who.userId, entry);
        render();
      };
      pc.oniceconnectionstatechange = () => {
        if (pc?.iceConnectionState === "failed") {
          finish("error", "The connection dropped. Rejoin the session to continue.");
        }
      };

      const outgoing: Array<{ transceiver: RTCRtpTransceiver; kind: "audio" | "video" }> = [];
      if (cam) {
        const transceiver = pc.addTransceiver(cam, {
          direction: "sendonly",
          sendEncodings: [{ maxBitrate: 1_200_000 }],
        });
        videoSenderRef.current = transceiver.sender;
        outgoing.push({ transceiver, kind: "video" });
      }
      if (mic)
        outgoing.push({
          transceiver: pc.addTransceiver(mic, { direction: "sendonly" }),
          kind: "audio",
        });

      if (outgoing.length) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const pushed = await pushPrivateTracks({
          data: {
            ticket: opened.ticket,
            sdp: offer.sdp ?? "",
            tracks: outgoing.map((o) => ({ mid: o.transceiver.mid ?? "", kind: o.kind })),
          },
        });
        if (disposed) return;
        if (pushed.sessionDescription) await pc.setRemoteDescription(pushed.sessionDescription);
      }

      // Unique topic per mount: supabase.channel() hands back an existing
      // channel with the same name, which throws if it is still joining.
      channel = supabase
        .channel(`private-session:${sessionId}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "private_session_participants",
            filter: `session_id=eq.${sessionId}`,
          },
          (payload) => {
            const row = payload.new as RosterRow | undefined;
            if (row && "user_id" in row) upsertRow(row);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "private_sessions",
            filter: `id=eq.${sessionId}`,
          },
          (payload) => {
            if ((payload.new as { status?: string }).status === "ended") finish("ended");
          },
        )
        .subscribe();

      const { data: rows } = await supabase
        .from("private_session_participants")
        .select("user_id, name, is_host, status, mic_on, cam_on, host_muted, media_version")
        .eq("session_id", sessionId);
      if (disposed) return;
      setPhase("live");
      (rows ?? []).forEach((r) => upsertRow(r as RosterRow));
      heartbeatTimer = window.setInterval(() => void beat(), HEARTBEAT_MS);
      void beat();
    };

    void run().catch((e) => {
      finish("error", e instanceof Error ? e.message : "Could not join the private session.");
    });

    return () => {
      disposed = true;
      stopMedia();
    };
  }, [sessionId, accessToken]);

  const toggleMic = useCallback((): ToggleResult => {
    const track = micTrackRef.current;
    if (!track) return "unavailable";
    if (!micOnRef.current && hostMutedRef.current) return "host-muted";
    const next = !micOnRef.current;
    track.enabled = next;
    micOnRef.current = next;
    setMicOn(next);
    void beatRef.current?.();
    return "ok";
  }, []);

  // Turning the camera off releases it (the light goes off); turning it back on
  // swaps a fresh track into the same sender, so nothing is renegotiated.
  const toggleCam = useCallback(async (): Promise<ToggleResult> => {
    const sender = videoSenderRef.current;
    if (!sender) return "unavailable";
    if (camOnRef.current) {
      camTrackRef.current?.stop();
      camTrackRef.current = null;
      await sender.replaceTrack(null).catch(() => undefined);
      camOnRef.current = false;
      setCamOn(false);
      setLocalVideo(null);
    } else {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: CAMERA_CONSTRAINTS });
        const track = s.getVideoTracks()[0];
        if (!track) return "failed";
        await sender.replaceTrack(track);
        camTrackRef.current = track;
        camOnRef.current = true;
        setCamOn(true);
        setLocalVideo(track);
      } catch {
        return "failed";
      }
    }
    void beatRef.current?.();
    return "ok";
  }, []);

  const moderate = useCallback(async (targetUserId: string | null, action: ModerationAction) => {
    const ticket = ticketRef.current;
    if (!ticket) throw new Error("Not connected.");
    await moderatePrivate({ data: { ticket, targetUserId, action } });
  }, []);

  /** Host only: classmates who could be invited, with any invite already sent. */
  const listInvitable = useCallback(async () => {
    const ticket = ticketRef.current;
    if (!ticket) throw new Error("Not connected.");
    return listInvitablePrivate({ data: { ticket } });
  }, []);

  /** Host only: invite a classmate (sessions are invite-only). */
  const invite = useCallback(async (userId: string) => {
    const ticket = ticketRef.current;
    if (!ticket) throw new Error("Not connected.");
    await inviteToPrivate({ data: { ticket, userId } });
  }, []);

  /** Leave. For the host this ends the session for everyone. */
  const leave = useCallback(async () => {
    const ticket = ticketRef.current;
    let ended = false;
    if (ticket && statusRef.current === "live") {
      try {
        ended = (await leavePrivate({ data: { ticket } })).ended;
      } catch {
        /* the sweep will catch up */
      }
    }
    statusRef.current = "left";
    setStatus("left");
    stopRef.current?.();
    return { ended };
  }, []);

  return {
    status,
    error,
    info,
    me,
    isHost,
    peers,
    localVideo,
    micOn,
    camOn,
    hasMic,
    hasCam,
    hostMuted,
    helpers,
    toggleMic,
    toggleCam,
    moderate,
    listInvitable,
    invite,
    leave,
  };
}
