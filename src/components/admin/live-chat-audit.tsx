import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Crown, Plus, Search, Trash2 } from "lucide-react";
import { Avatar } from "@/components/app-shell";
import {
  actionLabel,
  adminApi,
  ago,
  type AuditRow,
  type BlockMatch,
  type ChatActivity,
  type LiveData,
} from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import { ActionDialog, Badge, btn, Empty, ErrorNote, Loading, SectionTitle } from "./ui";

// ---------------------------------------------------------------- Live
export function LiveSection({
  onOpenUser,
  onChange,
}: {
  onOpenUser: (id: string) => void;
  onChange: () => void;
}) {
  const [live, setLive] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState<LiveData["sessions"][number] | null>(null);

  const load = useCallback(async () => {
    try {
      setLive(await adminApi.live());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load live activity.");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(t);
  }, [load]);

  const people = (live?.classrooms ?? []).reduce((n, c) => n + c.count, 0);

  return (
    <>
      <SectionTitle
        title="Live"
        description={
          live
            ? `${people} ${people === 1 ? "student" : "students"} in ${live.classrooms.length} ${live.classrooms.length === 1 ? "classroom" : "classrooms"}, ${live.sessions.length} private ${live.sessions.length === 1 ? "session" : "sessions"}. Refreshes every 10 seconds.`
            : "Who is studying where, right now."
        }
      />
      {error && <ErrorNote message={error} onRetry={() => void load()} />}
      {!live && !error && <Loading rows={3} />}
      {live && (
        <div className="grid gap-8 xl:grid-cols-[3fr_2fr]">
          <section>
            <h2 className="mb-2 text-[14px] font-semibold">Classrooms</h2>
            {live.classrooms.length === 0 ? (
              <Empty title="No one is in a classroom" />
            ) : (
              <ul className="space-y-3">
                {live.classrooms.map((c) => (
                  <li key={c.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[15px] font-semibold">
                        {c.subject ?? "Classroom"}, room {c.room_number}
                      </p>
                      <span className="text-[13px] tabular-nums text-muted-foreground">
                        {c.count} of {c.capacity}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {c.people.map((p) => (
                        <button
                          key={p.user_id}
                          onClick={() => onOpenUser(p.user_id)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border py-0.5 pl-0.5 pr-2.5 text-[13px] hover:bg-secondary"
                          title={`Joined ${ago(p.since)}`}
                        >
                          <Avatar name={p.name} className="h-6 w-6 text-[10px]" />
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-[14px] font-semibold">Private sessions</h2>
            {live.sessions.length === 0 ? (
              <Empty title="No private sessions running" />
            ) : (
              <ul className="space-y-3">
                {live.sessions.map((s) => (
                  <li key={s.id} className="rounded-xl border border-border bg-card p-4">
                    <p className="text-[13px] text-muted-foreground">
                      {s.subject
                        ? `${s.subject}${s.room_number ? `, room ${s.room_number}` : ""}`
                        : "Private session"}
                      , started {ago(s.created_at)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[14px] font-medium">{s.topic}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {s.people.length === 0 && (
                        <span className="text-[13px] text-muted-foreground">
                          Waiting for {s.host_name} to accept
                        </span>
                      )}
                      {s.people.map((p) => (
                        <button
                          key={p.user_id}
                          onClick={() => onOpenUser(p.user_id)}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[13px] hover:bg-secondary"
                        >
                          {p.is_host && <Crown className="h-3 w-3 text-doubt" />}
                          {p.name}
                        </button>
                      ))}
                      <button
                        onClick={() => setEnding(s)}
                        className={cn(btn.ghost, "ml-auto text-danger hover:text-danger")}
                      >
                        End session
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {ending && (
        <ActionDialog
          title="End this private session?"
          body={`Everyone in it is sent back to the classroom. Started by ${ending.host_name}.`}
          confirm="End session"
          tone="danger"
          onCancel={() => setEnding(null)}
          onConfirm={() =>
            adminApi.endSession(ending.id).then(
              () => {
                toast.success("Session ended");
                setEnding(null);
                onChange();
                void load();
              },
              (e) => toast.error(e instanceof Error ? e.message : "That did not work."),
            )
          }
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- Chat safety
const MATCH_LABEL: Record<BlockMatch, string> = {
  word: "Whole word",
  prefix: "Start of word",
  any: "Anywhere",
};

export function ChatSection({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const [activity, setActivity] = useState<ChatActivity | null>(null);
  const [terms, setTerms] = useState<Array<{ term: string; match: BlockMatch }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTerm, setNewTerm] = useState("");
  const [newMatch, setNewMatch] = useState<BlockMatch>("word");
  const [find, setFind] = useState("");

  const load = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([adminApi.chat(), adminApi.blockedTerms()]);
      setActivity(a);
      setTerms(t);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load chat safety.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const t = newTerm.trim();
    if (!t) return;
    try {
      await adminApi.setBlockedTerm(t, newMatch);
      toast.success(`"${t}" is now blocked`);
      setNewTerm("");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add it.");
    }
  };

  const shown = useMemo(
    () => (terms ?? []).filter((t) => t.term.includes(find.trim().toLowerCase())),
    [terms, find],
  );

  return (
    <>
      <SectionTitle
        title="Chat safety"
        description="Abusive messages are refused before anyone sees them. Three in 10 minutes mutes the sender for 10 minutes and files an automatic report."
      />
      {error && <ErrorNote message={error} onRetry={() => void load()} />}
      {!activity && !error && <Loading rows={3} />}
      {activity && terms && (
        <div className="grid gap-8 xl:grid-cols-2">
          <div className="space-y-8">
            <section>
              <h2 className="mb-2 text-[14px] font-semibold">Muted right now</h2>
              {activity.muted.length === 0 ? (
                <Empty title="No one is muted" />
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {activity.muted.map((m) => (
                    <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                      <button
                        onClick={() => onOpenUser(m.user_id)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <Avatar name={m.name} className="h-8 w-8 text-[12px]" />
                        <span className="truncate text-[14px] font-semibold hover:underline">
                          {m.name}
                        </span>
                      </button>
                      <span className="text-[13px] text-muted-foreground">
                        until{" "}
                        {new Date(m.until).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <button
                        onClick={() =>
                          adminApi.unmute(m.user_id).then(
                            () => {
                              toast.success(`${m.name} can chat again`);
                              void load();
                            },
                            (e) =>
                              toast.error(e instanceof Error ? e.message : "That did not work."),
                          )
                        }
                        className={btn.secondary}
                      >
                        Unmute
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h2 className="mb-2 text-[14px] font-semibold">Recently blocked messages</h2>
              {activity.strikes.length === 0 ? (
                <Empty title="None yet">
                  Blocked messages are listed here (the text itself is never stored).
                </Empty>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {activity.strikes.slice(0, 30).map((s, i) => (
                    <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-[14px]">
                      <button
                        onClick={() => onOpenUser(s.user_id)}
                        className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                      >
                        {s.name}
                      </button>
                      <span className="truncate text-[13px] text-muted-foreground">
                        {s.subject
                          ? `${s.subject}${s.room_number ? `, room ${s.room_number}` : ""}`
                          : ""}
                      </span>
                      <span className="w-20 shrink-0 text-right text-[12px] text-muted-foreground">
                        {ago(s.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section>
            <h2 className="mb-1 text-[14px] font-semibold">Blocked words</h2>
            <p className="mb-3 text-[13px] text-muted-foreground">
              Spacing, repeated letters and number swaps are handled automatically ("f u c k",
              "fuuuck", "sh1t"). Use <b>Whole word</b> for short words so normal words aren't caught
              ("ass" vs "class").
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
              className="mb-3 flex flex-wrap gap-2"
            >
              <input
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                placeholder="Add a word or phrase"
                maxLength={60}
                className="min-w-0 flex-1 rounded-lg border border-input bg-card px-3 py-1.5 text-[14px] focus:border-primary focus:outline-none"
              />
              <select
                value={newMatch}
                onChange={(e) => setNewMatch(e.target.value as BlockMatch)}
                className="rounded-lg border border-input bg-card px-2 py-1.5 text-[13px]"
                aria-label="How it matches"
              >
                {(Object.keys(MATCH_LABEL) as BlockMatch[]).map((m) => (
                  <option key={m} value={m}>
                    {MATCH_LABEL[m]}
                  </option>
                ))}
              </select>
              <button className={btn.primary} disabled={!newTerm.trim()}>
                <Plus className="h-4 w-4" /> Block
              </button>
            </form>
            <label className="relative mb-2 block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder={`Search ${terms.length} blocked words`}
                className="w-full rounded-lg border border-input bg-card py-1.5 pl-8 pr-3 text-[13px] focus:border-primary focus:outline-none"
              />
            </label>
            <ul className="max-h-[420px] divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
              {shown.map((t) => (
                <li key={t.term} className="flex items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate text-[14px]">{t.term}</span>
                  <Badge>{MATCH_LABEL[t.match]}</Badge>
                  <button
                    onClick={() =>
                      adminApi.setBlockedTerm(t.term, t.match, true).then(
                        () => {
                          toast.success(`"${t.term}" is allowed again`);
                          void load();
                        },
                        (e) => toast.error(e instanceof Error ? e.message : "That did not work."),
                      )
                    }
                    aria-label={`Unblock ${t.term}`}
                    className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Audit log
const AUDIT_FILTERS = [
  ["", "All actions"],
  ["suspend", "Suspensions"],
  ["ban", "Bans"],
  ["unsuspend", "Lifted"],
  ["warn", "Warnings"],
  ["dismiss", "Dismissed"],
  ["end_private_session", "Ended sessions"],
  ["grant_admin", "Made admin"],
  ["grant_moderator", "Made moderator"],
] as const;

export function AuditSection({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  const [action, setAction] = useState("");
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      setRows(await adminApi.audit(action || undefined));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the audit log.");
    }
  }, [action]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <SectionTitle
        title="Audit log"
        description="Every moderation decision, who made it and when. Entries can't be edited or deleted."
        actions={
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="rounded-lg border border-input bg-card px-3 py-1.5 text-[13px]"
            aria-label="Filter by action"
          >
            {AUDIT_FILTERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        }
      />
      {error && <ErrorNote message={error} onRetry={() => void load()} />}
      {!rows && !error && <Loading rows={6} />}
      {rows && rows.length === 0 && <Empty title="Nothing logged yet" />}
      {rows && rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[9rem_1fr_10rem_10rem] gap-4 border-b border-border px-4 py-2.5 text-[12px] font-medium text-muted-foreground md:grid">
            <span>When</span>
            <span>What</span>
            <span>By</span>
            <span>Student</span>
          </div>
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const note = typeof r.details?.note === "string" ? r.details.note : null;
              const term = typeof r.details?.term === "string" ? r.details.term : null;
              const days = typeof r.details?.days === "number" ? r.details.days : null;
              return (
                <li
                  key={r.id}
                  className="grid gap-1 px-4 py-3 text-[14px] md:grid-cols-[9rem_1fr_10rem_10rem] md:gap-4"
                >
                  <span className="text-[13px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleString([], {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium">{actionLabel(r.action)}</span>
                    {days ? (
                      <span className="text-muted-foreground">
                        {" "}
                        for {days} {days === 1 ? "day" : "days"}
                      </span>
                    ) : null}
                    {term && <span className="text-muted-foreground"> "{term}"</span>}
                    {note && (
                      <span className="block text-[13px] text-muted-foreground">"{note}"</span>
                    )}
                  </span>
                  <span className="truncate text-[13px] md:text-[14px]">
                    {r.actor_name ?? "System"}
                  </span>
                  <span className="truncate">
                    {r.target_id ? (
                      <button onClick={() => onOpenUser(r.target_id!)} className="hover:underline">
                        {r.target_name ?? "Student"}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
