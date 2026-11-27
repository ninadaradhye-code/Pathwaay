-- Real headcounts.
--
-- Every count on the site (subject rooms, Home, friends "studying now", and the
-- logic that opens a new room when the others fill up) read user_presence. The
-- Cloudflare classroom never writes that table, so everything showed 0.
--
-- Counts now come from what is actually live:
--   - an active classroom seat (classroom_video_participants, heartbeat < 75s)
--   - a place in a live private session (heartbeat < 30s), counted under the
--     classroom the session was started from
-- A person in a private session has given their classroom seat back, so they
-- are reported separately: they count towards "studying now" but not towards
-- the 30 seats.
--
-- Depends on 20261112090000_classroom_chat_and_private_sessions.

-- Where each person is right now (one row per person). Internal.
CREATE OR REPLACE FUNCTION public.live_presence()
RETURNS TABLE (user_id uuid, classroom_id uuid, in_private boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (x.user_id) x.user_id, x.classroom_id, x.in_private
    FROM (
      SELECT sp.user_id, s.classroom_id, true AS in_private, 0 AS rank
        FROM public.private_session_participants sp
        JOIN public.private_sessions s ON s.id = sp.session_id
       WHERE sp.status = 'joined' AND s.status = 'live'
         AND sp.last_seen > now() - interval '30 seconds'
      UNION ALL
      SELECT c.user_id, c.classroom_id, false, 1
        FROM public.classroom_video_participants c
       WHERE c.status = 'active' AND c.last_seen > now() - interval '75 seconds'
    ) x
   ORDER BY x.user_id, x.rank;
$$;
REVOKE ALL ON FUNCTION public.live_presence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_presence() TO service_role;

-- Per classroom: people in its seats, and people in its private sessions.
CREATE OR REPLACE FUNCTION public.get_live_headcounts(_subject_slug text DEFAULT NULL)
RETURNS TABLE (classroom_id uuid, subject_slug text, in_room bigint, in_private bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.subject_slug,
         count(lp.user_id) FILTER (WHERE lp.in_private = false),
         count(lp.user_id) FILTER (WHERE lp.in_private = true)
    FROM public.classrooms c
    LEFT JOIN public.live_presence() lp ON lp.classroom_id = c.id
   WHERE _subject_slug IS NULL OR c.subject_slug = _subject_slug
   GROUP BY c.id, c.subject_slug;
$$;

-- Per subject, only subjects with someone studying (for Home).
CREATE OR REPLACE FUNCTION public.get_live_subject_headcounts()
RETURNS TABLE (subject_slug text, in_room bigint, in_private bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.subject_slug,
         count(*) FILTER (WHERE lp.in_private = false),
         count(*) FILTER (WHERE lp.in_private = true)
    FROM public.live_presence() lp
    JOIN public.classrooms c ON c.id = lp.classroom_id
   GROUP BY c.subject_slug;
$$;

REVOKE ALL ON FUNCTION public.get_live_headcounts(text), public.get_live_subject_headcounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_live_headcounts(text), public.get_live_subject_headcounts()
  TO authenticated, service_role;

-- Friends: "studying now" from the same live data. Same signature as before.
CREATE OR REPLACE FUNCTION public.get_friends(_user_id uuid)
RETURNS TABLE (
  friend_id uuid, name text, avatar_url text, college text, course text, year text,
  status public.friend_status, direction text, online boolean, subject_name text, classroom_id uuid, room_number integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.avatar_url, p.college, p.course, p.year,
         f.status,
         CASE WHEN f.requester_id = _user_id THEN 'outgoing' ELSE 'incoming' END AS direction,
         lp.user_id IS NOT NULL AS online,
         s.name,
         -- Only offer "Join" for a classroom seat; a private session is invite-only.
         CASE WHEN lp.in_private THEN NULL ELSE lp.classroom_id END,
         c.room_number
    FROM public.friendships f
    JOIN public.profiles p
      ON p.id = CASE WHEN f.requester_id = _user_id THEN f.addressee_id ELSE f.requester_id END
    LEFT JOIN public.live_presence() lp ON lp.user_id = p.id
    LEFT JOIN public.classrooms c ON c.id = lp.classroom_id
    LEFT JOIN public.subjects s ON s.slug = c.subject_slug
   WHERE (f.requester_id = _user_id OR f.addressee_id = _user_id)
     AND f.status <> 'declined'
   ORDER BY online DESC, p.name;
$$;
