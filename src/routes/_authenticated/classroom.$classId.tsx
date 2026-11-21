import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  PhoneOff,
  Smartphone,
  UserX,
  Users,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PathwaayMark } from "@/components/brand";
import { ClassroomPanel } from "@/components/classroom-panel";
import { authorizeClassroom } from "@/lib/classroom-video.functions";
import { useCloudflareRealtime } from "@/lib/use-cloudflare-realtime";
import { useCameraModeration, type RemovalReason } from "@/lib/use-camera-moderation";
import { cn } from "@/lib/utils";

// Set while walking from this classroom into one of its private sessions, which
// is not "leaving": the person's messages stay while that session is live.
let steppingIntoSession: string | null = null;

/** Delete my chat messages and doubts in a classroom (I am leaving it). */
function withdrawMessages(classId: string) {
  return supabase.rpc("withdraw_my_classroom_messages", { _classroom_id: classId }).then(
    () => undefined,
    () => undefined,
  );
}

export const Route = createFileRoute("/_authenticated/classroom/$classId")({
  ssr: false,
  component: Classroom,
  // Any way out of the classroom — Leave, back arrow, browser back, a link —
  // takes the person's messages with them. (Closing the tab is caught by the
  // server-side sweep within about 90 seconds.)
  onLeave: (match) => {
    const classId = (match.params as { classId: string }).classId;
    if (steppingIntoSession === classId) {
      steppingIntoSession = null;
      return;
    }
    void withdrawMessages(classId);
  },
});

/** Tiles on one page of the grid, including your own. */
const PAGE_SIZE = 15;

const REMOVAL_MESSAGE: Record<RemovalReason, { title: string; body: string }> = {
  away: {
    title: "Removed for being away",
    body: "You weren't on camera for over 3 minutes, so your seat was given back. Rejoin whenever you're ready to study.",
  },
  phone: {
    title: "Removed for using a phone",
    body: "A phone was in view three separate times. Phones aren't allowed in classrooms; keep yours out of sight and rejoin.",
  },
  nsfw: {
    title: "Removed for inappropriate content",
    body: "Your camera showed content that isn't allowed, so it was turned off and you were removed. A moderator will review this.",
  },
};

type Session = {
  isModerator: boolean;
  title: string;
  capacity: number;
  identity: string;
  name: string;
};

