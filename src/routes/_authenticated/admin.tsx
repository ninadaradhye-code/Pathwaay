import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  FileClock,
  Flag,
  LayoutDashboard,
  Loader2,
  MessageSquareWarning,
  Radio,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PathwaayMark, PathwaayWordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { OverviewSection, ReportsSection } from "@/components/admin/overview-reports";
import { PeopleSection, UserDrawer } from "@/components/admin/people";
import { AuditSection, ChatSection, LiveSection } from "@/components/admin/live-chat-audit";
import { adminApi } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  head: () => ({ meta: [{ title: "Moderation — Pathwaay" }] }),
  component: Admin,
});

type Section = "overview" | "reports" | "people" | "live" | "chat" | "audit";
const NAV: Array<{ id: Section; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "reports", label: "Reports", icon: Flag },
  { id: "people", label: "People", icon: Users },
  { id: "live", label: "Live", icon: Radio },
  { id: "chat", label: "Chat safety", icon: MessageSquareWarning },
  { id: "audit", label: "Audit log", icon: FileClock },
];

function Admin() {
  const nav = useNavigate();
  // Check the role directly rather than trusting app state that may still be
  // loading; the server checks again on every call regardless.
  const [access, setAccess] = useState<"checking" | "admin" | "moderator" | "denied">("checking");
  const [myId, setMyId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [openReports, setOpenReports] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      setMyId(uid);
      if (!uid) return setAccess("denied");
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      const r = new Set((roles ?? []).map((x) => x.role as string));
      setAccess(r.has("admin") ? "admin" : r.has("moderator") ? "moderator" : "denied");
    })();
  }, []);

  const refreshCounts = useCallback(() => {
    adminApi.overview().then(
      (o) => setOpenReports(o.open_reports),
      () => undefined,
    );
  }, []);
  useEffect(() => {
    if (access === "admin" || access === "moderator") refreshCounts();
  }, [access, refreshCounts]);

  const changed = useCallback(() => {
    refreshCounts();
    setRefreshKey((k) => k + 1);
  }, [refreshCounts]);

  if (access === "checking") {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (access === "denied") {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background px-6 text-center">
        <div className="max-w-sm">
          <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="mt-3 text-[20px] font-bold">This area is for moderators</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Your account doesn't have moderator or admin access.
          </p>
          <button
            onClick={() => nav({ to: "/home" })}
            className="mt-5 rounded-lg bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground"
          >
            Go home
          </button>
        </div>
      </div>
    );
  }

  const isAdmin = access === "admin";
  const go = (s: Section) => setSection(s);

  return (
    <div className="min-h-[100dvh] bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex items-center gap-2.5 px-5 pb-1 pt-6">
          <PathwaayMark className="h-8 w-8" />
          <PathwaayWordmark className="text-[13px]" />
        </div>
        <p className="px-5 pb-5 text-[12px] text-muted-foreground">
          Moderation console{isAdmin ? "" : " (moderator)"}
        </p>
        <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Console">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              aria-current={section === n.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[14px] font-medium transition-colors",
                section === n.id
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <n.icon
                className={cn("h-[18px] w-[18px]", section === n.id && "text-primary")}
                strokeWidth={1.9}
              />
              <span className="flex-1">{n.label}</span>
              {n.id === "reports" && !!openReports && (
                <span className="rounded-full bg-doubt px-1.5 text-[11px] font-bold leading-5 text-black tabular-nums">
                  {openReports}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="flex flex-col gap-2 border-t border-sidebar-border p-3">
          <Link
            to="/home"
            className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Pathwaay
          </Link>
          <ThemeToggle className="w-full justify-center" />
        </div>
      </aside>

      {/* Phones and tablets: a header with scrollable section tabs. */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Link
            to="/home"
            aria-label="Back to Pathwaay"
            className="rounded-lg p-1.5 hover:bg-secondary"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="text-[15px] font-semibold">Moderation</span>
          <span className="ml-auto">
            <ThemeToggle />
          </span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Console">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium",
                section === n.id ? "bg-secondary text-foreground" : "text-muted-foreground",
              )}
            >
              {n.label}
              {n.id === "reports" && !!openReports && (
                <span className="rounded-full bg-doubt px-1.5 text-[11px] font-bold text-black">
                  {openReports}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <main className="px-4 py-6 sm:px-6 lg:pl-[calc(15rem+2.5rem)] lg:pr-10 lg:pt-10">
        <div className="mx-auto max-w-6xl">
          {section === "overview" && <OverviewSection go={go} onOpenUser={setOpenUser} />}
          {section === "reports" && <ReportsSection onOpenUser={setOpenUser} onChange={changed} />}
          {section === "people" && (
            <PeopleSection onOpenUser={setOpenUser} refreshKey={refreshKey} />
          )}
          {section === "live" && <LiveSection onOpenUser={setOpenUser} onChange={changed} />}
          {section === "chat" && <ChatSection onOpenUser={setOpenUser} />}
          {section === "audit" && <AuditSection onOpenUser={setOpenUser} />}
        </div>
      </main>

      {openUser && (
        <UserDrawer
          userId={openUser}
          isAdmin={isAdmin}
          myId={myId}
          onClose={() => setOpenUser(null)}
          onChange={changed}
        />
      )}
    </div>
  );
}
