import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Crown,
  HandHelping,
  HelpCircle,
  Loader2,
  Lock,
  MessageSquare,
  Send,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  declinePrivateInvite,
  declinePrivateSession,
  startHelpSession,
} from "@/lib/private-sessions.functions";
import { PRIVATE_SESSION_MAX } from "@/lib/private-session";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  author_id: string;
  author_name: string;
  kind: "chat" | "doubt";
  body: string;
  resolved_at: string | null;
  created_at: string;
}

interface LiveSession {
  id: string;
  doubt_id: string | null;
  host_id: string;
  host_name: string;
  started_by: string;
  started_by_name: string;
  topic: string;
  created_at: string;
  /** People in it right now. */
  people: Array<{ user_id: string; name: string; is_host: boolean }>;
  /** Whether I may enter: host, the helper who started it, invited, or was already in. */
  admitted: boolean;
}

interface Invite {
  session_id: string;
  invited_by_name: string;
  topic: string;
  created_at: string;
}

// Safety-net re-sync. Live changes already arrive over realtime, so this only
// catches anything missed; more often just loads every student's connection.
const REFRESH_MS = 20000;
const MAX_MESSAGES = 200;
const MESSAGE_FIELDS = "id, author_id, author_name, kind, body, resolved_at, created_at";

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function friendly(e: unknown, fallback: string) {
  const msg =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : "";
  if (/row-level security/i.test(msg))
    return "You need to be connected to the classroom to do that.";
  // Code deployed before the chat / private session migrations ran.
  if (
    /classroom_messages|private_session|start_help_session|schema cache|does not exist/i.test(msg)
  ) {
    return "Chat and private sessions are still being set up. An administrator needs to apply the latest database migrations.";
  }
  return msg || fallback;
}

/**
 * The classroom's interaction column: chat and doubts, the live private
 * sessions (invite-only), and the prompts for help requests and invites.
 *
 * Messages belong to people who are here: when someone leaves the classroom
 * their messages are deleted, and this panel drops them as that happens.
 */
