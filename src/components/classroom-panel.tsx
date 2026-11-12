import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Crown,
  HandHelping,
  HelpCircle,
  Loader2,
  MessageSquare,
  Send,
  Users,
  Video,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { declinePrivateSession, startHelpSession } from "@/lib/private-sessions.functions";
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
  people: Array<{ user_id: string; name: string; is_host: boolean }>;
}

const SESSION_POLL_MS = 8000;
const MAX_MESSAGES = 200;

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
  // Code deployed before 20261112090000_classroom_chat_and_private_sessions ran.
  if (
    /classroom_messages|private_session|start_help_session|schema cache|does not exist/i.test(msg)
  ) {
    return "Chat and private sessions are still being set up. An administrator needs to apply the latest database migration.";
  }
  return msg || fallback;
}

/**
 * The classroom's interaction column: chat and doubts, the live private
 * sessions anyone can join, and the help-request prompt for the asker.
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
  const [draft, setDraft] = useState("");
  const [asDoubt, setAsDoubt] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [invite, setInvite] = useState<LiveSession | null>(null);
  const dismissed = useRef(new Set<string>());
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
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

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
      .subscribe();

    void supabase
      .from("classroom_messages")
      .select("id, author_id, author_name, kind, body, resolved_at, created_at")
      .eq("classroom_id", classId)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setMessages((prev) => {
          const seen = new Set(data.map((m) => m.id));
          return [...(data as Message[]).reverse(), ...prev.filter((m) => !seen.has(m.id))];
        });
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [active, classId, myUserId, onUnreadChange]);

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

  // ---------------------------------------------------------------- sessions
  const loadSessions = useCallback(async () => {
    const { data: rows } = await supabase
      .from("private_sessions")
      .select("id, doubt_id, host_id, host_name, started_by, started_by_name, topic, created_at")
      .eq("classroom_id", classId)
      .eq("status", "live")
      .order("created_at", { ascending: false });
    const list = rows ?? [];
    let people: Array<{ session_id: string; user_id: string; name: string; is_host: boolean }> = [];
    if (list.length) {
      const { data } = await supabase
        .from("private_session_participants")
        .select("session_id, user_id, name, is_host")
        .in(
          "session_id",
          list.map((s) => s.id),
        )
        .eq("status", "joined");
      people = data ?? [];
    }
    const merged: LiveSession[] = list.map((s) => ({
      ...s,
      people: people.filter((p) => p.session_id === s.id),
    }));
    setSessions(merged);

    // A helper pressed Help on my doubt and I have not answered yet.
    const request = merged.find(
      (s) =>
        s.host_id === myUserId &&
        !s.people.some((p) => p.user_id === myUserId) &&
        !dismissed.current.has(s.id),
    );
    setInvite(request ?? null);
  }, [classId, myUserId]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const refresh = () => {
      if (stopped) return;
      void supabase.rpc("sweep_private_sessions").then(() => !stopped && void loadSessions());
    };
    refresh();
    const timer = window.setInterval(refresh, SESSION_POLL_MS);
    const channel = supabase
      .channel(`classroom-sessions:${classId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "private_sessions",
          filter: `classroom_id=eq.${classId}`,
        },
        () => void loadSessions(),
      )
      .subscribe();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [active, classId, loadSessions]);

  const byDoubt = useMemo(() => {
    const m = new Map<string, LiveSession>();
    sessions.forEach((s) => s.doubt_id && m.set(s.doubt_id, s));
    return m;
  }, [sessions]);

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
    if (live) return enter(live.id);
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

  const decline = async (s: LiveSession) => {
    dismissed.current.add(s.id);
    setInvite(null);
    if (!accessToken) return;
    try {
      await declinePrivateSession({ data: { sessionId: s.id, accessToken } });
      toast(`You turned down ${s.started_by_name}'s help.`);
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
                No messages yet. Say hi, or tick <b>Doubt</b> to ask a question.
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
                asDoubt ? "ring-brand-amber/60" : "ring-white/10",
              )}
            >
              <button
                type="button"
                onClick={() => setAsDoubt((v) => !v)}
                aria-pressed={asDoubt}
                title="Post as a doubt so others can offer help"
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-2 text-xs font-bold",
                  asDoubt ? "bg-brand-amber text-black" : "text-white/70 hover:bg-white/10",
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
              session shows up here and anyone can join it.
            </p>
          ) : (
            sessions.map((s) => {
              const full = s.people.length >= PRIVATE_SESSION_MAX;
              const mineHost = s.host_id === myUserId;
              return (
                <div key={s.id} className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-white/50">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
                    <span className="ml-auto inline-flex items-center gap-1 normal-case">
                      <Users className="h-3.5 w-3.5" />
                      {s.people.length}/{PRIVATE_SESSION_MAX}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm font-semibold">{s.topic}</p>
                  <p className="mt-1 text-xs text-white/60">
                    <Crown className="mr-1 inline h-3 w-3 text-brand-amber" />
                    {s.host_name}
                    {s.people.filter((p) => !p.is_host).length > 0 &&
                      ` · with ${s.people
                        .filter((p) => !p.is_host)
                        .map((p) => p.name)
                        .join(", ")}`}
                  </p>
                  <button
                    disabled={(full && !mineHost) || pending === s.id}
                    onClick={() => void enter(s.id)}
                    className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                  >
                    {pending === s.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    {mineHost ? "Rejoin as host" : full ? "Session full" : "Join session"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {invite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-foreground shadow-elevated">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                <HandHelping className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-bold">{invite.started_by_name} wants to help you</h2>
                <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">“{invite.topic}”</p>
              </div>
              <button
                onClick={() => {
                  dismissed.current.add(invite.id);
                  setInvite(null);
                }}
                aria-label="Decide later"
                className="ml-auto rounded p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              A private video session with mic and camera. You are the host: you can mute or remove
              anyone. Answer within about a minute or the request expires.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => void decline(invite)}
                className="rounded-lg px-4 py-2 text-sm font-semibold hover:bg-secondary"
              >
                Not now
              </button>
              <button
                disabled={pending === invite.id}
                onClick={() => {
                  const id = invite.id;
                  dismissed.current.add(id);
                  setInvite(null);
                  void enter(id);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                <Video className="h-4 w-4" /> Join private session
              </button>
            </div>
          </div>
        </div>
      )}
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
  return (
    <div
      className={cn(
        "rounded-xl p-3 ring-1",
        solved ? "bg-success/10 ring-success/30" : "bg-brand-amber/10 ring-brand-amber/40",
      )}
    >
      <div className="flex items-center gap-2 text-[11px]">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-bold uppercase tracking-wide",
            solved ? "bg-success/20 text-success" : "bg-brand-amber/25 text-brand-amber",
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
              In a private session · {live.people.length}{" "}
              {live.people.length === 1 ? "person" : "people"}
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
            {(live || !mine) && (
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
