import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bot, ExternalLink, Search, X } from "lucide-react";
import { Avatar } from "@/components/app-shell";
import {
  actionLabel,
  adminApi,
  ago,
  REASON_LABEL,
  untilLabel,
  type UserDetail,
  type UserRow,
} from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import {
  ActionDialog,
  Badge,
  btn,
  Empty,
  ErrorNote,
  Loading,
  SectionTitle,
  SUSPEND_DURATIONS,
} from "./ui";

type Filter = "all" | "suspended" | "staff" | "flagged";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Everyone" },
  { id: "flagged", label: "Flagged" },
  { id: "suspended", label: "Suspended" },
  { id: "staff", label: "Staff" },
];

export function PeopleSection({
  onOpenUser,
  refreshKey,
}: {
  onOpenUser: (id: string) => void;
  refreshKey: number;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (append = false, offset = 0) => {
      if (!append) setRows(null);
      try {
        const page = await adminApi.users(q.trim(), filter, offset);
        setRows((prev) => (append && prev ? [...prev, ...page] : page));
        setMore(page.length === 50);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load students.");
      }
    },
    [q, filter],
  );

  // Search as you type, a moment after the last keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(t);
  }, [load, refreshKey]);

  return (
    <>
      <SectionTitle
        title="People"
        description="Every student and staff member. Open anyone to see their record and act on it."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email or college"
            className="w-full rounded-lg border border-input bg-card py-2 pl-9 pr-3 text-[14px] focus:border-primary focus:outline-none"
          />
        </label>
        <div className="flex rounded-lg border border-input bg-card p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-md px-3 py-1 text-[13px] font-medium",
                filter === f.id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote message={error} onRetry={() => void load()} />}
      {!rows && !error && <Loading rows={6} />}
      {rows && rows.length === 0 && (
        <Empty title="No one matches">Try a different name, email or filter.</Empty>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[1fr_12rem_9rem_5rem] gap-4 border-b border-border px-4 py-2.5 text-[12px] font-medium text-muted-foreground md:grid">
            <span>Student</span>
            <span>Course</span>
            <span>Status</span>
            <span className="text-right">Solved</span>
          </div>
          <ul className="divide-y divide-border">
            {rows.map((u) => {
              const susp = untilLabel(u.suspended_until);
              return (
                <li key={u.id}>
                  <button
                    onClick={() => onOpenUser(u.id)}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 text-left hover:bg-secondary/50 md:grid-cols-[1fr_12rem_9rem_5rem]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="relative">
                        <Avatar name={u.name ?? u.email} className="h-9 w-9" />
                        {u.online && (
                          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[14px] font-semibold">
                            {u.name ?? "No name yet"}
                          </span>
                          {u.roles.map((r) => (
                            <Badge key={r} tone="brand" className="capitalize">
                              {r}
                            </Badge>
                          ))}
                        </span>
                        <span className="block truncate text-[13px] text-muted-foreground">
                          {u.email}
                        </span>
                      </span>
                    </span>
                    <span className="hidden truncate text-[13px] text-muted-foreground md:block">
                      {[u.course, u.year].filter(Boolean).join(", ") || "Not set"}
                    </span>
                    <span className="flex flex-wrap justify-end gap-1 md:justify-start">
                      {susp ? (
                        <Badge tone="danger">
                          {susp.startsWith("Banned") ? "Banned" : "Suspended"}
                        </Badge>
                      ) : u.chat_strikes_10m >= 3 ? (
                        <Badge tone="attention">Muted</Badge>
                      ) : u.online ? (
                        <Badge tone="live">In a classroom</Badge>
                      ) : !u.onboarded ? (
                        <Badge>Not set up</Badge>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">Active</span>
                      )}
                      {u.reports_against > 0 && (
                        <Badge tone="attention">{u.reports_against} reports</Badge>
                      )}
                    </span>
                    <span className="hidden text-right text-[14px] tabular-nums md:block">
                      {u.solved}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {more && (
            <div className="border-t border-border p-3 text-center">
              <button onClick={() => void load(true, rows.length)} className={btn.secondary}>
                Show more
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- record drawer
type Dialog =
  | { kind: "suspend" }
  | { kind: "ban" }
  | { kind: "lift" }
  | { kind: "role"; role: "moderator" | "admin"; grant: boolean }
  | null;

export function UserDrawer({
  userId,
  isAdmin,
  myId,
  onClose,
  onChange,
}: {
  userId: string;
  isAdmin: boolean;
  myId: string | null;
  onClose: () => void;
  onChange: () => void;
}) {
  const [d, setD] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const load = useCallback(async () => {
    try {
      setD(await adminApi.user(userId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this student.");
    }
  }, [userId]);

  useEffect(() => {
    setD(null);
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !dialog && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dialog]);

  const done = (msg: string) => {
    toast.success(msg);
    setDialog(null);
    onChange();
    void load();
  };
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "That did not work.");

  const p = d?.profile;
  const name = p?.name || p?.email || "Student";
  const susp = untilLabel(p?.suspended_until);
  const isSelf = myId === userId;
  const muted =
    (d?.chat_strikes ?? []).filter((s) => Date.now() - new Date(s.created_at).getTime() < 600_000)
      .length >= 3;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-[560px] flex-col overflow-y-auto bg-background shadow-elevated"
        onClick={(e) => e.stopPropagation()}
        aria-label="Student record"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-5 py-3 backdrop-blur">
          <span className="text-[13px] font-medium text-muted-foreground">Student record</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 hover:bg-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {error && (
          <div className="p-5">
            <ErrorNote message={error} onRetry={() => void load()} />
          </div>
        )}
        {!d && !error && (
          <div className="p-5">
            <Loading rows={3} />
          </div>
        )}
        {d && p && (
          <div className="space-y-7 p-5">
            <section className="flex items-start gap-4">
              <Avatar name={name} src={p.avatar_url} className="h-14 w-14 text-lg" />
              <div className="min-w-0 flex-1">
                <h2 className="text-[20px] font-bold leading-tight">{name}</h2>
                <p className="text-[14px] text-muted-foreground">{p.email}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {[p.course, p.year && `${p.year} year`, p.college].filter(Boolean).join(", ") ||
                    "Profile not set up"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {d.roles.map((r) => (
                    <Badge key={r} tone="brand" className="capitalize">
                      {r}
                    </Badge>
                  ))}
                  {susp && <Badge tone="danger">{susp}</Badge>}
                  {muted && <Badge tone="attention">Muted in chat</Badge>}
                  {d.online_in && (
                    <Badge tone="live">
                      In {d.online_in.subject ?? "a classroom"}, room {d.online_in.room}
                    </Badge>
                  )}
                  <Badge>Joined {ago(p.created_at)}</Badge>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4">
              {[
                ["Doubts solved", d.stats.solved],
                ["Avg rating", d.stats.avg_rating ? `${d.stats.avg_rating}/10` : "—"],
                ["Help sessions", d.stats.sessions],
                ["Reports made", d.stats.reports_made],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="border-border px-3 py-3 [&:not(:last-child)]:border-r"
                >
                  <p className="text-[12px] text-muted-foreground">{label}</p>
                  <p className="mt-0.5 text-[20px] font-bold">{value}</p>
                </div>
              ))}
            </section>

            {!isSelf && (
              <section>
                <h3 className="mb-2 text-[14px] font-semibold">Actions</h3>
                <div className="flex flex-wrap gap-2">
                  {susp ? (
                    <button onClick={() => setDialog({ kind: "lift" })} className={btn.primary}>
                      Lift {susp === "Banned" ? "ban" : "suspension"}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => setDialog({ kind: "suspend" })}
                        className={btn.secondary}
                      >
                        Suspend
                      </button>
                      <button onClick={() => setDialog({ kind: "ban" })} className={btn.danger}>
                        Ban
                      </button>
                    </>
                  )}
                  {muted && (
                    <button
                      onClick={() =>
                        adminApi.unmute(userId).then(() => done(`${name} can chat again`), fail)
                      }
                      className={btn.secondary}
                    >
                      Unmute in chat
                    </button>
                  )}
                  {isAdmin &&
                    (["moderator", "admin"] as const).map((role) => {
                      const has = d.roles.includes(role);
                      return (
                        <button
                          key={role}
                          onClick={() => setDialog({ kind: "role", role, grant: !has })}
                          className={btn.ghost}
                        >
                          {has ? `Remove ${role}` : `Make ${role}`}
                        </button>
                      );
                    })}
                  <Link to="/u/$userId" params={{ userId }} className={btn.ghost}>
                    Public profile <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-[14px] font-semibold">Reports about {name.split(" ")[0]}</h3>
              {d.reports_against.length === 0 ? (
                <p className="text-[14px] text-muted-foreground">None.</p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {d.reports_against.map((r) => (
                    <li key={r.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-[13px]">
                        {r.automatic ? (
                          <Badge tone="brand">
                            <Bot className="h-3 w-3" /> Automatic
                          </Badge>
                        ) : (
                          <Badge tone="attention">{REASON_LABEL[r.reason] ?? r.reason}</Badge>
                        )}
                        <span className="text-muted-foreground">
                          {r.automatic ? "System" : (r.reporter_name ?? "A student")},{" "}
                          {ago(r.created_at)}
                        </span>
                        <span className="ml-auto text-muted-foreground">
                          {r.resolution ?? "Open"}
                        </span>
                      </div>
                      {r.notes && <p className="mt-1 text-[14px]">{r.notes}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-[14px] font-semibold">Blocked chat messages</h3>
              {d.chat_strikes.length === 0 ? (
                <p className="text-[14px] text-muted-foreground">None.</p>
              ) : (
                <p className="text-[14px] text-muted-foreground">
                  {d.chat_strikes.length} abusive{" "}
                  {d.chat_strikes.length === 1 ? "message" : "messages"} blocked, the latest{" "}
                  {ago(d.chat_strikes[0].created_at)}
                  {d.chat_strikes[0].subject ? ` in ${d.chat_strikes[0].subject}` : ""}.
                </p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-[14px] font-semibold">Moderation history</h3>
              {d.history.length === 0 ? (
                <p className="text-[14px] text-muted-foreground">No actions taken.</p>
              ) : (
                <ol className="space-y-3 border-l border-border pl-4">
                  {d.history.map((h, i) => (
                    <li key={i} className="text-[14px]">
                      <span className="font-medium">{actionLabel(h.action)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        by {h.actor_name ?? "the system"}, {ago(h.created_at)}
                      </span>
                      {typeof h.details?.note === "string" && h.details.note && (
                        <p className="mt-0.5 text-[13px] text-muted-foreground">
                          "{h.details.note}"
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </aside>

      {dialog?.kind === "suspend" && (
        <ActionDialog
          title={`Suspend ${name}?`}
          body="They can't use Pathwaay until it ends. It takes effect the next time they load a page."
          confirm="Suspend"
          tone="danger"
          durations={SUSPEND_DURATIONS}
          withNote
          onCancel={() => setDialog(null)}
          onConfirm={({ note, days }) =>
            adminApi
              .setSuspension(userId, new Date(Date.now() + (days ?? 1) * 86_400_000), note)
              .then(
                () => done(`${name} suspended for ${days} ${days === 1 ? "day" : "days"}`),
                fail,
              )
          }
        />
      )}
      {dialog?.kind === "ban" && (
        <ActionDialog
          title={`Ban ${name}?`}
          body="They can't use Pathwaay again unless an admin lifts the ban."
          confirm="Ban"
          tone="danger"
          withNote
          onCancel={() => setDialog(null)}
          onConfirm={({ note }) =>
            adminApi
              .setSuspension(userId, new Date(Date.now() + 100 * 365 * 86_400_000), note)
              .then(() => done(`${name} banned`), fail)
          }
        />
      )}
      {dialog?.kind === "lift" && (
        <ActionDialog
          title={`Let ${name} back in?`}
          confirm="Lift it"
          withNote
          onCancel={() => setDialog(null)}
          onConfirm={({ note }) =>
            adminApi
              .setSuspension(userId, null, note)
              .then(() => done(`${name} can use Pathwaay again`), fail)
          }
        />
      )}
      {dialog?.kind === "role" && (
        <ActionDialog
          title={
            dialog.grant
              ? `Make ${name} ${dialog.role === "admin" ? "an admin" : "a moderator"}?`
              : `Remove ${name}'s ${dialog.role} access?`
          }
          body={
            dialog.grant
              ? dialog.role === "admin"
                ? "Admins can do everything here, including making and removing other admins."
                : "Moderators can handle reports, suspend students, end sessions and manage chat. They can't change roles."
              : "They lose access to this console straight away."
          }
          confirm={dialog.grant ? "Confirm" : "Remove"}
          tone={dialog.grant ? "primary" : "danger"}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            adminApi
              .setRole(userId, dialog.role, dialog.grant)
              .then(
                () =>
                  done(
                    dialog.grant
                      ? `${name} is now ${dialog.role === "admin" ? "an admin" : "a moderator"}`
                      : `Removed ${dialog.role} access`,
                  ),
                fail,
              )
          }
        />
      )}
    </div>
  );
}
