import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  Binary,
  Bot,
  BookOpen,
  Code2,
  Laptop,
  Layers,
  ShieldCheck,
  Terminal,
  Sigma,
  Atom,
  FlaskConical,
  Cpu,
  Building2,
  type LucideIcon,
} from "lucide-react";
import { usePlan } from "@/lib/plan-context";
import { EmptyState, LiveDot, PageBody, PageHeader, Section } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "Your Subjects — Pathwaay" },
      {
        name: "description",
        content: "Pick a subject and jump into a live classroom to ask or solve doubts.",
      },
      { property: "og:title", content: "Your Subjects — Pathwaay" },
      {
        property: "og:description",
        content: "Pick a subject and jump into a live classroom to ask or solve doubts.",
      },
    ],
  }),
  component: Home,
});

interface SubjectRow {
  slug: string;
  name: string;
  live: number;
}

// Icons are chosen by keyword, not by slug. With 572 real subjects across 24
// courses a per-slug map is unmaintainable, and the old one listed the seven
// placeholder subjects that no longer exist.
const ICON_RULES: Array<{ match: RegExp; icon: LucideIcon; className: string }> = [
  { match: /security|cyber|crypt/i, icon: ShieldCheck, className: "" },
  { match: /web|full.?stack|frontend/i, icon: Code2, className: "" },
  {
    match: /data structure|algorithm|discrete/i,
    icon: Binary,
    className: "",
  },
  {
    match: /artificial intelligence|machine learning|neural|\bai\b/i,
    icon: Bot,
    className: "",
  },
  {
    match: /operating system|linux|unix|network/i,
    icon: Terminal,
    className: "",
  },
  {
    match: /programming|software|compiler|python|java|\bc\+\+/i,
    icon: Laptop,
    className: "",
  },
  { match: /database|dbms|\bsql\b/i, icon: Layers, className: "" },
  { match: /math|calculus|algebra|statistic/i, icon: Sigma, className: "" },
  { match: /physic|mechanic|thermo|fluid/i, icon: Atom, className: "" },
  {
    match: /chemi|material|metallurg/i,
    icon: FlaskConical,
    className: "",
  },
  {
    match: /electr|circuit|signal|electronic/i,
    icon: Cpu,
    className: "",
  },
  {
    match: /civil|structur|survey|construct/i,
    icon: Building2,
    className: "",
  },
];

const FALLBACK = { icon: BookOpen, className: "" };

function iconFor(name: string) {
  return ICON_RULES.find((r) => r.match.test(name)) ?? FALLBACK;
}

function getIndianGreeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "hour")?.value,
  );

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function Home() {
  const { profile } = usePlan();
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  const firstName = profile?.name?.trim().split(" ")[0] || "there";
  const greeting = getIndianGreeting();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Only the subjects this student actually studies: their course, and the
      // two semesters of their year. Showing all 572 would be meaningless — a
      // Civil student has no business in a Quantum Computing room.
      const { data: me } = await supabase.auth.getUser();
      const uid = me.user?.id;
      if (!uid) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("course_slug, year")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;

      const yearNum = Math.max(1, parseInt(prof?.year ?? "1", 10) || 1);
      const { data: courseSubjects } = prof?.course_slug
        ? await supabase.rpc("get_course_subjects", {
            _course_slug: prof.course_slug,
            _year: yearNum,
          })
        : { data: null };
      if (cancelled) return;

      const subjectRows = courseSubjects ?? [];
      const { data: classrooms } = await supabase.from("classrooms").select("id, subject_slug");
      if (cancelled) return;

      // One presence query for the whole page rather than per subject.
      const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: presence } = await supabase
        .from("user_presence")
        .select("classroom_id")
        .gt("last_seen", since);
      if (cancelled) return;

      const roomToSubject = new Map((classrooms ?? []).map((c) => [c.id, c.subject_slug]));
      const liveBySubject = new Map<string, number>();
      for (const p of presence ?? []) {
        const slug = p.classroom_id ? roomToSubject.get(p.classroom_id) : null;
        if (slug) liveBySubject.set(slug, (liveBySubject.get(slug) ?? 0) + 1);
      }

      setSubjects(
        subjectRows.map((s) => ({
          slug: s.slug,
          name: s.name,
          live: liveBySubject.get(s.slug) ?? 0,
        })),
      );
      setLoading(false);
    };

    void load();

    // Live counts rather than waiting on the poll. The interval stays as a
    // backstop for a dropped socket, but at a much lower rate.
    const channel = supabase
      .channel("home:presence")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_presence" }, () => {
        void load();
      })
      .subscribe();

    const timer = window.setInterval(() => void load(), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, []);

  const totalLive = subjects.reduce((sum, s) => sum + s.live, 0);
  const courseLabel = profile?.course?.trim() || "your course";
  // One flat list. Semesters are an academic detail, not something a student
  // needs when picking a room, and a subject taught across both semesters of a
  // year is one classroom — showing it under two headings implied two rooms.

  const busiest = [...subjects].sort((a, b) => b.live - a.live)[0];

  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={
          totalLive > 0 ? (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <span className="inline-flex items-center gap-1.5 font-medium text-success">
                <LiveDot />
                {totalLive} {totalLive === 1 ? "classmate is" : "classmates are"} studying now
              </span>
              <span>in {courseLabel}.</span>
            </span>
          ) : (
            `Pick a subject to join its classroom. Ask a doubt there, or help someone with theirs.`
          )
        }
      />
      <PageBody>
        {loading ? (
          /* Same shape as the real tiles, so the page does not jump. */
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-[76px] animate-pulse rounded-xl border border-border bg-card"
              />
            ))}
          </div>
        ) : subjects.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No subjects for your year yet"
            action={
              <Link
                to="/settings"
                className="rounded-lg bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground hover:bg-brand-deep"
              >
                Check course and year
              </Link>
            }
          >
            Subjects come from your course and year. If those are wrong, fix them in your profile.
          </EmptyState>
        ) : (
          <Section
            title="Your subjects"
            description={`${subjects.length} subjects for ${courseLabel}${profile?.year ? `, ${profile.year}` : ""}`}
          >
            {busiest && busiest.live > 0 && (
              <Link
                to="/subject/$subject"
                params={{ subject: busiest.slug }}
                className="mb-4 flex items-center gap-4 rounded-xl border border-success/30 bg-success/[0.06] px-4 py-3.5 transition-colors hover:bg-success/10"
              >
                <LiveDot />
                <span className="min-w-0 flex-1 text-[14px]">
                  <span className="font-semibold">{busiest.name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    is the busiest room right now, with {busiest.live}{" "}
                    {busiest.live === 1 ? "student" : "students"}.
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-semibold text-success">Join them</span>
              </Link>
            )}
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {subjects.map((s) => {
                const { icon: Icon } = iconFor(s.name);
                return (
                  <li key={s.slug}>
                    <Link
                      to="/subject/$subject"
                      params={{ subject: s.slug }}
                      className="group flex h-full items-center gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-accent/40"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                        <Icon className="h-5 w-5" strokeWidth={1.9} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold leading-snug">
                          {s.name}
                        </span>
                        <span className="mt-0.5 block text-[13px]">
                          {s.live > 0 ? (
                            <span className="font-medium text-success">{s.live} studying now</span>
                          ) : (
                            <span className="text-muted-foreground">Quiet right now</span>
                          )}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
      </PageBody>
    </>
  );
}
