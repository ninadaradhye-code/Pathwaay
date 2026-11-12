/**
 * Server-only logic for private help sessions.
 *
 * Imported with `await import()` from inside the handlers in
 * private-sessions.functions.ts, which keeps this module — and the Cloudflare
 * and Supabase service credentials it reads — out of the browser bundle.
 *
 * Media runs on the same Cloudflare Realtime SFU as classroom video. Two rules
 * keep a private session private:
 *  - Cloudflare session ids never leave the server. Clients ask to pull "that
 *    participant's tracks"; the server checks both people are in the same live
 *    session and resolves the ids itself.
 *  - Every state change (join, mute, remove, leave) goes through the SECURITY
 *    DEFINER functions in 20261112090000_classroom_chat_and_private_sessions,
 *    so host-only moderation and "removed people cannot rejoin" hold even
 *    against a modified client.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeClassroomAccess } from "@/lib/classroom-access";
import { PRIVATE_SESSION_MAX, type ModerationAction } from "@/lib/private-session";

const API_ROOT = "https://rtc.live.cloudflare.com/v1/apps";
const TICKET_TTL_MS = 4 * 60 * 60 * 1000;

export type PrivateTicket = {
  kind: "private";
  /** private_sessions.id */
  sid: string;
  /** auth user id */
  uid: string;
  /** this person's own Cloudflare session id */
  cf: string;
  exp: number;
};

// ---------------------------------------------------------------------------
// Tickets: an HMAC-signed handle the browser presents on every media call.
// Domain-separated from classroom tickets, so neither works on the other's
// endpoints even though they share the secret.
// ---------------------------------------------------------------------------
function ticketSecret(): string {
  const s = process.env.CLASSROOM_TICKET_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Private session server configuration is incomplete.");
  return s;
}

function ticketMac(body: string): string {
  return createHmac("sha256", ticketSecret()).update(`private-session:${body}`).digest("base64url");
}

function signTicket(t: PrivateTicket): string {
  const body = Buffer.from(JSON.stringify(t)).toString("base64url");
  return `${body}.${ticketMac(body)}`;
}

export function readTicket(ticket: string): PrivateTicket {
  const [body, mac] = ticket.split(".");
  if (!body || !mac) throw new Error("Invalid private session.");
  const expected = ticketMac(body);
  if (
    Buffer.byteLength(mac) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
  ) {
    throw new Error("Invalid private session.");
  }
  const t = JSON.parse(Buffer.from(body, "base64url").toString()) as PrivateTicket;
  if (t.kind !== "private") throw new Error("Invalid private session.");
  if (t.exp < Date.now())
    throw new Error("Your private session expired. Rejoin it from the classroom.");
  return t;
}

// ---------------------------------------------------------------------------
// Cloudflare Realtime SFU
// ---------------------------------------------------------------------------
function credentials() {
  const appId = process.env.CF_REALTIME_APP_ID;
  const appToken = process.env.CF_REALTIME_APP_TOKEN;
  if (!appId || !appToken) {
    throw new Error(
      "Private sessions are unavailable because Cloudflare Realtime is not configured on the server. Set CF_REALTIME_APP_ID and CF_REALTIME_APP_TOKEN.",
    );
  }
  return { appId, appToken };
}

type CfTrackResult = {
  mid?: string;
  trackName?: string;
  sessionId?: string;
  errorCode?: string;
  errorDescription?: string;
};
type CfTracksResponse = {
  tracks?: CfTrackResult[];
  requiresImmediateRenegotiation?: boolean;
  sessionDescription?: { type: "offer" | "answer"; sdp: string };
};

