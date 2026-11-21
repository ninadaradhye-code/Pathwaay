import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // getSession() reads the persisted session and refreshes it locally;
    // getUser() always calls the server, so a slow or offline network logged
    // people out despite holding a perfectly valid token.
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      throw redirect({ to: "/login" });
    }
    const data = { user };
    // Suspension check
    const { data: prof } = await supabase
      .from("profiles")
      .select("suspended_until, onboarded_at")
      .eq("id", data.user.id)
      .maybeSingle();
    if (prof?.suspended_until && new Date(prof.suspended_until).getTime() > Date.now()) {
      throw redirect({ to: "/suspended" });
    }

    // Sign-up collects nothing but an email, so details are gathered on first
    // sign-in instead. Everything behind this guard assumes a real name exists.
    if (!prof?.onboarded_at) {
      throw redirect({ to: "/onboarding" });
    }

    return { user: data.user };
  },
  component: SignedInLayout,
});

// Video rooms, private sessions and the moderation console are full-screen;
// every other signed-in page sits in the shared shell (sidebar / bottom tabs).
const FULL_SCREEN = ["/classroom/", "/session/", "/room/", "/admin"];

function SignedInLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (FULL_SCREEN.some((p) => pathname.startsWith(p))) return <Outlet />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
