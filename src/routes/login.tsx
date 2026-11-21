import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SocialAuthButtons } from "@/components/social-auth";
import { PathwaayMark, PathwaayWordmark } from "@/components/brand";
import { DoubtDemo } from "@/components/doubt-demo";

export const Route = createFileRoute("/login")({
  ssr: false,
  // Already signed in? Don't make them sign in again.
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      throw redirect({ to: "/home" });
    }
  },
  head: () => ({
    meta: [
      { title: "Sign in — Pathwaay" },
      {
        name: "description",
        content: "Sign in to Pathwaay and solve doubts live with students on your course.",
      },
      { property: "og:title", content: "Sign in — Pathwaay" },
      {
        property: "og:description",
        content: "Sign in to Pathwaay and solve doubts live with students on your course.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  // One door for everyone. Supabase creates the account if the address is new,
  // and profile details are collected at /onboarding once they land.
  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
  };

  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-5 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-10">
        <Link to="/" className="flex w-fit items-center gap-2.5">
          <PathwaayMark className="h-8 w-8" />
          <PathwaayWordmark className="text-[13px]" />
        </Link>

        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-12">
          {sent ? (
            <div>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-primary">
                <MailCheck className="h-5 w-5" />
              </span>
              <h1 className="mt-5 text-[26px] font-bold leading-tight">Check your inbox</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                We sent a sign-in link to{" "}
                <span className="font-semibold text-foreground">{email.trim()}</span>. Open it on
                this device to continue. It can take a minute to arrive; check spam if it doesn't.
              </p>
              <button
                onClick={() => setSent(false)}
                className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-semibold text-primary hover:underline"
              >
                <ArrowLeft className="h-4 w-4" /> Use a different email
              </button>
            </div>
          ) : (
            <div>
              <h1 className="text-[26px] font-bold leading-tight">Sign in or create an account</h1>
              <p className="mt-2 text-[15px] text-muted-foreground">
                Enter your email and we'll send you a sign-in link. New here? The same link creates
                your account.
              </p>

              <form className="mt-8 space-y-3" onSubmit={sendLink}>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">Email</span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@college.edu"
                    className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-[15px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </label>
                <button
                  disabled={loading}
                  className="w-full rounded-lg bg-primary py-2.5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-brand-deep disabled:opacity-60"
                >
                  {loading ? "Sending link…" : "Email me a sign-in link"}
                </button>
              </form>

              <Divider />

              <SocialAuthButtons />
            </div>
          )}
        </div>
      </div>

      {/* The product, beside the form on large screens. */}
      <aside className="hidden flex-col justify-center bg-brand px-12 text-white lg:flex">
        <div className="mx-auto w-full max-w-[420px]">
          <p className="max-w-[30ch] text-[22px] font-semibold leading-snug">
            Post a doubt in your classroom, and the classmate who gets it helps you in a private
            session.
          </p>
          <DoubtDemo className="mt-10" />
        </div>
      </aside>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-foreground">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export function Divider() {
  return (
    <div className="my-6 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[13px] text-muted-foreground">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