export function ClassroomPanel({
  classId,
  myUserId,
  accessToken,
  active,
  visible = true,
  onUnreadChange,
  onEnterSession,
}: {
  classId: string;
  myUserId: string | null;
  accessToken: string | null;
  /** True once the classroom video is connected (chat RLS needs the seat). */
  active: boolean;
  /** Whether the panel is on screen; unread counts only grow while hidden. */
  visible?: boolean;
  onUnreadChange?: (n: number) => void;
  onEnterSession: (sessionId: string) => Promise<void> | void;
}) {
  const [tab, setTab] = useState<"chat" | "sessions">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [draft, setDraft] = useState("");
  const [asDoubt, setAsDoubt] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const dismissed = useRef(new Set<string>());
  const [, forceRender] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const unread = useRef(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (visible && unread.current) {
      unread.current = 0;
      onUnreadChange?.(0);
    }
  }, [visible, onUnreadChange]);

  // ---------------------------------------------------------------- chat
  /**
   * Re-read the room's messages. Clears out anything deleted because its
   * author left, in case the realtime DELETE event was missed. Messages that
   * arrived while the request was in flight are kept.
   */
  const reloadMessages = useCallback(async () => {
    const startedAt = Date.now();
    const { data } = await supabase
      .from("classroom_messages")
      .select(MESSAGE_FIELDS)
      .eq("classroom_id", classId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!data) return;
    const fresh = (data as Message[]).reverse();
    const ids = new Set(fresh.map((m) => m.id));
    setMessages((prev) => [
      ...fresh,
      ...prev.filter((m) => !ids.has(m.id) && new Date(m.created_at).getTime() > startedAt - 3000),
    ]);
  }, [classId]);

  useEffect(() => {
    if (!active) return;
    const upsert = (row: Message) =>
      setMessages((prev) => {
        const i = prev.findIndex((m) => m.id === row.id);
        if (i >= 0) {
          const next = prev.slice();
          next[i] = row;
          return next;
        }
        return [...prev, row].slice(-MAX_MESSAGES);
      });

    const channel = supabase
      .channel(`classroom-chat:${classId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "classroom_messages",
          filter: `classroom_id=eq.${classId}`,
        },
        (payload) => {
          const row = payload.new as Message;
          upsert(row);
          if (row.author_id !== myUserId && !visibleRef.current) {
            unread.current += 1;
            onUnreadChange?.(unread.current);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "classroom_messages",
          filter: `classroom_id=eq.${classId}`,
        },
        (payload) => upsert(payload.new as Message),
      )
      // Someone left and their messages were deleted. Realtime cannot filter
      // DELETE events and only sends the id, so match on that.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "classroom_messages" },
        (payload) => {
          const id = (payload.old as { id?: string })?.id;
          if (id) setMessages((prev) => prev.filter((m) => m.id !== id));
        },
      )
      .subscribe();

    // Clear out people who left without saying so before showing anything.
    void supabase
      .rpc("sweep_classroom_messages", { _classroom_id: classId })
      .then(() => reloadMessages());

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [active, classId, myUserId, onUnreadChange, reloadMessages]);

  // Follow new messages unless the reader has scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, tab]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !myUserId || sending) return;
    setSending(true);
    const { error } = await supabase.from("classroom_messages").insert({
      classroom_id: classId,
      author_id: myUserId,
      kind: asDoubt ? "doubt" : "chat",
      body: body.slice(0, 1000),
    });
    setSending(false);
    if (error) {
      toast.error(friendly(error, "Message not sent."));
      return;
    }
    stickToBottom.current = true;
    setDraft("");
    if (asDoubt) {
      setAsDoubt(false);
      toast.success("Doubt posted — anyone who knows can press Help.");
    }
  };

  const markSolved = async (m: Message) => {
    const { error } = await supabase
      .from("classroom_messages")
      .update({ resolved_at: new Date().toISOString() })
      .eq("id", m.id);
    if (error) toast.error(friendly(error, "Could not mark it solved."));
  };

  // ---------------------------------------------------------------- sessions + invites
  const loadInvites = useCallback(async () => {
    if (!myUserId) return;
    const { data } = await supabase
      .from("private_session_invites")
      .select("session_id, invited_by_name, topic, created_at")
      .eq("invitee_id", myUserId)
      .eq("classroom_id", classId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setInvites(data ?? []);
  }, [classId, myUserId]);

  const loadSessions = useCallback(async () => {
    const { data: rows } = await supabase
      .from("private_sessions")
      .select("id, doubt_id, host_id, host_name, started_by, started_by_name, topic, created_at")
      .eq("classroom_id", classId)
      .eq("status", "live")
      .order("created_at", { ascending: false });
    const list = rows ?? [];
    let roster: Array<{
      session_id: string;
      user_id: string;
      name: string;
      is_host: boolean;
      status: string;
    }> = [];
    let invitedTo = new Set<string>();
    if (list.length) {
      const ids = list.map((s) => s.id);
      const [{ data: people }, { data: mine }] = await Promise.all([
        supabase
          .from("private_session_participants")
          .select("session_id, user_id, name, is_host, status")
          .in("session_id", ids),
        myUserId
          ? supabase
              .from("private_session_invites")
              .select("session_id")
              .eq("invitee_id", myUserId)
              .in("session_id", ids)
              .in("status", ["pending", "accepted"])
          : Promise.resolve({ data: [] as Array<{ session_id: string }> }),
      ]);
      roster = people ?? [];
      invitedTo = new Set((mine ?? []).map((i) => i.session_id));
    }
    setSessions(
      list.map((s) => {
        const rows = roster.filter((p) => p.session_id === s.id);
        const me = rows.find((p) => p.user_id === myUserId);
        return {
          ...s,
          people: rows.filter((p) => p.status === "joined"),
          admitted:
            s.host_id === myUserId ||
            s.started_by === myUserId ||
            me?.status === "joined" ||
            me?.status === "left" ||
            invitedTo.has(s.id),
        };
      }),
    );
  }, [classId, myUserId]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const refresh = async () => {
      if (stopped) return;
      await Promise.all([
        supabase.rpc("sweep_private_sessions"),
        supabase.rpc("sweep_classroom_messages", { _classroom_id: classId }),
      ]);
      if (stopped) return;
      await Promise.all([loadSessions(), loadInvites(), reloadMessages()]);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    const channel = supabase.channel(`classroom-sessions:${classId}:${crypto.randomUUID()}`).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "private_sessions",
        filter: `classroom_id=eq.${classId}`,
      },
      () => void loadSessions(),
    );
    if (myUserId) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "private_session_invites",
          filter: `invitee_id=eq.${myUserId}`,
        },
        () => {
          void loadInvites();
          void loadSessions();
        },
      );
    }
    channel.subscribe();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [active, classId, myUserId, loadSessions, loadInvites, reloadMessages]);

  const byDoubt = useMemo(() => {
    const m = new Map<string, LiveSession>();
    sessions.forEach((s) => s.doubt_id && m.set(s.doubt_id, s));
    return m;
  }, [sessions]);

  // What to ask me about, most important first: someone wants to help with my
  // doubt, then invites into other people's sessions.
  const helpRequest = sessions.find(
    (s) =>
      s.host_id === myUserId &&
      !s.people.some((p) => p.user_id === myUserId) &&
      !dismissed.current.has(`help:${s.id}`),
  );
  const incomingInvite = helpRequest
    ? undefined
    : invites.find((i) => !dismissed.current.has(`invite:${i.session_id}`));

  const dismiss = (key: string) => {
    dismissed.current.add(key);
    forceRender((n) => n + 1);
  };

  const enter = async (sessionId: string) => {
    setPending(sessionId);
    try {
      await onEnterSession(sessionId);
    } finally {
      setPending(null);
    }
  };

  const help = async (m: Message) => {
    const live = byDoubt.get(m.id);
    if (live) {
      if (live.admitted) return enter(live.id);
      toast(`${live.host_name}'s session is invite-only. They can invite you in.`);
      return;
    }
    if (!accessToken) return;
    setPending(m.id);
    try {
      const { sessionId } = await startHelpSession({ data: { doubtId: m.id, accessToken } });
      await onEnterSession(sessionId);
    } catch (e) {
      toast.error(friendly(e, "Could not start the private session."));
    } finally {
      setPending(null);
    }
  };

  const declineHelp = async (s: LiveSession) => {
    dismiss(`help:${s.id}`);
    if (!accessToken) return;
    try {
      await declinePrivateSession({ data: { sessionId: s.id, accessToken } });
      toast(`You turned down ${s.started_by_name}'s help.`);
    } catch (e) {
      toast.error(friendly(e, "Could not decline."));
    }
  };

  const declineInvite = async (i: Invite) => {
    dismiss(`invite:${i.session_id}`);
    if (!accessToken) return;
    try {
      await declinePrivateInvite({ data: { sessionId: i.session_id, accessToken } });
      setInvites((prev) => prev.filter((x) => x.session_id !== i.session_id));
    } catch (e) {
      toast.error(friendly(e, "Could not decline."));
    }
  };

  // ---------------------------------------------------------------- render
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-white/10 p-2">
        <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
          <MessageSquare className="h-4 w-4" /> Chat
        </TabButton>
        <TabButton active={tab === "sessions"} onClick={() => setTab("sessions")}>
          <Video className="h-4 w-4" /> Private sessions
          {sessions.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold leading-4">
              {sessions.length}
            </span>
          )}
        </TabButton>
      </div>

      {!active ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-white/50">
          Chat opens once you are connected to the classroom.
        </div>
      ) : tab === "chat" ? (
        <>
          <div
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
          >
            {messages.length === 0 && (
              <p className="py-10 text-center text-sm text-white/50">
                No messages yet. Say hi, or tick <b>Doubt</b> to ask a question. Messages disappear
                when the person who sent them leaves the classroom.
              </p>
            )}
            {messages.map((m) =>
              m.kind === "doubt" ? (
                <DoubtCard
                  key={m.id}
                  m={m}
                  mine={m.author_id === myUserId}
                  live={byDoubt.get(m.id)}
                  busy={pending === m.id || pending === byDoubt.get(m.id)?.id}
                  onHelp={() => void help(m)}
                  onSolved={() => void markSolved(m)}
                />
              ) : (
                <ChatBubble key={m.id} m={m} mine={m.author_id === myUserId} />
              ),
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="shrink-0 border-t border-white/10 p-2"
          >
            <div
              className={cn(
                "flex items-end gap-2 rounded-xl bg-white/5 p-1.5 ring-1",
                asDoubt ? "ring-doubt/60" : "ring-white/10",
              )}
            >
              <button
                type="button"
                onClick={() => setAsDoubt((v) => !v)}
                aria-pressed={asDoubt}
                title="Post as a doubt so others can offer help"
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-2 text-xs font-bold",
                  asDoubt ? "bg-doubt text-black" : "text-white/70 hover:bg-white/10",
                )}
              >
                <HelpCircle className="h-4 w-4" /> Doubt
              </button>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                maxLength={1000}
                placeholder={asDoubt ? "Describe your doubt…" : "Message the classroom…"}
                className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                aria-label={asDoubt ? "Ask doubt" : "Send message"}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{asDoubt ? "Ask" : "Send"}</span>
              </button>
            </div>
          </form>
        </>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {sessions.length === 0 ? (
            <p className="py-10 text-center text-sm text-white/50">
              No private sessions right now. When someone presses <b>Help</b> on a doubt, the
              session shows up here. Sessions are invite-only: the student who asked invites who
              joins.
            </p>
          ) : (
            sessions.map((s) => {
              const full = s.people.length >= PRIVATE_SESSION_MAX;
              const mineHost = s.host_id === myUserId;
              const others = s.people.filter((p) => !p.is_host);
              return (
                <div key={s.id} className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-white/55">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live now
                    {!s.admitted && (
                      <span className="inline-flex items-center gap-1 text-white/45">
                        <Lock className="h-3 w-3" /> Invite only
                      </span>
                    )}
                    <span className="ml-auto inline-flex items-center gap-1 tabular-nums">
                      <Users className="h-3.5 w-3.5" />
                      {s.people.length}/{PRIVATE_SESSION_MAX}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm font-semibold">{s.topic}</p>
                  <p className="mt-1 text-xs text-white/60">
                    <Crown className="mr-1 inline h-3 w-3 text-doubt" />
                    {s.host_name}'s doubt
                    {others.length > 0 && `, with ${others.map((p) => p.name).join(", ")}`}
                  </p>
                  {s.admitted ? (
                    <button
                      disabled={(full && !mineHost) || pending === s.id}
                      onClick={() => void enter(s.id)}
                      className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                    >
                      {pending === s.id && <Loader2 className="h-4 w-4 animate-spin" />}
                      {mineHost ? "Rejoin as host" : full ? "Session full" : "Join session"}
                    </button>
                  ) : (
                    <p className="mt-2.5 rounded-lg bg-white/5 py-2 text-center text-xs text-white/50">
                      Only people {s.host_name} invites can join.
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {helpRequest && (
        <Prompt
          icon={<HandHelping className="h-5 w-5" />}
          title={`${helpRequest.started_by_name} wants to help you`}
          topic={helpRequest.topic}
          note="A private video session with mic and camera. You are the host: only people you invite can join, and you can mute or remove anyone. Answer within about a minute or the request expires."
          accept="Join private session"
          decline="Not now"
          busy={pending === helpRequest.id}
          onLater={() => dismiss(`help:${helpRequest.id}`)}
          onDecline={() => void declineHelp(helpRequest)}
          onAccept={() => {
            dismiss(`help:${helpRequest.id}`);
            void enter(helpRequest.id);
          }}
        />
      )}

      {incomingInvite && (
        <Prompt
          icon={<UserPlus className="h-5 w-5" />}
          title={`${incomingInvite.invited_by_name} invited you to a private session`}
          topic={incomingInvite.topic}
          note="A private video session with mic and camera. The invite expires after 2 minutes."
          accept="Join"
          decline="Decline"
          busy={pending === incomingInvite.session_id}
          onLater={() => dismiss(`invite:${incomingInvite.session_id}`)}
          onDecline={() => void declineInvite(incomingInvite)}
          onAccept={() => {
            dismiss(`invite:${incomingInvite.session_id}`);
            void enter(incomingInvite.session_id);
          }}
        />
      )}
    </div>
  );
}

function Prompt({
  icon,
  title,
  topic,
  note,
  accept,
  decline,
  busy,
  onLater,
  onDecline,
  onAccept,
}: {
  icon: React.ReactNode;
  title: string;
  topic: string;
  note: string;
  accept: string;
  decline: string;
  busy: boolean;
  onLater: () => void;
  onDecline: () => void;
  onAccept: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-foreground shadow-elevated">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
            {icon}
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold">{title}</h2>
            <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">“{topic}”</p>
          </div>
          <button
            onClick={onLater}
            aria-label="Decide later"
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{note}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onDecline}
            className="rounded-lg px-4 py-2 text-sm font-semibold hover:bg-secondary"
          >
            {decline}
          </button>
          <button
            disabled={busy}
            onClick={onAccept}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Video className="h-4 w-4" /> {accept}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition",
        active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function ChatBubble({ m, mine }: { m: Message; mine: boolean }) {
  return (
    <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      {!mine && (
        <span className="mb-0.5 px-1 text-[11px] font-semibold text-white/60">{m.author_name}</span>
      )}
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
          mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-white/10",
        )}
      >
        {m.body}
      </div>
      <span className="mt-0.5 px-1 text-[10px] text-white/35">{time(m.created_at)}</span>
    </div>
  );
}

function DoubtCard({
  m,
  mine,
  live,
  busy,
  onHelp,
  onSolved,
}: {
  m: Message;
  mine: boolean;
  live?: LiveSession;
  busy: boolean;
  onHelp: () => void;
  onSolved: () => void;
}) {
  const solved = !!m.resolved_at;
  const full = !!live && live.people.length >= PRIVATE_SESSION_MAX;
  // With a live session, only people let in see a Join button; everyone else
  // sees that it is invite-only. Without one, anyone else can offer help.
  const showButton = live ? live.admitted : !mine;
  return (
    <div
      className={cn(
        "rounded-xl p-3 ring-1",
        solved ? "bg-success/10 ring-success/30" : "bg-doubt/10 ring-doubt/40",
      )}
    >
      <div className="flex items-center gap-2 text-[11px]">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-semibold",
            solved ? "bg-success/20 text-success" : "bg-doubt/25 text-doubt",
          )}
        >
          {solved ? "Solved" : "Doubt"}
        </span>
        <span className="truncate font-semibold text-white/80">{mine ? "You" : m.author_name}</span>
        <span className="ml-auto shrink-0 text-white/35">{time(m.created_at)}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{m.body}</p>

      {!solved && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {live && (
            <span className="inline-flex items-center gap-1 text-xs text-white/60">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              {live.people.length} {live.people.length === 1 ? "person" : "people"} in a private
              session
              {!live.admitted && (
                <span className="ml-1 inline-flex items-center gap-1 text-white/45">
                  <Lock className="inline h-3 w-3" /> invite only
                </span>
              )}
            </span>
          )}
          {!live && mine && (
            <span className="text-xs text-white/50">Waiting for someone to help…</span>
          )}
          <div className="ml-auto flex gap-2">
            {mine && (
              <button
                onClick={onSolved}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white/80 ring-1 ring-white/20 hover:bg-white/10"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Mark solved
              </button>
            )}
            {showButton && (
              <button
                onClick={onHelp}
                disabled={busy || (full && !mine)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50",
                  live ? "bg-primary text-primary-foreground" : "bg-success text-white",
                )}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : live ? (
                  <Video className="h-3.5 w-3.5" />
                ) : (
                  <HandHelping className="h-3.5 w-3.5" />
                )}
                {live ? (mine ? "Join as host" : full ? "Full" : "Join session") : "Help"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
