import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, Lock, ShieldCheck } from "lucide-react";
import { PathwaayMark, PathwaayWordmark } from "@/components/brand";
import { DoubtDemo } from "@/components/doubt-demo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pathwaay — Be Limitless" },
      {
        name: "description",
        content:
          "Study in a live classroom with students on your course. Post a doubt, and someone who knows helps you in a private video session.",
      },
    ],
  }),
  component: Landing,
});

/** How a doubt gets solved. A real sequence, so it is numbered. */
const STEPS = [
  {
    title: "Join your subject's classroom",
    body: "Up to 30 students on your course, cameras on and mics off. A quiet room to study in, with people who are working on the same thing.",
  },
  {
    title: "Post your doubt in the chat",
    body: "Type the question you are stuck on. It stays up while you are in the room, and goes when you leave.",
  },
  {
    title: "Someone who knows presses Help",
    body: "You talk it through in a private session with mic and camera. You run it: invite others, mute, or remove anyone. Then rate how it went.",
  },
];

const SAFETY = [
  {
    icon: Camera,
    title: "Camera-on classrooms",
    body: "Everyone in a classroom is visible, which keeps rooms focused and honest.",
  },
  {
    icon: Lock,
    title: "Invite-only help sessions",
    body: "Only the student who asked decides who joins their private session.",
  },
  {
    icon: ShieldCheck,
    title: "Moderated",
    body: "Reports go to moderators, who can warn or suspend accounts.",
  },
];

function Landing() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      {/* The brand sheet is a wordmark on a deep blue plate, so the opening
       * screen is that plate — with the product running on it. */}
      <div className="bg-brand text-white">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <PathwaayMark className="h-8 w-8" />
            <PathwaayWordmark tone="onDark" className="text-[12px] sm:text-[13px]" />
          </Link>
          <Link
            to="/login"
            className="rounded-lg px-3.5 py-2 text-[14px] font-semibold text-white/90 transition-colors hover:bg-white/10 hover:text-white"
          >
            Sign in
          </Link>
        </nav>

        <header className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-12 sm:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h1 className="max-w-[15ch] text-[clamp(2.25rem,5.2vw,3.75rem)] font-bold leading-[1.04] tracking-[-0.025em]">
              Stuck on a doubt? Someone on your course already gets it.
            </h1>
            <p className="mt-6 max-w-[46ch] text-[17px] leading-relaxed text-white/80">
              Pathwaay puts you in a live classroom with students studying the same subject. Ask
              your doubt in the chat, and whoever knows the answer helps you in a private video
              session.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/signup"
                className="rounded-lg bg-white px-6 py-3 text-[15px] font-semibold text-brand transition-colors hover:bg-white/90"
              >
                Get started
              </Link>
              <Link
                to="/login"
                className="rounded-lg px-4 py-3 text-[15px] font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white"
              >
                I already have an account
              </Link>
            </div>
            <p className="mt-5 text-[13px] text-white/60">
              Free for students. Sign in with your email.
            </p>
          </div>
          <div className="flex justify-center lg:justify-end">
            <DoubtDemo />
          </div>
        </header>
      </div>

      <main className="mx-auto max-w-6xl px-5 sm:px-8">
        <section
          aria-labelledby="how"
          className="grid gap-10 py-16 md:py-24 lg:grid-cols-[1fr_2fr]"
        >
          <div>
            <h2 id="how" className="text-[26px] font-bold leading-tight">
              How a doubt gets solved
            </h2>
            <p className="mt-3 max-w-[34ch] text-[15px] text-muted-foreground">
              No forums and no waiting for a reply. The person who can help is in the room with you.
            </p>
          </div>
          <ol className="grid gap-8 sm:grid-cols-3 sm:gap-6">
            {STEPS.map((s, i) => (
              <li key={s.title} className="border-t-2 border-foreground pt-4">
                <span className="text-[13px] font-semibold tabular-nums text-muted-foreground">
                  Step {i + 1}
                </span>
                <h3 className="mt-1.5 text-[17px] font-semibold leading-snug">{s.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="safety" className="border-t border-border py-16 md:py-20">
          <h2 id="safety" className="text-[20px] font-bold">
            Built to stay focused and safe
          </h2>
          <ul className="mt-8 grid gap-8 sm:grid-cols-3">
            {SAFETY.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span>
                  <span className="block text-[15px] font-semibold">{title}</span>
                  <span className="mt-1 block text-[14px] leading-relaxed text-muted-foreground">
                    {body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-card px-6 py-8 ring-1 ring-border sm:flex-row sm:items-center sm:px-10">
          <div>
            <h2 className="text-[20px] font-bold">Your classmates are studying right now.</h2>
            <p className="mt-1 text-[15px] text-muted-foreground">
              Sign up with your email, pick your course, and join a classroom.
            </p>
          </div>
          <Link
            to="/signup"
            className="shrink-0 rounded-lg bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-brand-deep"
          >
            Get started
          </Link>
        </section>
      </main>

      <footer className="mx-auto mt-16 flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t border-border px-5 py-8 text-[13px] text-muted-foreground sm:px-8">
        <span className="flex items-center gap-2">
          <PathwaayMark className="h-6 w-6" />
          <PathwaayWordmark className="text-[11px]" />
        </span>
        <span>Peer-to-peer learning for college students.</span>
      </footer>
    </div>
  );
}
