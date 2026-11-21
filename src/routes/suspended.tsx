import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PathwaayLogo } from "@/components/brand";

export const Route = createFileRoute("/suspended")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Suspended — Pathwaay" },
      {
        name: "description",
        content: "Your Pathwaay account is temporarily suspended after moderation review.",
      },
      { property: "og:title", content: "Suspended — Pathwaay" },
      {
        property: "og:description",
        content: "Your Pathwaay account is temporarily suspended after moderation review.",
      },
    ],
  }),
  component: Suspended,
});

function Suspended() {
  const nav = useNavigate();
  const [until, setUntil] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);

  // The page used to print a hardcoded date. Read the real one, and send people
  // back the moment it lapses rather than making them work out when to retry.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        nav({ to: "/login", replace: true });
        return;
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("suspended_until")
        .eq("id", data.user.id)
        .maybeSingle();
      if (cancelled) return;
      const end = prof?.suspended_until ? new Date(prof.suspended_until) : null;
      if (!end || end.getTime() <= Date.now()) {
        nav({ to: "/home", replace: true });
        return;
      }
      setUntil(end);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [nav]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (until && until.getTime() <= now) nav({ to: "/home", replace: true });
  }, [until, now, nav]);

  const remaining = until ? Math.max(0, until.getTime() - now) : 0;
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const hours = Math.floor(mins / 60);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <PathwaayLogo size="lg" tagline />

      <div className="mt-10 w-full max-w-md rounded-2xl border border-danger/40 bg-danger/5 p-8 text-center shadow-card">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-danger/10">
          <AlertTriangle className="h-8 w-8 text-danger" />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold text-danger">Temporarily suspended</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your camera showed content that isn't allowed in a classroom. You can rejoin when the
          timer runs out.
        </p>

        <div className="mt-6 rounded-xl bg-card px-6 py-5">
          <div className="text-[13px] font-medium text-muted-foreground">Time remaining</div>
          <div className="mt-1 text-4xl font-bold tabular-nums text-foreground">
            {hours > 0
              ? `${hours}h ${String(mins % 60).padStart(2, "0")}m`
              : `${mins}:${String(secs).padStart(2, "0")}`}
          </div>
        </div>

        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          You'll be taken back automatically. Repeated violations lead to longer suspensions.
        </p>
      </div>
    </div>
  );
}
