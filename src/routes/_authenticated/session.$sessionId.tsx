import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Crown,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  UserX,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PathwaayMark } from "@/components/brand";
import { RatingModal } from "@/components/rating-modal";
import { usePrivateSession } from "@/lib/use-private-session";
import { PRIVATE_SESSION_MAX, type SessionPeer } from "@/lib/private-session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/session/$sessionId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Private session — Pathwaay" },
      { name: "description", content: "A private help session on Pathwaay." },
    ],
  }),
  component: PrivateSessionPage,
});

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function PrivateSessionPage() {
  const { sessionId } = Route.useParams();
  const nav = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const t = data.session?.access_token;
      if (!t) nav({ to: "/login", replace: true });
      else setToken(t);
    });
  }, [nav]);

  const s = usePrivateSession({ sessionId, accessToken: token });
  const [rateOpen, setRateOpen] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: "remove"; peer: SessionPeer } | { kind: "end" } | null
  >(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const classroomId = s.info?.classroomId ?? null;

  const backToClassroom = () => {
    if (classroomId) nav({ to: "/classroom/$classId", params: { classId: classroomId } });
    else nav({ to: "/home" });
  };

  const leave = async () => {
    const wasHost = s.isHost;
    const helpers = s.helpers;
    await s.leave();
    if (wasHost && helpers.length) setRateOpen(true);
    else backToClassroom();
  };
  // The host leaving ends it for everyone, so ask first when others are here.
  const requestLeave = () => {
    if (s.isHost && s.peers.length) setConfirm({ kind: "end" });
    else void leave();
  };
  const onAudioBlocked = useCallback(() => setAudioBlocked(true), []);

  // Tell people when the host mutes or unmutes them.
  const prevMuted = useRef(false);
  useEffect(() => {
    if (s.hostMuted === prevMuted.current) return;
    prevMuted.current = s.hostMuted;
    toast(s.hostMuted ? "The host muted you" : "The host unmuted you — you can turn your mic on", {
      id: "host-mute",
    });
  }, [s.hostMuted]);

  const toggleMic = () => {
    const r = s.toggleMic();
    if (r === "host-muted")
      toast("The host muted you. Only they can let you speak again.", { id: "host-mute" });
    if (r === "unavailable")
      toast.error("No microphone available. Allow microphone access and rejoin.");
  };
  const toggleCam = async () => {
    const r = await s.toggleCam();
    if (r === "unavailable") toast.error("No camera available. Allow camera access and rejoin.");
    if (r === "failed") toast.error("Could not turn the camera on.");
  };

  const act = async (target: string | null, action: "mute" | "unmute" | "remove" | "mute_all") => {
    setBusy(true);
    try {
      await s.moderate(target, action);
      if (action === "remove") toast.success("Removed from the session");
      if (action === "mute_all") toast.success("Everyone else is muted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (s.status === "left" || rateOpen) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-room px-6 text-center text-white">
        <div>
          <PathwaayMark className="mx-auto h-12 w-12" />
          <p className="mt-4 text-sm text-white/70">Session ended.</p>
        </div>
        <RatingModal
          open={rateOpen}
          onClose={() => {
            setRateOpen(false);
            backToClassroom();
          }}
          ratees={s.helpers}
          classroomId={classroomId}
        />
      </div>
    );
  }

  if (s.status === "ended" || s.status === "removed" || s.status === "error") {
    const title =
      s.status === "removed"
        ? "You were removed from this session"
        : s.status === "ended"
          ? "This private session has ended"
          : "Couldn't join the private session";
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-room px-6 text-center text-white">
        <div className="max-w-sm">
          <PathwaayMark className="mx-auto h-12 w-12" />
          <h1 className="mt-4 text-lg font-bold">{title}</h1>
          {s.status === "ended" && (
            <p className="mt-2 text-sm text-white/60">
              The student who asked the doubt has closed it, or it timed out.
            </p>
          )}
          {s.error && s.status !== "ended" && (
            <p className="mt-2 text-sm text-white/60">{s.error}</p>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {s.status === "error" && (
              <button
                onClick={() => window.location.reload()}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold hover:bg-white/10"
              >
                Rejoin
              </button>
            )}
            <button
              onClick={backToClassroom}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              {classroomId ? "Back to classroom" : "Go home"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hostPresent = s.isHost || s.peers.some((p) => p.isHost);
  const total = s.peers.length + 1;

  return (
    <div className="flex h-[100dvh] flex-col bg-room text-white">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <button
          onClick={requestLeave}
          aria-label={s.isHost ? "End private session" : "Leave private session"}
          className="rounded-lg p-2 hover:bg-white/10"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <PathwaayMark className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Private session
            </span>
            {s.isHost && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-amber/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-amber">
                <Crown className="h-3 w-3" /> Host
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-white/80" title={s.info?.topic}>
            {s.info?.topic ?? "Connecting…"}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs text-white/60">
          <Users className="h-4 w-4" />
          {total}/{PRIVATE_SESSION_MAX}
        </span>
      </header>

      {audioBlocked && (
        <button
          onClick={() => {
            document.querySelectorAll<HTMLAudioElement>("audio[data-peer-audio]").forEach((a) => {
              void a.play().catch(() => undefined);
            });
            setAudioBlocked(false);
          }}
          className="mx-auto mt-3 flex items-center gap-2 rounded-full bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 ring-1 ring-amber-400/40"
        >
          <Volume2 className="h-4 w-4" /> Tap to turn on sound
        </button>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        {s.status === "connecting" ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-white/70" />
              <p className="mt-4">Joining the private session…</p>
              <p className="mt-1 text-sm text-white/50">
                Allow camera and microphone access when your browser asks.
              </p>
            </div>
          </div>
        ) : (
          <>
            {s.peers.length === 0 && (
              <p className="mb-3 rounded-lg bg-white/5 px-4 py-3 text-center text-sm text-white/70">
                {s.isHost
                  ? "Waiting for someone to join and help you…"
                  : hostPresent
                    ? "Waiting for others…"
                    : `Waiting for ${s.info?.hostName ?? "the student"} to accept your help…`}
              </p>
            )}
            <div
              className={cn(
                "grid gap-3",
                s.peers.length === 0
                  ? "mx-auto max-w-xl grid-cols-1"
                  : s.peers.length === 1
                    ? "grid-cols-1 sm:grid-cols-2"
                    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
              )}
            >
              <Tile
                name={`${s.me?.name ?? "You"} (You)`}
                track={s.camOn ? s.localVideo : null}
                micOn={s.micOn}
                isHost={s.isHost}
                hostMuted={s.hostMuted}
                me
              />
              {s.peers.map((p) => (
                <Tile
                  key={p.userId}
                  name={p.name}
                  track={p.camOn ? (p.video ?? null) : null}
                  micOn={p.micOn}
                  isHost={p.isHost}
                  hostMuted={p.hostMuted}
                  controls={
                    s.isHost && !p.isHost ? (
                      <div className="flex gap-1.5">
                        <button
                          disabled={busy}
                          onClick={() => void act(p.userId, p.hostMuted ? "unmute" : "mute")}
                          className="inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[11px] font-semibold hover:bg-black/80 disabled:opacity-50"
                          title={p.hostMuted ? "Allow them to speak" : "Mute them"}
                        >
                          {p.hostMuted ? (
                            <>
                              <Volume2 className="h-3.5 w-3.5" /> Unmute
                            </>
                          ) : (
                            <>
                              <VolumeX className="h-3.5 w-3.5" /> Mute
                            </>
                          )}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => setConfirm({ kind: "remove", peer: p })}
                          className="inline-flex items-center gap-1 rounded-md bg-danger/80 px-2 py-1 text-[11px] font-semibold hover:bg-danger disabled:opacity-50"
                          title="Remove from the session"
                        >
                          <UserX className="h-3.5 w-3.5" /> Remove
                        </button>
                      </div>
                    ) : null
                  }
                />
              ))}
            </div>
            {s.peers.map((p) =>
              p.audio ? (
                <PeerAudio
                  key={`a-${p.userId}`}
                  track={p.audio}
                  muted={p.hostMuted}
                  onBlocked={onAudioBlocked}
                />
              ) : null,
            )}
          </>
        )}
      </main>

      <footer className="border-t border-white/10 p-3">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ControlButton
            onClick={toggleMic}
            active={s.micOn}
            disabled={s.status !== "live" || !s.hasMic}
            label={s.hostMuted ? "Muted by host" : s.micOn ? "Mute" : "Unmute"}
            icon={s.micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          />
          <ControlButton
            onClick={() => void toggleCam()}
            active={s.camOn}
            disabled={s.status !== "live" || !s.hasCam}
            label={s.camOn ? "Stop video" : "Start video"}
            icon={s.camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          />
          {s.isHost && s.peers.some((p) => !p.hostMuted) && (
            <button
              disabled={busy}
              onClick={() => void act(null, "mute_all")}
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-3 text-sm font-semibold hover:bg-white/15 disabled:opacity-50"
            >
              <VolumeX className="h-5 w-5" /> Mute all
            </button>
          )}
          <button
            onClick={requestLeave}
            className="inline-flex items-center gap-2 rounded-full bg-danger px-5 py-3 text-sm font-semibold"
          >
            <PhoneOff className="h-5 w-5" />
            {s.isHost ? "End session" : "Leave"}
          </button>
        </div>
        {(!s.hasMic || !s.hasCam) && s.status === "live" && (
          <p className="mt-2 text-center text-xs text-white/45">
            {!s.hasMic && !s.hasCam
              ? "Camera and microphone are blocked — you can still watch and listen."
              : !s.hasMic
                ? "Microphone is blocked in your browser."
                : "Camera is blocked in your browser."}
          </p>
        )}
      </footer>

      {confirm && (
        <Confirm
          title={
            confirm.kind === "end"
              ? "End this session for everyone?"
              : `Remove ${confirm.peer.name}?`
          }
          body={
            confirm.kind === "end"
              ? "Everyone will be sent back to the classroom."
              : "They will be sent back to the classroom and cannot rejoin this session."
          }
          action={confirm.kind === "end" ? "End session" : "Remove"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const c = confirm;
            setConfirm(null);
            if (c.kind === "end") void leave();
            else void act(c.peer.userId, "remove");
          }}
        />
      )}
    </div>
  );
}

function Tile({
  name,
  track,
  micOn,
  isHost,
  hostMuted,
  me,
  controls,
}: {
  name: string;
  track: MediaStreamTrack | null;
  micOn: boolean;
  isHost: boolean;
  hostMuted: boolean;
  me?: boolean;
  controls?: React.ReactNode;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = track ? new MediaStream([track]) : null;
    if (track) void v.play().catch(() => undefined);
  }, [track]);
  return (
    <div
      className={cn(
        "relative aspect-video overflow-hidden rounded-xl bg-black/40 ring-1 ring-white/10",
        me && "ring-primary/60",
      )}
    >
      {track ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted
          className={cn("h-full w-full object-cover", me && "scale-x-[-1]")}
        />
      ) : (
        <div className="flex h-full items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/80 text-xl font-bold">
            {initials(name.replace(" (You)", ""))}
          </span>
        </div>
      )}
      {controls && <div className="absolute right-2 top-2">{controls}</div>}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/55 px-3 py-2 text-xs font-semibold">
        {isHost && <Crown className="h-3.5 w-3.5 shrink-0 text-brand-amber" aria-label="Host" />}
        <span className="truncate">{name}</span>
        {hostMuted && (
          <span className="shrink-0 rounded bg-danger/30 px-1.5 py-0.5 text-[10px] text-red-100">
            Muted by host
          </span>
        )}
        <span className="ml-auto shrink-0">
          {micOn ? (
            <Mic className="h-3.5 w-3.5 text-white/80" aria-label="Mic on" />
          ) : (
            <MicOff className="h-3.5 w-3.5 text-red-300" aria-label="Mic off" />
          )}
        </span>
      </div>
    </div>
  );
}

function PeerAudio({
  track,
  muted,
  onBlocked,
}: {
  track: MediaStreamTrack;
  muted: boolean;
  onBlocked: () => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.srcObject = new MediaStream([track]);
    void a.play().catch(() => onBlocked());
  }, [track, onBlocked]);
  // Receivers enforce the host's mute too, not just the muted person's browser.
  return <audio ref={ref} autoPlay data-peer-audio muted={muted} className="hidden" />;
}

function ControlButton({
  onClick,
  active,
  disabled,
  label,
  icon,
}: {
  onClick: () => void;
  active: boolean;
  disabled?: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
        active ? "bg-white/10 hover:bg-white/15" : "bg-danger/80 hover:bg-danger",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Confirm({
  title,
  body,
  action,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  action: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-foreground shadow-elevated">
        <h2 className="text-base font-bold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-semibold hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white"
          >
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}
