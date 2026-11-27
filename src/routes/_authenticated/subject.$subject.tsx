import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, DoorOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureOpenClassrooms } from "@/lib/classrooms.functions";
import { EmptyState, LiveDot, PageBody, PageHeader, Section } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/subject/$subject")({
  head: ({ params }) => ({
    meta: [
      { title: `${prettify(params.subject)} — Pathwaay` },
      {
        name: "description",
        content: `Join a live ${prettify(params.subject)} classroom on Pathwaay and get your doubts solved by peers.`,
      },
      { property: "og:title", content: `${prettify(params.subject)} — Pathwaay` },
      {
        property: "og:description",
        content: `Live ${prettify(params.subject)} classrooms on Pathwaay.`,
      },
    ],
  }),
  component: SubjectPage,
});

function prettify(slug: string) {
  return slug
    .split("-")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

interface Classroom {
  id: string;
  room_number: number;
  capacity: number;
  is_verified: boolean;
  /** People in the room's seats right now. */
  used: number;
  /** People from this room who are in one of its private sessions. */
  inPrivate: number;
}

function SubjectPage() {
  const { subject } = Route.useParams();
  const [name, setName] = useState(prettify(subject));
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const classroomIdsRef = useRef<string[]>([]);

  useEffect(() => {
    classroomIdsRef.current = classrooms.map((c) => c.id);
  }, [classrooms]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Top up so there are always 3 joinable classrooms for this subject.
      try {
        await ensureOpenClassrooms({ data: { subject } });
      } catch {
        /* non-fatal: still show whatever rooms exist */
      }
      if (cancelled) return;

      const [subjRes, roomsRes] = await Promise.all([
        supabase.from("subjects").select("name").eq("slug", subject).maybeSingle(),
        supabase
          .from("classrooms")
          .select("id, room_number, capacity, is_verified")
          .eq("subject_slug", subject)
          .order("room_number"),
      ]);
      if (cancelled) return;
      if (subjRes.data?.name) setName(subjRes.data.name);
      const rooms = roomsRes.data ?? [];
      const ids = rooms.map((r) => r.id);
      // Live seats + private sessions, from the classroom video leases.
      const counts = new Map<string, { room: number; priv: number }>();
      if (ids.length) {
        const { data: live } = await supabase.rpc("get_live_headcounts", {
          _subject_slug: subject,
        });
        (live ?? []).forEach((r) =>
          counts.set(r.classroom_id, { room: Number(r.in_room), priv: Number(r.in_private) }),
        );
      }
      if (cancelled) return;
      setClassrooms(
        rooms.map((r) => ({
          id: r.id,
          room_number: r.room_number,
          capacity: r.capacity,
          is_verified: r.is_verified,
          used: Math.min(r.capacity, counts.get(r.id)?.room ?? 0),
          inPrivate: counts.get(r.id)?.priv ?? 0,
        })),
      );
      setLoading(false);
    };

    void load();
    // Counts come from heartbeats, so a short poll keeps them current without
    // a realtime subscription per visitor.
    const timer = window.setInterval(() => void load(), 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [subject]);

  const liveCount = classrooms.reduce((sum, c) => sum + c.used + c.inPrivate, 0);
  const privateCount = classrooms.reduce((sum, c) => sum + c.inPrivate, 0);

  // Always show every filled room, but never more than 3 joinable ones.
  const OPEN_LIMIT = 3;
  let openShown = 0;
  const visible = classrooms.filter((c) => {
    if (c.used >= c.capacity) return true;
    openShown += 1;
    return openShown <= OPEN_LIMIT;
  });

  return (
    <>
      <PageHeader
        back={
          <Link
            to="/home"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Your subjects
          </Link>
        }
        title={name}
        description={
          liveCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-success">
              <LiveDot />
              {liveCount} {liveCount === 1 ? "student" : "students"} studying now
              {privateCount > 0 && (
                <span className="font-normal text-muted-foreground">
                  , {privateCount} of them in private help sessions
                </span>
              )}
            </span>
          ) : (
            "Join a classroom to study alongside others. Ask doubts in its chat, and help with theirs."
          )
        }
      />
      <PageBody>
        <Section
          title="Classrooms"
          description="Camera on, mic off. Talking happens in private help sessions started from a doubt."
        >
          {loading ? (
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-4">
                  <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-1.5 flex-1 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState icon={DoorOpen} title="No classrooms yet">
              Rooms for this subject haven't been set up. Try again in a minute — new rooms open
              automatically.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {visible.map((c, i) => {
                const full = c.used >= c.capacity;
                const pct = Math.min(100, (c.used / c.capacity) * 100);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-4">
                    <div className="order-1 min-w-0 flex-1 sm:w-28 sm:flex-none">
                      <p className="text-[15px] font-semibold">Room {i + 1}</p>
                      <p className="text-[13px] text-muted-foreground">
                        {full
                          ? "Full"
                          : c.used + c.inPrivate === 0
                            ? "Empty"
                            : c.is_verified
                              ? "Verified host"
                              : "Open"}
                      </p>
                    </div>
                    <div className="order-3 min-w-[140px] basis-full sm:order-2 sm:basis-auto sm:flex-1">
                      <div className="flex items-baseline justify-between text-[13px]">
                        <span className="tabular-nums">
                          <span className="font-semibold text-foreground">{c.used}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            of {c.capacity} seats taken
                          </span>
                        </span>
                        {c.inPrivate > 0 && (
                          <span className="text-muted-foreground">
                            +{c.inPrivate} in private {c.inPrivate === 1 ? "session" : "sessions"}
                          </span>
                        )}
                      </div>
                      <div
                        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                        role="meter"
                        aria-valuemin={0}
                        aria-valuemax={c.capacity}
                        aria-valuenow={c.used}
                        aria-label={`Room ${i + 1} occupancy`}
                      >
                        <div
                          className={`h-full rounded-full ${full ? "bg-danger" : "bg-primary"}`}
                          style={{ width: `${Math.max(pct, c.used > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                    </div>
                    {full ? (
                      <span className="order-2 rounded-lg bg-muted px-4 py-2 text-center text-[13px] font-medium text-muted-foreground sm:order-3">
                        Room full
                      </span>
                    ) : (
                      // Classroom video runs on the Cloudflare Realtime SFU. The
                      // peer-to-peer room is still reachable at /room/$roomId.
                      <Link
                        to="/classroom/$classId"
                        params={{ classId: c.id }}
                        className="order-2 rounded-lg bg-primary px-4 py-2 text-center text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-brand-deep sm:order-3"
                      >
                        Join room
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </PageBody>
    </>
  );
}