async function cf<T>(path: string, method: "POST" | "PUT", body?: unknown): Promise<T> {
  const { appId, appToken } = credentials();
  const res = await fetch(`${API_ROOT}/${appId}${path}`, {
    method,
    headers: { Authorization: `Bearer ${appToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: { errorCode?: string; errorDescription?: string } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Cloudflare Realtime returned an unexpected response (HTTP ${res.status}).`);
  }
  if (!res.ok || json.errorCode) {
    throw new Error(
      json.errorDescription || `Cloudflare Realtime request failed (HTTP ${res.status}).`,
    );
  }
  return json as T;
}

const camTrack = (userId: string) => `cam-${userId}`;
const micTrack = (userId: string) => `mic-${userId}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function userFromToken(accessToken: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) throw new Error("Not signed in.");
  return data.user.id;
}

/** The caller must be in the session, and the session must still be running. */
async function requireActiveParticipant(t: PrivateTicket) {
  const [{ data: me }, { data: session }] = await Promise.all([
    supabaseAdmin
      .from("private_session_participants")
      .select("status")
      .eq("session_id", t.sid)
      .eq("user_id", t.uid)
      .maybeSingle(),
    supabaseAdmin.from("private_sessions").select("status").eq("id", t.sid).maybeSingle(),
  ]);
  if (!session || session.status !== "live") throw new Error("This private session has ended.");
  if (me?.status === "removed") throw new Error("The host removed you from this private session.");
  if (me?.status !== "joined") throw new Error("You are no longer in this private session.");
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** "Help" on a doubt: returns the live session for it, creating one if needed. */
export async function startHelp(accessToken: string, doubtId: string) {
  const { data: doubt } = await supabaseAdmin
    .from("classroom_messages")
    .select("classroom_id, kind")
    .eq("id", doubtId)
    .maybeSingle();
  if (!doubt || doubt.kind !== "doubt") throw new Error("That doubt no longer exists.");

  // Same gate as entering the classroom: signed in, onboarded, not suspended,
  // and the subject is on their course.
  const access = await authorizeClassroomAccess(accessToken, doubt.classroom_id);
  const { data, error } = await supabaseAdmin.rpc("start_help_session", {
    p_doubt_id: doubtId,
    p_helper_id: access.userId,
    p_helper_name: access.displayName,
  });
  if (error) throw new Error(error.message);
  return { sessionId: data as string };
}

/** The host turns a help request down (or ends a session from the classroom). */
export async function declineAsHost(accessToken: string, sessionId: string) {
  const userId = await userFromToken(accessToken);
  const { data: s } = await supabaseAdmin
    .from("private_sessions")
    .select("host_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!s) return { ended: true };
  if (s.host_id !== userId) throw new Error("Only the student who asked the doubt can do that.");
  const { error } = await supabaseAdmin.rpc("leave_private_session", {
    p_session_id: sessionId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  return { ended: true };
}

/** Enter a session: records the seat, opens a Cloudflare session, returns a ticket. */
export async function openSession(accessToken: string, sessionId: string) {
  const { data: s } = await supabaseAdmin
    .from("private_sessions")
    .select("id, classroom_id, host_id, host_name, started_by_name, topic, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!s || s.status !== "live") throw new Error("This private session has ended.");

  const access = await authorizeClassroomAccess(accessToken, s.classroom_id);
  const { data: isHost, error } = await supabaseAdmin.rpc("join_private_session", {
    p_session_id: sessionId,
    p_user_id: access.userId,
    p_name: access.displayName,
    p_max: PRIVATE_SESSION_MAX,
  });
  if (error) throw new Error(error.message);

  let cfSessionId: string;
  try {
    const created = await cf<{ sessionId: string }>("/sessions/new", "POST");
    cfSessionId = created.sessionId;
    const { error: mediaError } = await supabaseAdmin.from("private_session_media").upsert({
      session_id: sessionId,
      user_id: access.userId,
      cf_session_id: cfSessionId,
      pulled_mids: [],
      updated_at: new Date().toISOString(),
    });
    if (mediaError) throw new Error(mediaError.message);
  } catch (e) {
    // Give the seat back without ending the session, even for the host: a
    // media hiccup should not throw everyone else out.
    await supabaseAdmin
      .from("private_session_participants")
      .update({ status: "left", mic_on: false, cam_on: false })
      .eq("session_id", sessionId)
      .eq("user_id", access.userId)
      .eq("status", "joined");
    throw e;
  }

  return {
    ticket: signTicket({
      kind: "private",
      sid: sessionId,
      uid: access.userId,
      cf: cfSessionId,
      exp: Date.now() + TICKET_TTL_MS,
    }),
    isHost: Boolean(isHost),
    me: { userId: access.userId, name: access.displayName },
    session: {
      id: s.id,
      classroomId: s.classroom_id,
      hostId: s.host_id,
      hostName: s.host_name,
      startedByName: s.started_by_name,
      topic: s.topic,
    },
  };
}

/** Publish this person's camera and mic. Track names are assigned here. */
export async function pushTracks(
  ticket: string,
  sdp: string,
  tracks: Array<{ mid: string; kind: "audio" | "video" }>,
) {
  const t = readTicket(ticket);
  await requireActiveParticipant(t);
  const r = await cf<CfTracksResponse>(`/sessions/${t.cf}/tracks/new`, "POST", {
    sessionDescription: { type: "offer", sdp },
    tracks: tracks.map((x) => ({
      location: "local",
      mid: x.mid,
      trackName: x.kind === "video" ? camTrack(t.uid) : micTrack(t.uid),
    })),
  });
  // Tell everyone else there is something new to pull.
  await supabaseAdmin.rpc("mark_private_media_published", {
    p_session_id: t.sid,
    p_user_id: t.uid,
  });
  return { sessionDescription: r.sessionDescription ?? null };
}

/** Subscribe to other participants' camera + mic. */
export async function pullTracks(ticket: string, userIds: string[]) {
  const t = readTicket(ticket);
  await requireActiveParticipant(t);

  const wanted = [...new Set(userIds)].filter((id) => id !== t.uid).slice(0, PRIVATE_SESSION_MAX);
  if (!wanted.length)
    return { tracks: [], requiresImmediateRenegotiation: false, sessionDescription: null };

  // Only people actually in this same live session, who have published.
  const { data: present } = await supabaseAdmin
    .from("private_session_participants")
    .select("user_id")
    .eq("session_id", t.sid)
    .eq("status", "joined")
    .gt("media_version", 0)
    .in("user_id", wanted);
  const allowed = (present ?? []).map((p) => p.user_id);
  if (!allowed.length)
    return { tracks: [], requiresImmediateRenegotiation: false, sessionDescription: null };

  const { data: media } = await supabaseAdmin
    .from("private_session_media")
    .select("user_id, cf_session_id")
    .eq("session_id", t.sid)
    .in("user_id", allowed);
  const remote = (media ?? []).filter((m) => m.cf_session_id && m.cf_session_id !== t.cf);
  if (!remote.length)
    return { tracks: [], requiresImmediateRenegotiation: false, sessionDescription: null };

  const requested = remote.flatMap((m) => [
    {
      userId: m.user_id,
      kind: "video" as const,
      sessionId: m.cf_session_id,
      trackName: camTrack(m.user_id),
    },
    {
      userId: m.user_id,
      kind: "audio" as const,
      sessionId: m.cf_session_id,
      trackName: micTrack(m.user_id),
    },
  ]);
  const r = await cf<CfTracksResponse>(`/sessions/${t.cf}/tracks/new`, "POST", {
    tracks: requested.map((x) => ({
      location: "remote",
      sessionId: x.sessionId,
      trackName: x.trackName,
    })),
  });

  const results = requested.map((x, i) => {
    const got = r.tracks?.[i];
    return {
      userId: x.userId,
      kind: x.kind,
      mid: got?.mid ?? null,
      // Someone who joined without a camera or mic simply has no such track.
      error: got?.errorCode ? got.errorDescription || got.errorCode : null,
    };
  });

  // Remember what this person is receiving, so it can be cut off if the host
  // removes them.
  const mids = results.map((x) => x.mid).filter((m): m is string => !!m);
  if (mids.length) {
    const { data: mine } = await supabaseAdmin
      .from("private_session_media")
      .select("pulled_mids")
      .eq("session_id", t.sid)
      .eq("user_id", t.uid)
      .maybeSingle();
    const merged = [...new Set([...(mine?.pulled_mids ?? []), ...mids])];
    await supabaseAdmin
      .from("private_session_media")
      .update({ pulled_mids: merged, updated_at: new Date().toISOString() })
      .eq("session_id", t.sid)
      .eq("user_id", t.uid);
  }

  return {
    tracks: results,
    requiresImmediateRenegotiation: Boolean(r.requiresImmediateRenegotiation),
    sessionDescription: r.sessionDescription ?? null,
  };
}

export async function renegotiate(ticket: string, sdp: string) {
  const t = readTicket(ticket);
  await requireActiveParticipant(t);
  await cf(`/sessions/${t.cf}/renegotiate`, "PUT", { sessionDescription: { type: "answer", sdp } });
  return { ok: true };
}

/** Liveness + mic/cam state; tells the client if it was muted, removed or the session ended. */
export async function heartbeat(ticket: string, micOn: boolean, camOn: boolean) {
  const t = readTicket(ticket);
  const { data, error } = await supabaseAdmin.rpc("heartbeat_private_session", {
    p_session_id: t.sid,
    p_user_id: t.uid,
    p_mic: micOn,
    p_cam: camOn,
  });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  return {
    status: (row?.participant_status ?? "left") as "joined" | "left" | "removed",
    hostMuted: Boolean(row?.host_muted),
    sessionStatus: (row?.session_status ?? "ended") as "live" | "ended",
  };
}

/** Host only: mute / unmute / remove a participant, or mute everyone. */
export async function moderate(ticket: string, target: string | null, action: ModerationAction) {
  const t = readTicket(ticket);
  const { error } = await supabaseAdmin.rpc("moderate_private_session", {
    p_session_id: t.sid,
    p_host_id: t.uid,
    p_target: target,
    p_action: action,
  });
  if (error) throw new Error(error.message);

  if (action === "remove" && target) {
    // Best effort: close everything the removed person was receiving, so a
    // modified client cannot keep watching after being removed.
    const { data: media } = await supabaseAdmin
      .from("private_session_media")
      .select("cf_session_id, pulled_mids")
      .eq("session_id", t.sid)
      .eq("user_id", target)
      .maybeSingle();
    if (media?.cf_session_id && media.pulled_mids?.length) {
      await cf(`/sessions/${media.cf_session_id}/tracks/close`, "PUT", {
        tracks: media.pulled_mids.map((mid) => ({ mid })),
        force: true,
      }).catch(() => undefined);
    }
  }
  return { ok: true };
}

export async function leave(ticket: string) {
  const t = readTicket(ticket);
  const { data, error } = await supabaseAdmin.rpc("leave_private_session", {
    p_session_id: t.sid,
    p_user_id: t.uid,
  });
  if (error) throw new Error(error.message);
  return { ended: Boolean(data) };
}

// ---------------------------------------------------------------------------
// Invites (sessions are invite-only)
// ---------------------------------------------------------------------------

/** Host only: classmates in the classroom right now who could be invited. */
export async function listInvitable(ticket: string) {
  const t = readTicket(ticket);
  const { data, error } = await supabaseAdmin.rpc("list_private_session_invitees", {
    p_session_id: t.sid,
    p_host_id: t.uid,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    name: r.name,
    inviteStatus: (r.invite_status ?? null) as
      "pending" | "accepted" | "declined" | "expired" | "cancelled" | null,
    busy: Boolean(r.busy),
  }));
}

/** Host only: invite a classmate into this session. */
export async function invite(ticket: string, inviteeId: string) {
  const t = readTicket(ticket);
  const { error } = await supabaseAdmin.rpc("invite_to_private_session", {
    p_session_id: t.sid,
    p_host_id: t.uid,
    p_invitee_id: inviteeId,
    p_max: PRIVATE_SESSION_MAX,
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** The invitee says no, from the classroom. */
export async function declineInvite(accessToken: string, sessionId: string) {
  const userId = await userFromToken(accessToken);
  const { error } = await supabaseAdmin.rpc("decline_private_invite", {
    p_session_id: sessionId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}
