import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageSquare, PhoneOff, Users, Video, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PathwaayMark } from "@/components/brand";
import { ClassroomPanel } from "@/components/classroom-panel";
import { authorizeClassroom } from "@/lib/classroom-video.functions";
import { useCloudflareRealtime } from "@/lib/use-cloudflare-realtime";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/classroom/$classId")({
  ssr: false,
  component: Classroom,
});

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

  const live = useCloudflareRealtime({
    classId: session ? classId : null,
    accessToken: session ? token : null,
    identity: session?.identity ?? null,
    name: session?.name ?? "Student",
    onDisconnected: () => nav({ to: "/home" }),
  });

  // Chat/sessions panel: always beside the video on wide screens, a slide-over
  // on phones.
  const [panelOpen, setPanelOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  // Stepping into a private session frees the classroom seat first, so it does
  // not sit taken for the 75s lease timeout.
  const { release } = live;
  const enterSession = useCallback(
    async (sessionId: string) => {
      await release();
      nav({ to: "/session/$sessionId", params: { sessionId } });
    },
    [release, nav],
  );

  const error = authError ?? live.error;
  if (error) {
    return <Failure message={error} removed={live.removed} onHome={() => nav({ to: "/home" })} />;
  }

  const leave = () => void live.leave();
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
            {live.status === "connected" ? `Live · ${total} people` : "Connecting…"}
          </p>
        </div>
        <span className="ml-auto flex items-center gap-1 text-xs text-white/60">
          <Users className="h-4 w-4" />
          {total}/{session?.capacity ?? 30}
        </span>
      </header>

      {live.warningCount > 0 && (
        <div
          role="alert"
          className="mx-auto mt-3 w-[min(680px,calc(100%-24px))] rounded-lg border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-center text-sm text-amber-100"
        >
          Your camera must remain ON to stay in this classroom. Warning {live.warningCount} of 3.
        </div>
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
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
              <Tile name="You" track={live.localVideo} me />
              {live.peers.map((p) => (
                <Tile key={p.identity} name={p.name} track={p.video} />
              ))}
            </div>
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

function Failure({
  message,
  removed,
  onHome,
}: {
  message: string;
  removed: boolean;
  onHome: () => void;
}) {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-room px-6 text-center text-white">
      <div>
        <h1 className="text-lg font-bold">
          {removed ? "Removed from classroom" : "Couldn't join the classroom"}
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