function Classroom() {
  const { classId } = Route.useParams();
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          nav({ to: "/login", replace: true });
          return;
        }
        const value = await authorizeClassroom({ data: { classId, accessToken: token } });
        if (!stopped) setSession(value);
      } catch (e) {
        if (!stopped)
          setAuthError(e instanceof Error ? e.message : "Could not join this classroom.");
      }
    })();
    return () => {
      stopped = true;
    };
  }, [classId, nav]);

  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth
      .getSession()
      .then(({ data }) => setToken(data.session?.access_token ?? null));
  }, []);

  // Paging: only the people on the current page are received and shown.
  const [page, setPage] = useState(0);
  const [peerOrder, setPeerOrder] = useState<string[]>([]);
  const perPage = PAGE_SIZE - 1; // your own tile is on every page
  const pageCount = Math.max(1, Math.ceil(peerOrder.length / perPage));
  const safePage = Math.min(page, pageCount - 1);
  const visibleIds = useMemo(
    () => peerOrder.slice(safePage * perPage, safePage * perPage + perPage),
    [peerOrder, safePage, perPage],
  );

  const live = useCloudflareRealtime({
    classId: session ? classId : null,
    accessToken: session ? token : null,
    identity: session?.identity ?? null,
    name: session?.name ?? "Student",
    onDisconnected: () => nav({ to: "/home" }),
    visibleIds,
  });

  // A stable order (by name), so pages don't reshuffle as people join.
  const sortedPeers = useMemo(
    () =>
      [...live.peers].sort(
        (a, b) => a.name.localeCompare(b.name) || a.identity.localeCompare(b.identity),
      ),
    [live.peers],
  );
  const orderKey = sortedPeers.map((p) => p.identity).join(",");
  useEffect(() => {
    setPeerOrder(orderKey ? orderKey.split(",") : []);
  }, [orderKey]);
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);
  const pagePeers = sortedPeers.filter((p) => visibleIds.includes(p.identity));

  // Camera moderation: away, phone, explicit content.
  const [removedFor, setRemovedFor] = useState<RemovalReason | null>(null);
  const { release: releaseSeat, localVideo } = live;
  const onRemove = useCallback(
    async (reason: RemovalReason) => {
      if (reason === "nsfw") localVideo?.stop(); // cut the feed first
      setRemovedFor(reason);
      const { data } = await supabase.auth.getUser();
      if (data.user && reason !== "away") {
        await supabase
          .from("reports")
          .insert({
            reporter_id: data.user.id,
            reported_user_id: data.user.id,
            reason: "other",
            notes:
              reason === "phone"
                ? "Auto-flagged: phone in view 3 times in a classroom"
                : "Auto-flagged by camera moderation: explicit content",
          })
          .then(
            () => undefined,
            () => undefined,
          );
      }
      await withdrawMessages(classId);
      await releaseSeat();
    },
    [classId, localVideo, releaseSeat],
  );
  const moderation = useCameraModeration({
    track: live.status === "connected" && !removedFor ? localVideo : null,
    awayCheck: true,
    onRemove: (r) => void onRemove(r),
  });

  // Tell people straight away when a phone is spotted.
  const lastIncident = useRef(0);
  useEffect(() => {
    if (moderation.phoneIncidents > lastIncident.current) {
      lastIncident.current = moderation.phoneIncidents;
      if (moderation.phoneIncidents < moderation.phoneIncidentsMax) {
        toast.warning("Put your phone away. Phones aren't allowed in classrooms.", {
          id: "phone-warning",
        });
      }
    }
  }, [moderation.phoneIncidents, moderation.phoneIncidentsMax]);

  // Chat/sessions panel: always beside the video on wide screens, a slide-over
  // on phones.
  const [panelOpen, setPanelOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  // Stepping into a private session frees the classroom seat first, so it does
  // not sit taken for the 75s lease timeout.
  const { release } = live;
  const enterSession = useCallback(
    async (sessionId: string) => {
      steppingIntoSession = classId;
      await release();
      nav({ to: "/session/$sessionId", params: { sessionId } });
    },
    [release, nav, classId],
  );

  if (removedFor) {
    const m = REMOVAL_MESSAGE[removedFor];
    return (
      <Failure
        title={m.title}
        message={m.body}
        removed={false}
        onHome={() => nav({ to: "/home" })}
      />
    );
  }
  const error = authError ?? live.error;
  if (error) {
    return <Failure message={error} removed={live.removed} onHome={() => nav({ to: "/home" })} />;
  }

  // Remove my messages first, while I still hold the seat, then leave.
  const leave = () => {
    void withdrawMessages(classId).then(() => live.leave());
  };
  const total = live.peers.length + 1;
  const connected = !!session && live.status === "connected";

  return (
    <div className="flex h-[100dvh] flex-col bg-room text-white">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <button
          onClick={leave}
          aria-label="Leave classroom"
          className="rounded-lg p-2 hover:bg-white/10"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <PathwaayMark className="h-8 w-8" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{session?.title ?? "Classroom"}</p>
          <p className="text-xs text-white/50">
            {live.status === "connected"
              ? `${total} ${total === 1 ? "person" : "people"} in the room`
              : "Connecting…"}
          </p>
        </div>
        <span className="ml-auto flex items-center gap-1 text-xs text-white/60">
          <Users className="h-4 w-4" />
          {total}/{session?.capacity ?? 30}
        </span>
      </header>

      {live.warningCount > 0 && (
        <Banner icon={<Video className="h-4 w-4" />}>
          Turn your camera back on to stay in this classroom. Warning {live.warningCount} of 3.
        </Banner>
      )}
      {moderation.awaySecondsLeft !== null && (
        <Banner icon={<UserX className="h-4 w-4" />}>
          We can't see you on camera. Come back into view, or you'll be removed in{" "}
          <span className="font-semibold tabular-nums">
            {Math.floor(moderation.awaySecondsLeft / 60)}:
            {String(moderation.awaySecondsLeft % 60).padStart(2, "0")}
          </span>
          .
        </Banner>
      )}
      {moderation.phoneInFrame && (
        <Banner icon={<Smartphone className="h-4 w-4" />} tone="danger">
          Phone in view ({moderation.phoneIncidents} of {moderation.phoneIncidentsMax}). Put it
          away. The third time removes you from the classroom.
        </Banner>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-h-0 flex-1 overflow-y-auto p-3">
          {!session || live.status === "connecting" ? (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <PathwaayMark className="mx-auto h-14 w-14 animate-pulse" />
                <p className="mt-4">Joining your classroom…</p>
                <p className="mt-1 text-sm text-white/50">
                  Allow camera access when your browser asks.
                </p>
              </div>
            </div>
          ) : (
            <>
              {pageCount > 1 && (
                <div className="mb-3 flex items-center justify-between gap-3 text-[13px] text-white/60">
                  <span>
                    Classmates {safePage * perPage + 1}–
                    {Math.min((safePage + 1) * perPage, sortedPeers.length)} of {sortedPeers.length}
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      aria-label="Previous classmates"
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-30"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <span className="min-w-[3.5rem] text-center tabular-nums">
                      {safePage + 1} / {pageCount}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={safePage >= pageCount - 1}
                      aria-label="Next classmates"
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-30"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4 2xl:grid-cols-5">
                <Tile name="You" track={live.localVideo} me />
                {pagePeers.map((p) => (
                  <Tile key={p.identity} name={p.name} track={p.video} />
                ))}
              </div>
            </>
          )}
        </main>

        <aside
          className={cn(
            "min-h-0 flex-col border-white/10 bg-room",
            "fixed inset-0 z-40 lg:static lg:z-auto lg:flex lg:w-[380px] lg:border-l",
            panelOpen ? "flex" : "hidden",
          )}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 lg:hidden">
            <span className="text-sm font-semibold">Classroom chat</span>
            <button
              onClick={() => setPanelOpen(false)}
              aria-label="Close chat"
              className="rounded-lg p-2 hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ClassroomPanel
              classId={classId}
              myUserId={session?.identity ?? null}
              accessToken={token}
              active={connected}
              visible={panelOpen || isWide()}
              onUnreadChange={setUnread}
              onEnterSession={enterSession}
            />
          </div>
        </aside>
      </div>

      <footer className="border-t border-white/10 p-3 text-center">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => setPanelOpen(true)}
            className="relative inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-3 text-sm font-semibold hover:bg-white/15 lg:hidden"
          >
            <MessageSquare className="h-5 w-5" />
            Chat & doubts
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-danger px-1.5 text-[11px] font-bold leading-5">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
          <button
            onClick={leave}
            className="inline-flex items-center gap-2 rounded-full bg-danger px-5 py-3 text-sm font-semibold"
          >
            <PhoneOff className="h-5 w-5" />
            Leave classroom
          </button>
        </div>
        <p className="mt-2 text-xs text-white/45">
          Your camera must stay on in the classroom. Ask doubts in the chat — helpers can take you
          into a private session with mic and camera.
        </p>
      </footer>
    </div>
  );
}

/** Matches Tailwind's lg breakpoint, where the panel is always shown. */
function isWide() {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
}

function Tile({
  name,
  track,
  me,
}: {
  name: string;
  track?: MediaStreamTrack | null;
  me?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = track ? new MediaStream([track]) : null;
    void ref.current?.play().catch(() => {});
  }, [track]);
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black/40 ring-1 ring-white/10">
      {track ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={me}
          className={cn("h-full w-full object-cover", me && "scale-x-[-1]")}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-white/60">
          <Video className="h-8 w-8" />
          <span className="text-xs">Connecting video…</span>
        </div>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-black/50 px-3 py-2 text-xs font-semibold">
        {name}
        {me && " (You)"}
      </span>
    </div>
  );
}

function Banner({
  icon,
  tone = "warn",
  children,
}: {
  icon: React.ReactNode;
  tone?: "warn" | "danger";
  children: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "mx-auto mt-3 flex w-[min(720px,calc(100%-24px))] items-start gap-2.5 rounded-lg px-4 py-3 text-[14px] ring-1",
        tone === "danger"
          ? "bg-danger/15 text-red-100 ring-danger/40"
          : "bg-doubt/15 text-amber-100 ring-doubt/40",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function Failure({
  title,
  message,
  removed,
  onHome,
}: {
  title?: string;
  message: string;
  removed: boolean;
  onHome: () => void;
}) {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-room px-6 text-center text-white">
      <div>
        <h1 className="text-lg font-bold">
          {title ?? (removed ? "Removed from classroom" : "Couldn't join the classroom")}
        </h1>
        <p className="mt-2 max-w-sm text-sm text-white/60">{message}</p>
        {removed && (
          <p className="mt-2 text-sm text-white/60">
            Your camera must remain ON to stay in this classroom.
          </p>
        )}
        <button
          onClick={onHome}
          className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Go home
        </button>
      </div>
    </div>
  );
}
