import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Flag, AlertOctagon, PauseCircle, ScrollText } from "lucide-react";
import { usePlan } from "@/lib/plan-context";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Moderation Dashboard — Pathwaay" },
      {
        name: "description",
        content: "Review reports, suspensions and moderation activity across Pathwaay.",
      },
      { property: "og:title", content: "Moderation Dashboard — Pathwaay" },
      {
        property: "og:description",
        content: "Review reports, suspensions and moderation activity across Pathwaay.",
      },
    ],
  }),
  component: Admin,
});

const TABS = [
  { id: "reports", label: "Pending Reports", icon: Flag },
  { id: "suspended", label: "Suspended Users", icon: PauseCircle },
  { id: "log", label: "Moderation Log", icon: ScrollText },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface ReportRow {
  id: string;
  reporter_id: string;
  reported_user_id: string | null;
  reason: string;
  notes: string | null;
  created_at: string;
  reporter_name?: string;
  reported_name?: string;
}
interface SuspendedRow {
  id: string;
  name: string;
  email: string;
  suspended_until: string;
}
interface LogRow {
  id: string;
  actor_id: string;
  target_user_id: string | null;
  action: string;
  details: unknown;
  created_at: string;
  actor_name?: string;
  target_name?: string;
}

function Admin() {
  const { role } = usePlan();
  const nav = useNavigate();
  const [tab, setTab] = useState<TabId>("reports");
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [suspended, setSuspended] = useState<SuspendedRow[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (role !== "admin") {
      toast.error("Admin access required");
      nav({ to: "/home" });
    }
  }, [role, nav]);

  const load = async () => {
    setLoading(true);
    const [repRes, suspRes, logRes] = await Promise.all([
      supabase
        .from("reports")
        .select("id, reporter_id, reported_user_id, reason, notes, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("profiles")
        .select("id, name, email, suspended_until")
        .not("suspended_until", "is", null)
        .order("suspended_until", { ascending: false })
        .limit(50),
      supabase
        .from("moderation_log")
        .select("id, actor_id, target_user_id, action, details, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const rep = repRes.data ?? [];
    const lg = logRes.data ?? [];
    const ids = new Set<string>();
    rep.forEach((r) => {
      ids.add(r.reporter_id);
      if (r.reported_user_id) ids.add(r.reported_user_id);
    });
    lg.forEach((l) => {
      ids.add(l.actor_id);
      if (l.target_user_id) ids.add(l.target_user_id);
    });
    const nameMap: Record<string, string> = {};
    if (ids.size) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", Array.from(ids));
      (profs ?? []).forEach((p) => {
        nameMap[p.id] = p.name || "—";
      });
    }
    setReports(
      rep.map((r) => ({
        ...r,
        reporter_name: nameMap[r.reporter_id],
        reported_name: r.reported_user_id ? nameMap[r.reported_user_id] : "—",
      })),
    );
    setSuspended(
      (suspRes.data ?? []).filter(
        (p) => p.suspended_until && new Date(p.suspended_until).getTime() > Date.now(),
      ) as SuspendedRow[],
    );
    setLog(
      lg.map((l) => ({
        ...l,
        actor_name: nameMap[l.actor_id],
        target_name: l.target_user_id ? nameMap[l.target_user_id] : "—",
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    if (role === "admin") void load();
  }, [role]);

  if (role !== "admin") return null;

  const applyAction = async (
    report: ReportRow,
    action: "warn" | "susp1" | "susp7" | "ban" | "dismiss",
  ) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    let suspended_until: string | null | undefined;
    if (action === "susp1") suspended_until = new Date(Date.now() + 24 * 3600e3).toISOString();
    if (action === "susp7") suspended_until = new Date(Date.now() + 7 * 24 * 3600e3).toISOString();
    if (action === "ban") suspended_until = new Date(Date.now() + 365 * 24 * 3600e3).toISOString();

    if (report.reported_user_id && suspended_until !== undefined) {
      const { error } = await supabase
        .from("profiles")
        .update({ suspended_until })
        .eq("id", report.reported_user_id);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    const { error: logErr } = await supabase.from("moderation_log").insert({
      actor_id: userData.user.id,
      target_user_id: report.reported_user_id,
      action,
      details: { report_id: report.id, reason: report.reason },
    });
    if (logErr) {
      toast.error(logErr.message);
      return;
    }
    toast.success(`Action recorded: ${action}`);
    void load();
  };

  const lift = async (userId: string) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error } = await supabase
      .from("profiles")
      .update({ suspended_until: null })
      .eq("id", userId);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("moderation_log").insert({
      actor_id: userData.user.id,
      target_user_id: userId,
      action: "lift",
      details: {},
    });
    toast.success("Suspension lifted");
    void load();
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-60 shrink-0 bg-room text-white p-5">
        <div className="text-lg font-extrabold">PATHWAAY</div>
        <div className="mt-1 text-[12px] text-white/50">Admin Panel</div>
        <nav className="mt-6 space-y-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${tab === t.id ? "bg-primary text-primary-foreground" : "text-white/80 hover:bg-white/10"}`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 p-8">
        <h1 className="text-2xl font-extrabold">{TABS.find((t) => t.id === tab)?.label}</h1>
        {loading && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}

        {tab === "reports" && !loading && (
          <div className="mt-6 space-y-3">
            {reports.length === 0 && (
              <p className="text-sm text-muted-foreground">No pending reports.</p>
            )}
            {reports.map((r) => (
              <div key={r.id} className="rounded-2xl bg-card p-5 shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-warning px-2 py-0.5 text-[10px] font-bold text-white">
                    {r.reason}
                  </span>
                  <span className="text-sm font-semibold">{r.reporter_name}</span>
                  <span className="text-xs text-muted-foreground">reported</span>
                  <span className="text-sm font-semibold text-danger">{r.reported_name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>
                {r.notes && <p className="mt-2 text-sm text-muted-foreground">{r.notes}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Action color="bg-warning" label="Warn" onClick={() => applyAction(r, "warn")} />
                  <Action
                    color="bg-orange-500"
                    label="Suspend 24h"
                    onClick={() => applyAction(r, "susp1")}
                  />
                  <Action
                    color="bg-danger"
                    label="Suspend 7 days"
                    onClick={() => applyAction(r, "susp7")}
                  />
                  <Action color="bg-red-900" label="Ban" onClick={() => applyAction(r, "ban")} />
                  <Action
                    color="bg-secondary text-foreground"
                    label="Dismiss"
                    onClick={() => applyAction(r, "dismiss")}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "suspended" && !loading && (
          <div className="mt-6 space-y-3">
            {suspended.length === 0 && (
              <p className="text-sm text-muted-foreground">No suspended users.</p>
            )}
            {suspended.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-2xl bg-card p-4 shadow-card"
              >
                <div>
                  <div className="font-semibold">{s.name || s.email}</div>
                  <div className="text-xs text-muted-foreground">
                    Until {new Date(s.suspended_until).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => lift(s.id)}
                  className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold hover:bg-secondary/80"
                >
                  Lift Suspension Early
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === "log" && !loading && (
          <div className="mt-6 overflow-hidden rounded-2xl bg-card shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-[13px] font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Moderator</th>
                  <th className="px-4 py-2 text-left">Target</th>
                  <th className="px-4 py-2 text-left">Action</th>
                  <th className="px-4 py-2 text-left">Date</th>
                </tr>
              </thead>
              <tbody>
                {log.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-center text-muted-foreground">
                      No log entries.
                    </td>
                  </tr>
                )}
                {log.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-4 py-2">{l.actor_name}</td>
                    <td className="px-4 py-2">{l.target_name}</td>
                    <td className="px-4 py-2 font-semibold">{l.action}</td>
                    <td className="px-4 py-2">{new Date(l.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function Action({ color, label, onClick }: { color: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg ${color} px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90`}
    >
      {label}
    </button>
  );
}
