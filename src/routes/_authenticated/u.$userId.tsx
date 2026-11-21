import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, MapPin, GraduationCap, UserPlus, Check, Clock, UserRound } from "lucide-react";
import { Avatar, EmptyState, PageBody, PageHeader } from "@/components/app-shell";
import { SuperstudentBadge } from "@/components/superstudent-badge";
import { isSuperstudent, SUPERSTUDENT_EXPLAINER } from "@/lib/superstudent";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { sendFriendRequest, respondToRequest, fetchMyStats, type MyStats } from "@/lib/social";

export const Route = createFileRoute("/_authenticated/u/$userId")({
  head: () => ({
    meta: [
      { title: "Student Profile — Pathwaay" },
      {
        name: "description",
        content: "View a Pathwaay student's college, course, doubts solved and average rating.",
      },
      { property: "og:title", content: "Student Profile — Pathwaay" },
      {
        property: "og:description",
        content: "View a Pathwaay student's college, course, doubts solved and average rating.",
      },
    ],
  }),
  component: PublicProfile,
});

interface PublicProfileData {
  id: string;
  name: string | null;
  avatar_url: string | null;
  college: string | null;
  course: string | null;
  year: string | null;
}

function PublicProfile() {
  const { userId } = Route.useParams();
  const nav = useNavigate();
  const [profile, setProfile] = useState<PublicProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [stats, setStats] = useState<MyStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyStats(userId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // What relationship we already have with this person, so the action button
  // can show the truth instead of always offering "Add Friend".
  const [friendState, setFriendState] = useState<
    "none" | "outgoing" | "incoming" | "accepted" | "self"
  >("none");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: me } = await supabase.auth.getUser();
      const uid = me.user?.id;
      if (!uid || cancelled) return;
      if (uid === userId) {
        setFriendState("self");
        return;
      }
      const { data: row } = await supabase
        .from("friendships")
        .select("requester_id, addressee_id, status")
        .or(
          `and(requester_id.eq.${uid},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${uid})`,
        )
        .maybeSingle();
      if (cancelled) return;
      if (!row) {
        setFriendState("none");
      } else if (row.status === "accepted") {
        setFriendState("accepted");
      } else if (row.status === "pending") {
        setFriendState(row.requester_id === uid ? "outgoing" : "incoming");
      } else {
        setFriendState("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_public_profile", { _user_id: userId });
      if (cancelled) return;
      if (error || !data || (Array.isArray(data) && data.length === 0)) {
        setNotFound(true);
      } else {
        const row = Array.isArray(data) ? data[0] : data;
        setProfile(row as PublicProfileData);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const displayName = profile?.name?.trim() || "Student";
  const superstudent =
    !!stats && isSuperstudent(stats.rank, stats.solved, stats.avg_rating, stats.ratings_count);

  const addFriend = async () => {
    try {
      const msg = await sendFriendRequest(userId);
      setFriendState("outgoing");
      toast.success(msg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send request");
    }
  };
  const accept = async () => {
    try {
      await respondToRequest(userId, true);
      setFriendState("accepted");
      toast.success("Friend request accepted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept");
    }
  };

  // The button reflects the real relationship rather than always offering "Add".
  const friendAction =
    friendState === "self" ? (
      <Link
        to="/settings"
        className="rounded-lg border border-input bg-card px-4 py-2 text-[14px] font-medium hover:bg-secondary"
      >
        Edit profile
      </Link>
    ) : friendState === "accepted" ? (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-[14px] font-medium text-muted-foreground">
        <Check className="h-4 w-4 text-success" /> Friends
      </span>
    ) : friendState === "outgoing" ? (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-[14px] font-medium text-muted-foreground">
        <Clock className="h-4 w-4" /> Request sent
      </span>
    ) : friendState === "incoming" ? (
      <button
        onClick={() => void accept()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground hover:bg-brand-deep"
      >
        <Check className="h-4 w-4" /> Accept friend request
      </button>
    ) : (
      <button
        onClick={() => void addFriend()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground hover:bg-brand-deep"
      >
        <UserPlus className="h-4 w-4" /> Add friend
      </button>
    );

  const back = (
    <button
      onClick={() => (window.history.length > 1 ? window.history.back() : nav({ to: "/experts" }))}
      className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back
    </button>
  );

  if (loading) {
    return (
      <>
        <PageHeader
          back={back}
          title={<span className="inline-block h-7 w-48 animate-pulse rounded bg-muted" />}
        />
        <PageBody>
          <div className="h-24 animate-pulse rounded-xl border border-border bg-card" />
        </PageBody>
      </>
    );
  }

  if (notFound || !profile) {
    return (
      <>
        <PageHeader back={back} title="Profile not found" />
        <PageBody>
          <EmptyState
            icon={UserRound}
            title="This student isn't on Pathwaay any more"
            action={
              <Link
                to="/experts"
                className="rounded-lg bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground hover:bg-brand-deep"
              >
                Back to Friends
              </Link>
            }
          >
            They may have deleted their account.
          </EmptyState>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-4">
            <Avatar name={displayName} src={profile.avatar_url} className="h-14 w-14 text-lg" />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                {displayName}
                {superstudent && <SuperstudentBadge />}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] font-normal text-muted-foreground">
                {(profile.course || profile.year) && (
                  <span className="inline-flex items-center gap-1.5">
                    <GraduationCap className="h-4 w-4" />
                    {[profile.course, profile.year && `${profile.year} year`]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                )}
                {profile.college && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-4 w-4" /> {profile.college}
                  </span>
                )}
              </span>
            </span>
          </span>
        }
        actions={friendAction}
      />
      <PageBody>
        <section
          aria-label="Activity"
          className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4"
        >
          {/* Confirmed by the person who raised the doubt, not offers made. */}
          <StatBox label="Doubts solved" value={String(stats?.solved ?? 0)} />
          <StatBox
            label="Average rating"
            value={
              stats && stats.ratings_count > 0 ? `${Number(stats.avg_rating).toFixed(1)}/10` : "—"
            }
            note={stats?.ratings_count ? `from ${stats.ratings_count} sessions` : "Not rated yet"}
          />
          <StatBox label="Doubts asked" value={String(stats?.doubts_asked ?? 0)} />
          <StatBox label="Rank" value={stats?.rank ? `#${stats.rank.toLocaleString()}` : "—"} />
        </section>
        {superstudent && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Superstudent: {SUPERSTUDENT_EXPLAINER}
          </p>
        )}
      </PageBody>
    </>
  );
}

function StatBox({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-border px-4 py-4 [&:not(:last-child)]:border-r max-sm:[&:nth-child(2)]:border-r-0 max-sm:[&:nth-child(-n+2)]:border-b">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[24px] font-bold leading-none">{value}</p>
      {note && <p className="mt-1.5 text-[12px] text-muted-foreground">{note}</p>}
    </div>
  );
}
