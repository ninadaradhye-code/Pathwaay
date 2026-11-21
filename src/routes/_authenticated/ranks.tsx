import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { Avatar, EmptyState, PageBody, PageHeader, Section } from "@/components/app-shell";
import { SuperstudentBadge } from "@/components/superstudent-badge";
import { supabase } from "@/integrations/supabase/client";
import { fetchLeaderboard, fetchMyStats, type LeaderRow, type MyStats } from "@/lib/social";
import { isSuperstudent, SUPERSTUDENT_EXPLAINER } from "@/lib/superstudent";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/ranks")({
  head: () => ({
    meta: [
      { title: "Rankings — Pathwaay" },
      {
        name: "description",
        content: "Live Pathwaay leaderboard — doubts solved and average session ratings out of 10.",
      },
      { property: "og:title", content: "Rankings — Pathwaay" },
      { property: "og:description", content: "See who solves the most doubts on Pathwaay." },
    ],
  }),
  component: Ranks,
});

function rating(avg: number, count: number) {
  return count > 0 ? Number(avg).toFixed(1) : null;
}

function Ranks() {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [stats, setStats] = useState<MyStats | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      try {
        const [board, mine] = await Promise.all([
          fetchLeaderboard(25),
          uid ? fetchMyStats(uid) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setMe(uid);
        setRows(board);
        setStats(mine);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    // Ranks move the instant someone is rated, so reflect that rather than
    // making people reload. session_ratings is on the realtime publication.
    const channel = supabase
      .channel(`ranks:session_ratings:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "session_ratings" }, () => {
        void load();
      })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, []);

  const myRating = stats ? rating(stats.avg_rating, stats.ratings_count) : null;
  const iAmSuper =
    !!stats && isSuperstudent(stats.rank, stats.solved, stats.avg_rating, stats.ratings_count);

  return (
    <>
      <PageHeader
        title="Rankings"
        description="Ranked by doubts the asker confirmed you solved, then by how they rated the session. Updates live."
      />
      <PageBody>
        {/* Your standing — the reason most people open this page. */}
        <section
          aria-label="Your standing"
          className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4"
        >
          <Figure label="Your rank" value={stats ? `#${stats.rank.toLocaleString()}` : "—"}>
            {iAmSuper && <SuperstudentBadge className="mt-1.5" />}
          </Figure>
          <Figure
            label="Doubts solved"
            value={String(stats?.solved ?? 0)}
            note="confirmed by the asker"
          />
          <Figure
            label="Average rating"
            value={myRating ? `${myRating}/10` : "—"}
            note={
              stats?.ratings_count
                ? `from ${stats.ratings_count} ${stats.ratings_count === 1 ? "session" : "sessions"}`
                : "help someone to get rated"
            }
          />
          <Figure label="Doubts asked" value={String(stats?.doubts_asked ?? 0)} />
        </section>

        <Section title="Top students" description={`Superstudents: ${SUPERSTUDENT_EXPLAINER}`}>
          {loading ? (
            <div className="space-y-px overflow-hidden rounded-xl border border-border bg-card">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="h-3 w-5 animate-pulse rounded bg-muted" />
                  <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
                  <div className="h-3 w-48 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon={Trophy} title="No one is ranked yet">
              Help someone with a doubt in a classroom. When they confirm it was solved and rate the
              session, you appear here.
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="hidden grid-cols-[3rem_1fr_7rem_7rem] gap-4 border-b border-border px-4 py-2.5 text-[12px] font-medium text-muted-foreground sm:grid">
                <span>Rank</span>
                <span>Student</span>
                <span className="text-right">Solved</span>
                <span className="text-right">Rating</span>
              </div>
              <ol>
                {rows.map((r, i) => {
                  const rank = i + 1;
                  const mine = r.user_id === me;
                  const score = rating(r.avg_rating, r.ratings_count);
                  return (
                    <li key={r.user_id} className="border-b border-border last:border-0">
                      <Link
                        to="/u/$userId"
                        params={{ userId: r.user_id }}
                        className={cn(
                          "grid grid-cols-[2.25rem_1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/60 sm:grid-cols-[3rem_1fr_7rem_7rem] sm:gap-4",
                          mine && "bg-accent/70 hover:bg-accent",
                        )}
                      >
                        <span
                          className={cn(
                            "text-[15px] tabular-nums",
                            rank <= 3 ? "font-bold text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {rank}
                        </span>
                        <span className="flex min-w-0 items-center gap-3">
                          <Avatar name={r.name} src={r.avatar_url} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[14px] font-semibold">
                                {r.name || "Student"}
                                {mine && (
                                  <span className="font-normal text-muted-foreground"> (you)</span>
                                )}
                              </span>
                              {isSuperstudent(rank, r.solved, r.avg_rating, r.ratings_count) && (
                                <SuperstudentBadge compact />
                              )}
                            </span>
                            <span className="block truncate text-[13px] text-muted-foreground">
                              {r.course || "Course not set"}
                            </span>
                          </span>
                        </span>
                        {/* Phones: both figures stacked on the right. */}
                        <span className="text-right text-[13px] sm:hidden">
                          <span className="block font-semibold tabular-nums">
                            {r.solved} solved
                          </span>
                          <span className="block text-muted-foreground">
                            {score ? `${score}/10` : "Unrated"}
                          </span>
                        </span>
                        <span className="hidden text-right text-[14px] font-semibold tabular-nums sm:block">
                          {r.solved}
                        </span>
                        <span className="hidden text-right text-[14px] text-muted-foreground sm:block">
                          {score ? `${score}/10` : "Unrated"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </Section>
      </PageBody>
    </>
  );
}

function Figure({
  label,
  value,
  note,
  children,
}: {
  label: string;
  value: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-border px-4 py-4 [&:not(:last-child)]:border-r max-sm:[&:nth-child(2)]:border-r-0 max-sm:[&:nth-child(-n+2)]:border-b">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[24px] font-bold leading-none">{value}</p>
      {note && <p className="mt-1.5 text-[12px] text-muted-foreground">{note}</p>}
      {children}
    </div>
  );
}
