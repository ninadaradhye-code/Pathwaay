import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.6v3h3.86c2.26-2.08 3.58-5.15 3.58-8.63z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.9l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.3a7.2 7.2 0 0 1 0-4.6V6.61H1.29a12 12 0 0 0 0 10.78l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.7 0 3.99 2.47 1.29 6.61l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.36 12.77c.02 2.6 2.28 3.47 2.3 3.48-.02.06-.36 1.24-1.19 2.45-.72 1.05-1.47 2.1-2.65 2.12-1.16.02-1.53-.69-2.85-.69-1.32 0-1.73.67-2.83.71-1.14.04-2-1.13-2.73-2.18-1.48-2.15-2.61-6.07-1.09-8.72.75-1.31 2.1-2.15 3.57-2.17 1.11-.02 2.17.75 2.85.75.68 0 1.96-.93 3.31-.79.56.02 2.14.23 3.16 1.71-.08.05-1.88 1.1-1.86 3.33zM14.2 4.6c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.55 1.31-.56.65-1.05 1.68-.92 2.68.97.07 1.96-.49 2.57-1.23z" />
    </svg>
  );
}

export function SocialAuthButtons() {
  const [busy, setBusy] = useState<string | null>(null);

  // Goes straight to Supabase. This previously routed through Lovable's hosted
  // broker (oauth.lovable.app), which only works for apps deployed on Lovable —
  // so the buttons were dead anywhere else. Requires Google/Apple client
  // credentials to be set under Authentication > Providers in the Supabase
  // dashboard; without them the provider returns "missing OAuth secret".
  const signIn = async (provider: "google" | "apple") => {
    setBusy(provider);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // On success the browser is already navigating to the provider, so there is
    // nothing to do here — only reset state if we're staying on the page.
    if (error) {
      setBusy(null);
      toast.error(error.message || "Could not sign in. Please try again.");
    }
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => signIn("google")}
        disabled={busy !== null}
        className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-input bg-card py-2.5 text-[15px] font-medium text-foreground transition hover:bg-secondary disabled:opacity-60"
      >
        <GoogleIcon />
        {busy === "google" ? "Connecting…" : "Continue with Google"}
      </button>
      <button
        type="button"
        onClick={() => signIn("apple")}
        disabled={busy !== null}
        className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-foreground py-2.5 text-[15px] font-medium text-background transition hover:opacity-90 disabled:opacity-60"
      >
        <AppleIcon />
        {busy === "apple" ? "Connecting…" : "Continue with Apple"}
      </button>
    </div>
  );
}
