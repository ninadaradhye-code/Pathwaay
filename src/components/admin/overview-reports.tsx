import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/app-shell";
import {
  adminApi,
  ago,
  REASON_LABEL,
  untilLabel,
  type LiveData,
  type Overview,
  type ReportAction,
  type ReportRow,
} from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import {
  ActionDialog,
  Badge,
  btn,
  Empty,
  ErrorNote,
  Figure,
  Figures,
  Loading,
  SectionTitle,
  SUSPEND_DURATIONS,
} from "./ui";

export type Go = (section: "reports" | "people" | "live" | "chat" | "audit") => void;

// ---------------------------------------------------------------- Overview
export function OverviewSection({ go, onOpenUser }: { go: Go; onOpenUser: (id: string) => void }) {
  const [o, setO] = useState<Overview | null>(null);
  const [live, setLive] = useState<LiveData | null>(null);
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ov, lv, rp] = await Promise.all([
        adminApi.overview(),
        adminApi.live(),
        adminApi.reports("open"),
      ]);
      setO(ov);
      setLive(lv);
      setReports(rp);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the overview.");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <>
      <SectionTitle
        title="Overview"
        description="What's happening on Pathwaay right now, and what needs a decision. Refreshes every 30 seconds."
      />
      {error && <ErrorNote message={error} onRetry={() => void load()} />}
      {!o && !error && <Loading rows={3} />}
      {o && (
        <>
          <h2 className="mb-2 text-[14px] font-semibold">Right now</h2>
          <Figures>
            <Figure
              label="Online in classrooms"
              value={o.online_now}
              tone={o.online_now ? "live" : undefined}
            />
            <Figure label="Classrooms in use" value={o.live_classrooms} />
            <Figure
              label="Private sessions"
              value={o.live_sessions}
              note={`${o.in_sessions} people inside`}
            />
            <Figure
              label="Open reports"
              value={o.open_reports}
              tone={o.open_reports ? "attention" : undefined}
            />
            <Figure
              label="Suspended"
              value={o.suspended_now}
              tone={o.suspended_now ? "danger" : undefined}
            />
            <Figure label="Muted in chat" value={o.muted_now} />
          </Figures>

          <h2 className="mb-2 mt-6 text-[14px] font-semibold">This week</h2>
          <Figures>
            <Figure label="Students" value={o.students_total} note="finished sign-up" />
            <Figure label="New students" value={o.signups_7d} />
            <Figure label="Help sessions" value={o.sessions_7d} />
            <Figure
              label="Doubts solved"
              value={o.solved_7d}
              note={`${o.ratings_7d} sessions rated`}
            />
            <Figure label="Automatic flags" value={o.auto_flags_24h} note="last 24 hours" />
            <Figure label="Reports open" value={o.open_reports} />
          </Figures>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[14px] font-semibold">Needs your decision</h2>
                <button onClick={() => go("reports")} className={btn.ghost}>
                  All reports <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              {reports && reports.length === 0 ? (
                <Empty title="Nothing waiting">No open reports. New ones appear here.</Empty>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {(reports ?? []).slice(0, 6).map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => (r.reported_id ? onOpenUser(r.reported_id) : go("reports"))}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/50"
                      >
                        <Avatar name={r.reported_name} className="h-8 w-8 text-[12px]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold">
                            {r.reported_name ?? "Unknown student"}
                          </span>
                          <span className="block truncate text-[13px] text-muted-foreground">
                            {r.notes || REASON_LABEL[r.reason] || r.reason}
                          </span>
                        </span>
                        {r.automatic ? (
                          <Badge tone="brand">
                            <Bot className="h-3 w-3" /> Automatic
                          </Badge>
                        ) : (
                          <Badge tone="attention">{REASON_LABEL[r.reason] ?? r.reason}</Badge>
                        )}
                        <span className="hidden w-20 shrink-0 text-right text-[12px] text-muted-foreground sm:block">
                          {ago(r.created_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[14px] font-semibold">Busiest classrooms</h2>
                <button onClick={() => go("live")} className={btn.ghost}>
                  Live view <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              {live && live.classrooms.length === 0 ? (
                <Empty title="No one is in a classroom">
                  Classrooms with students show up here live.
                </Empty>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {(live?.classrooms ?? []).slice(0, 6).map((c) => (
                    <li key={c.id} className="flex items-center gap-4 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold">
                          {c.subject ?? "Classroom"}, room {c.room_number}
                        </span>
                        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(100, (c.count / c.capacity) * 100)}%` }}
                          />
                        </span>
                      </span>
                      <span className="w-16 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">
                        {c.count}/{c.capacity}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Reports
type Pending = { report: ReportRow; action: ReportAction } | null;

export function ReportsSection({
  onOpenUser,
  onChange,
}: {
  onOpenUser: (id: string) => void;
  onChange: () => void;
}) {
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      setRows(await adminApi.reports(status));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load reports.");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (input: { note: string; days?: number }) => {
    if (!pending) return;
    try {
      await adminApi.resolveReport(pending.report.id, pending.action, input.days, input.note);
      toast.success(
        {
          dismiss: "Report dismissed",
          warn: "Marked as warned",
          suspend: `${pending.report.reported_name ?? "Student"} suspended for ${input.days} ${input.days === 1 ? "day" : "days"}`,
          ban: `${pending.report.reported_name ?? "Student"} banned`,
        }[pending.action],
      );
      setPending(null);
      onChange();
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    }
  };

  return (
    <>
      <SectionTitle
        title="Reports"
        description="Reports from students and automatic flags (phone, camera content, abusive chat). Suspending or banning closes every open report about that student."
        actions={
          <div className="flex rounded-lg border border-input bg-card p-0.5">
            {(["open", "resolved", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-md px-3 py-1 text-[13px] font-medium capitalize",
                  status === s
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        }
      />
      {error && <ErrorNote message={error} onRetry={() => void load()} />}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && (
        <Empty title={status === "open" ? "No open reports" : "No reports here"}>
          {status === "open"
            ? "Everything has been handled."
            : "Handled reports will be listed here."}
        </Empty>
      )}
      {rows && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((r) => {
            const status = untilLabel(r.reported_suspended_until);
            return (
              <li key={r.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <Avatar name={r.reported_name} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => r.reported_id && onOpenUser(r.reported_id)}
                        className="text-[15px] font-semibold hover:underline"
                      >
                        {r.reported_name ?? "Unknown student"}
                      </button>
                      {r.automatic ? (
                        <Badge tone="brand">
                          <Bot className="h-3 w-3" /> Automatic
                        </Badge>
                      ) : (
                        <Badge tone="attention">{REASON_LABEL[r.reason] ?? r.reason}</Badge>
                      )}
                      {r.reports_against > 1 && <Badge>{r.reports_against} reports in total</Badge>}
                      {status && <Badge tone="danger">{status}</Badge>}
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {r.automatic
                        ? "Flagged by the system"
                        : `Reported by ${r.reporter_name ?? "a student"}`}{" "}
                      {ago(r.created_at)}
                      {r.reported_email && <span className="block">{r.reported_email}</span>}
                    </p>
                    {r.notes && <p className="mt-2 text-[14px]">{r.notes}</p>}
                    {r.resolved_at && (
                      <p className="mt-2 text-[13px] text-muted-foreground">
                        Handled {ago(r.resolved_at)} by {r.resolver_name ?? "a moderator"}:{" "}
                        <span className="font-medium text-foreground">{r.resolution}</span>
                      </p>
                    )}
                  </div>
                </div>
                {!r.resolved_at && (
                  <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                    <button
                      onClick={() => setPending({ report: r, action: "dismiss" })}
                      className={btn.ghost}
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={() => setPending({ report: r, action: "warn" })}
                      className={btn.secondary}
                    >
                      Warn
                    </button>
                    {r.reported_id && (
                      <>
                        <button
                          onClick={() => setPending({ report: r, action: "suspend" })}
                          className={btn.secondary}
                        >
                          Suspend
                        </button>
                        <button
                          onClick={() => setPending({ report: r, action: "ban" })}
                          className={btn.danger}
                        >
                          Ban
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pending && (
        <ActionDialog
          title={
            {
              dismiss: "Dismiss this report?",
              warn: `Warn ${pending.report.reported_name ?? "this student"}?`,
              suspend: `Suspend ${pending.report.reported_name ?? "this student"}?`,
              ban: `Ban ${pending.report.reported_name ?? "this student"}?`,
            }[pending.action]
          }
          body={
            {
              dismiss: "No action is taken against the student. The report is closed.",
              warn: "The report is closed and the warning is recorded on their history. Tell them directly; Pathwaay has no in-app notifications yet.",
              suspend:
                "They can't use Pathwaay until it ends. It takes effect the next time they load a page.",
              ban: "They can't use Pathwaay again unless an admin lifts the ban. It takes effect the next time they load a page.",
            }[pending.action]
          }
          confirm={
            { dismiss: "Dismiss", warn: "Record warning", suspend: "Suspend", ban: "Ban" }[
              pending.action
            ]
          }
          tone={pending.action === "ban" || pending.action === "suspend" ? "danger" : "primary"}
          durations={pending.action === "suspend" ? SUSPEND_DURATIONS : undefined}
          withNote
          onCancel={() => setPending(null)}
          onConfirm={act}
        />
      )}
    </>
  );
}
