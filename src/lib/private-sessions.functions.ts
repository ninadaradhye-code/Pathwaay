import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Browser-callable API for private help sessions. Each handler loads the
 * server-only module on demand, so Cloudflare and service-role credentials
 * never reach the client bundle.
 */
const accessToken = z.string().min(10).max(8000);
const ticket = z.string().min(10).max(4000);
const sdp = z.string().min(1).max(200_000);

export const startHelpSession = createServerFn({ method: "POST" })
  .validator((d) => z.object({ doubtId: z.string().uuid(), accessToken }).parse(d))
  .handler(async ({ data }) => {
    const m = await import("@/lib/private-sessions.server");
    return m.startHelp(data.accessToken, data.doubtId);
  });

export const declinePrivateSession = createServerFn({ method: "POST" })
  .validator((d) => z.object({ sessionId: z.string().uuid(), accessToken }).parse(d))
  .handler(async ({ data }) => {
    const m = await import("@/lib/private-sessions.server");
    return m.declineAsHost(data.accessToken, data.sessionId);
  });

export const openPrivateSession = createServerFn({ method: "POST" })
  .validator((d) => z.object({ sessionId: z.string().uuid(), accessToken }).parse(d))
  .handler(async ({ data }) => {
    const m = await import("@/lib/private-sessions.server");
    return m.openSession(data.accessToken, data.sessionId);
  });

export const pushPrivateTracks = createServerFn({ method: "POST" })
  .validator((d) =>
    z
      .object({
        ticket,
        sdp,
        tracks: z
          .array(z.object({ mid: z.string().min(1).max(64), kind: z.enum(["audio", "video"]) }))
          .min(1)
          .max(2),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const m = await import("@/lib/private-sessions.server");
    return m.pushTracks(data.ticket, data.sdp, data.tracks);
  });

export const pullPrivateTracks = createServerFn({ method: "POST" })
  .validator((d) =>
    z.object({ ticket, userIds: z.array(z.string().uuid()).min(1).max(10) }).parse(d),
  )
  .handler(async ({ data }) => {
    const m = await import("@/lib/private-sessions.server");
    return m.pullTracks(data.ticket, data.userIds);
  });

export const renegotiatePrivate = createServerFn({ method: "POST" })
  .validator((d) => z.object({ ticket, sdp }).parse(d))
  .handler(async ({ data }) => {
    const m = await import("@/lib/private-sessions.server");
    return m.renegotiate(data.ticket, data.sdp);
  });

export const heartbeatPrivate = createServerFn({ method: "POST" })
  .validator((d) => z.object({ ticket, micOn: z.boolean(), camOn: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const m = await import("@/lib/private-sessions.server");
    return m.heartbeat(data.ticket, data.micOn, data.camOn);
  });

export const moderatePrivate = createServerFn({ method: "POST" })
  .validator((d) =>
    z
      .object({
        ticket,
        targetUserId: z.string().uuid().nullable(),
        action: z.enum(["mute", "unmute", "remove", "mute_all"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const m = await import("@/lib/private-sessions.server");
    return m.moderate(data.ticket, data.targetUserId, data.action);
  });

export const leavePrivate = createServerFn({ method: "POST" })
  .validator((d) => z.object({ ticket }).parse(d))
  .handler(async ({ data }) => {
    const m = await import("@/lib/private-sessions.server");
    return m.leave(data.ticket);
  });

export const listInvitablePrivate = createServerFn({ method: "POST" })
  .validator((d) => z.object({ ticket }).parse(d))
  .handler(async ({ data }) => {
    const m = await import("@/lib/private-sessions.server");
    return m.listInvitable(data.ticket);
  });

export const inviteToPrivate = createServerFn({ method: "POST" })
  .validator((d) => z.object({ ticket, userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const m = await import("@/lib/private-sessions.server");
    return m.invite(data.ticket, data.userId);
  });

export const declinePrivateInvite = createServerFn({ method: "POST" })
  .validator((d) => z.object({ sessionId: z.string().uuid(), accessToken }).parse(d))
  .handler(async ({ data }) => {
    const m = await import("@/lib/private-sessions.server");
    return m.declineInvite(data.accessToken, data.sessionId);
  });
