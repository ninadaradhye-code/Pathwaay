import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { toast } from "sonner";
import { Avatar, EmptyState, LiveDot, PageBody, PageHeader, Section } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { fetchFriends, respondToRequest, removeFriend, type FriendRow } from "@/lib/social";

export const Route = createFileRoute("/_authenticated/experts")({
  head: () => ({
    meta: [
      { title: "Friends — Pathwaay" },
      {
        name: "description",
        content:
          "See which of your Pathwaay friends are online and which classroom they are studying in right now.",
      },
      { property: "og:title", content: "Friends — Pathwaay" },
      {
        property: "og:description",
        content: "See which of your friends are live in a classroom right now.",
      },
    ],
  }),
  component: Friends,
});

const rowList = "divide-y divide-border overflow-hidden rounded-xl border border-border bg-card";

function Friends() {
  const [rows, setRows] = useState<FriendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    try {
      setRows(await fetchFriends(uid));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load friends");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [load]);

  const pending = useMemo(
    () => rows.filter((r) => r.status === "pending" && r.direction === "incoming"),
    [rows],
  );
  const sent = useMemo(
    () => rows.filter((r) => r.status === "pending" && r.direction === "outgoing"),
    [rows],
  );
  const accepted = useMemo(() => rows.filter((r) => r.status === "accepted"), [rows]);
  // Who is studying right now comes first: that is why people open this page.
  const friends = useMemo(
    () =>
      accepted
        .filter((r) => (r.name ?? "").toLowerCase().includes(q.trim().toLowerCase()))
        .sort(
          (a, b) =>
            Number(b.online) - Number(a.online) || (a.name ?? "").localeCompare(b.name ?? ""),
        ),
    [accepted, q],
  );
  const onlineCount = accepted.filter((r) => r.online).length;

  const respond = async (id: string, accept: boolean) => {
    try {
      await respondToRequest(id, accept);
      toast.success(accept ? "Friend request accepted" : "Request declined");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const remove = async (f: FriendRow) => {
    try {
      await removeFriend(f.friend_id);
      toast.success(`Removed ${f.name || "friend"}`);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  let description = "See which friends are studying, and join them in one tap.";
  if (!loading && accepted.length > 0) {
    description =
      onlineCount > 0
        ? `${onlineCount} of your ${accepted.length} friends ${onlineCount === 1 ? "is" : "are"} studying right now.`
        : `None of your ${accepted.length} friends are in a classroom right now.`;
  }

  return (
    <>
      <PageHeader title="Friends" description={description} />
      <PageBody>
        {pending.length > 0 && (
          <Section
            title="Needs your answer"
            description={`${pending.length} friend ${pending.length === 1 ? "request" : "requests"}`}
          >
            <ul className={rowList}>
              {pending.map((p) => (
                <li key={p.friend_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar name={p.name} src={p.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{p.name || "Student"}</p>
                    <p className="truncate text-[13px] text-muted-foreground">
                      {[p.course, p.college].filter(Boolean).join(", ") || "Wants to be friends"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void respond(p.friend_id, false)}
                      className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-secondary"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => void respond(p.friend_id, true)}
                      className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground hover:bg-brand-deep"
                    >
                      Accept
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section
          title="Your friends"
          actions={
            accepted.length > 6 ? (
              <label className="relative block w-full max-w-[240px]">
                <span className="sr-only">Search friends</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name"
                  className="w-full rounded-lg border border-input bg-card py-1.5 pl-8 pr-3 text-[13px] focus:border-primary focus:outline-none"
                />
              </label>
            ) : undefined
          }
        >
          {loading ? (
            <div className={rowList}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
                  <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : accepted.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No friends yet"
              action={
                <Link
                  to="/home"
                  className="rounded-lg bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground hover:bg-brand-deep"
                >
                  Find a classroom
                </Link>
              }
            >
              Add classmates from their profile after you meet them in a classroom. Once they
              accept, you can see when they are studying and join them.
            </EmptyState>
          ) : friends.length === 0 ? (
            <p className="py-8 text-center text-[14px] text-muted-foreground">
              No friend matches "{q}".
            </p>
          ) : (
            <ul className={rowList}>
              {friends.map((f) => (
                <li key={f.friend_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Link
                    to="/u/$userId"
                    params={{ userId: f.friend_id }}
                    className="group flex min-w-0 flex-1 items-center gap-3"
                  >
                    <span className="relative">
                      <Avatar name={f.name} src={f.avatar_url} />
                      {f.online && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold group-hover:underline">
                        {f.name || "Student"}
                      </span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {f.online && f.subject_name ? (
                          <span className="inline-flex items-center gap-1.5 text-success">
                            <LiveDot />
                            Studying {f.subject_name}
                            {f.room_number ? `, room ${f.room_number}` : ""}
                          </span>
                        ) : (
                          [f.course, f.year].filter(Boolean).join(", ") || f.college || "Offline"
                        )}
                      </span>
                    </span>
                  </Link>
                  <div className="flex items-center gap-1">
                    {f.online && f.classroom_id && (
                      <Link
                        to="/classroom/$classId"
                        params={{ classId: f.classroom_id }}
                        className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground hover:bg-brand-deep"
                      >
                        Join
                      </Link>
                    )}
                    <button
                      onClick={() => void remove(f)}
                      className="rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {sent.length > 0 && (
          <Section title="Waiting for them to accept">
            <ul className={rowList}>
              {sent.map((r) => (
                <li key={r.friend_id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={r.name} src={r.avatar_url} />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                    {r.name || "Student"}
                  </span>
                  <span className="text-[13px] text-muted-foreground">Request sent</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </PageBody>
    </>
  );
}
