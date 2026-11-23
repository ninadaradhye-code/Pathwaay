-- Admin console backend.
--
-- 1. Security fix: students could UPDATE every column of their own profile,
--    including suspended_until, so a suspended student could lift their own
--    suspension. They can now only write the columns the app edits.
-- 2. Reports get a resolution (who handled it, when, how).
-- 3. Everything the admin console does goes through the SECURITY DEFINER
--    functions below, each of which checks the caller's role on the server.
--    The old screen wrote to other people's profiles directly, which RLS
--    silently refused, so its Suspend button did nothing.
--
-- Roles: moderators and admins can moderate; only admins change roles.
-- Depends on 20261124090000_chat_abuse_filter.

-- ---------------------------------------------------------------------------
-- 1. Profiles: students write only their own editable fields.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (name, email, college, course, course_slug, degree, dob, year, avatar_url, onboarded_at)
  ON public.profiles TO authenticated;
GRANT INSERT (id, name, email, college, course, course_slug, degree, dob, year, avatar_url, onboarded_at)
  ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Report resolution
-- ---------------------------------------------------------------------------
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS resolution text;
CREATE INDEX IF NOT EXISTS reports_open ON public.reports (created_at DESC) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Admin functions
-- ---------------------------------------------------------------------------

-- Returns the caller's id if they may moderate (or administer), else raises.
CREATE OR REPLACE FUNCTION public.admin_assert(_admin_only boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;
  IF public.has_role(me, 'admin') THEN
    RETURN me;
  END IF;
  IF NOT _admin_only AND public.has_role(me, 'moderator') THEN
    RETURN me;
  END IF;
  RAISE EXCEPTION 'Admin access required.';
END $$;

CREATE OR REPLACE FUNCTION public.admin_log(_actor uuid, _target uuid, _action text, _details jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.moderation_log (actor_id, target_user_id, action, details)
  VALUES (_actor, _target, _action, COALESCE(_details, '{}'::jsonb));
$$;

-- Headline numbers for the overview.
CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_assert();
  RETURN jsonb_build_object(
    'online_now', (SELECT count(DISTINCT c.user_id) FROM public.classroom_video_participants c
                    WHERE c.status = 'active' AND c.last_seen > now() - interval '75 seconds'),
    'live_classrooms', (SELECT count(DISTINCT c.classroom_id) FROM public.classroom_video_participants c
                         WHERE c.status = 'active' AND c.last_seen > now() - interval '75 seconds'),
    'live_sessions', (SELECT count(*) FROM public.private_sessions s WHERE s.status = 'live'),
    'in_sessions', (SELECT count(*) FROM public.private_session_participants p WHERE p.status = 'joined'),
    'open_reports', (SELECT count(*) FROM public.reports r WHERE r.resolved_at IS NULL),
    'auto_flags_24h', (SELECT count(*) FROM public.reports r
                        WHERE r.reporter_id = r.reported_user_id AND r.created_at > now() - interval '24 hours'),
    'suspended_now', (SELECT count(*) FROM public.profiles p WHERE p.suspended_until > now()),
    'muted_now', (SELECT count(*) FROM (
                    SELECT s.user_id FROM public.chat_strikes s
                     WHERE s.created_at > now() - interval '10 minutes'
                     GROUP BY s.user_id HAVING count(*) >= 3) m),
    'students_total', (SELECT count(*) FROM public.profiles p WHERE p.onboarded_at IS NOT NULL),
    'signups_7d', (SELECT count(*) FROM public.profiles p WHERE p.created_at > now() - interval '7 days'),
    'sessions_7d', (SELECT count(*) FROM public.private_sessions s WHERE s.created_at > now() - interval '7 days'),
    'ratings_7d', (SELECT count(*) FROM public.session_ratings r WHERE r.created_at > now() - interval '7 days'),
    'solved_7d', (SELECT count(*) FROM public.session_ratings r
                   WHERE r.created_at > now() - interval '7 days' AND r.solved IN ('yes', 'partial'))
  );
END $$;

-- Report queue.
CREATE OR REPLACE FUNCTION public.admin_list_reports(_status text DEFAULT 'open', _limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid, created_at timestamptz, reason text, notes text, automatic boolean,
  reporter_id uuid, reporter_name text,
  reported_id uuid, reported_name text, reported_email text, reported_suspended_until timestamptz,
  reports_against bigint,
  resolved_at timestamptz, resolution text, resolver_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.admin_assert();
  RETURN QUERY
    SELECT r.id, r.created_at, r.reason::text, r.notes,
           (r.reporter_id = r.reported_user_id),
           r.reporter_id, NULLIF(btrim(rp.name), ''),
           r.reported_user_id, NULLIF(btrim(tp.name), ''), tp.email, tp.suspended_until,
           (SELECT count(*) FROM public.reports x WHERE x.reported_user_id = r.reported_user_id),
           r.resolved_at, r.resolution, NULLIF(btrim(rv.name), '')
      FROM public.reports r
      LEFT JOIN public.profiles rp ON rp.id = r.reporter_id
      LEFT JOIN public.profiles tp ON tp.id = r.reported_user_id
      LEFT JOIN public.profiles rv ON rv.id = r.resolved_by
     WHERE (_status = 'open' AND r.resolved_at IS NULL)
        OR (_status = 'resolved' AND r.resolved_at IS NOT NULL)
        OR _status = 'all'
     ORDER BY r.created_at DESC
     LIMIT LEAST(GREATEST(_limit, 1), 500);
END $$;

-- Act on a report: 'dismiss' | 'warn' | 'suspend' (needs _days) | 'ban'.
CREATE OR REPLACE FUNCTION public.admin_resolve_report(_report_id uuid, _action text, _days integer DEFAULT NULL, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  me uuid := public.admin_assert();
  rep public.reports%ROWTYPE;
  until timestamptz;
BEGIN
  SELECT * INTO rep FROM public.reports r WHERE r.id = _report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That report no longer exists.';
  END IF;
  IF rep.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'That report was already handled.';
  END IF;
  IF _action NOT IN ('dismiss', 'warn', 'suspend', 'ban') THEN
    RAISE EXCEPTION 'Unknown action.';
  END IF;

  IF _action IN ('suspend', 'ban') THEN
    IF rep.reported_user_id IS NULL THEN
      RAISE EXCEPTION 'This report is not about a person.';
    END IF;
    IF rep.reported_user_id = me THEN
      RAISE EXCEPTION 'You cannot suspend yourself.';
    END IF;
    IF public.has_role(rep.reported_user_id, 'admin') AND NOT public.has_role(me, 'admin') THEN
      RAISE EXCEPTION 'Only an admin can suspend another admin.';
    END IF;
    until := CASE WHEN _action = 'ban' THEN now() + interval '100 years'
                  ELSE now() + make_interval(days => GREATEST(COALESCE(_days, 1), 1)) END;
    UPDATE public.profiles p
       SET suspended_until = GREATEST(COALESCE(p.suspended_until, now()), until)
     WHERE p.id = rep.reported_user_id;
    -- One decision covers every open report about the same person.
    UPDATE public.reports r
       SET resolved_at = now(), resolved_by = me,
           resolution = CASE WHEN r.id = _report_id THEN _action ELSE 'covered by ' || _action END
     WHERE r.reported_user_id = rep.reported_user_id AND r.resolved_at IS NULL;
  ELSE
    UPDATE public.reports r
       SET resolved_at = now(), resolved_by = me, resolution = _action
     WHERE r.id = _report_id;
  END IF;

  PERFORM public.admin_log(me, rep.reported_user_id, _action,
    jsonb_build_object('report_id', _report_id, 'reason', rep.reason::text, 'days', _days, 'note', _note,
                       'until', until));
END $$;

-- People search. _filter: 'all' | 'suspended' | 'staff' | 'flagged'.
CREATE OR REPLACE FUNCTION public.admin_search_users(_q text DEFAULT '', _filter text DEFAULT 'all', _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS TABLE (
  id uuid, name text, email text, college text, course text, year text,
  created_at timestamptz, onboarded boolean, suspended_until timestamptz,
  roles text[], solved bigint, reports_against bigint, chat_strikes_10m bigint, online boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  q text := '%' || lower(btrim(COALESCE(_q, ''))) || '%';
BEGIN
  PERFORM public.admin_assert();
  RETURN QUERY
    WITH base AS (
      SELECT p.*,
             COALESCE((SELECT array_agg(ur.role::text ORDER BY ur.role::text) FROM public.user_roles ur
                        WHERE ur.user_id = p.id AND ur.role <> 'user'), '{}') AS role_list,
             (SELECT count(*) FROM public.session_ratings sr
               WHERE sr.ratee_id = p.id AND sr.solved IN ('yes', 'partial')) AS solved_count,
             (SELECT count(*) FROM public.reports r
               WHERE r.reported_user_id = p.id AND r.created_at > now() - interval '30 days') AS reports_30d,
             (SELECT count(*) FROM public.chat_strikes s
               WHERE s.user_id = p.id AND s.created_at > now() - interval '10 minutes') AS strikes_10m,
             EXISTS (SELECT 1 FROM public.classroom_video_participants c
                      WHERE c.user_id = p.id AND c.status = 'active'
                        AND c.last_seen > now() - interval '75 seconds') AS is_online
        FROM public.profiles p
       WHERE lower(COALESCE(p.name, '')) LIKE q
          OR lower(COALESCE(p.email, '')) LIKE q
          OR lower(COALESCE(p.college, '')) LIKE q
    )
    SELECT b.id, NULLIF(btrim(b.name), ''), b.email, b.college, b.course, b.year,
           b.created_at, b.onboarded_at IS NOT NULL, b.suspended_until,
           b.role_list, b.solved_count, b.reports_30d, b.strikes_10m, b.is_online
      FROM base b
     WHERE _filter = 'all'
        OR (_filter = 'suspended' AND b.suspended_until > now())
        OR (_filter = 'staff' AND cardinality(b.role_list) > 0)
        OR (_filter = 'flagged' AND (b.reports_30d > 0 OR b.strikes_10m > 0))
     ORDER BY b.is_online DESC, b.created_at DESC
     LIMIT LEAST(GREATEST(_limit, 1), 200) OFFSET GREATEST(_offset, 0);
END $$;

-- Everything about one person.
CREATE OR REPLACE FUNCTION public.admin_user_detail(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prof public.profiles%ROWTYPE;
BEGIN
  PERFORM public.admin_assert();
  SELECT * INTO prof FROM public.profiles p WHERE p.id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such student.';
  END IF;
  RETURN jsonb_build_object(
    'profile', jsonb_build_object(
      'id', prof.id, 'name', prof.name, 'email', prof.email, 'college', prof.college,
      'course', prof.course, 'year', prof.year, 'avatar_url', prof.avatar_url,
      'created_at', prof.created_at, 'onboarded_at', prof.onboarded_at,
      'suspended_until', prof.suspended_until),
    'roles', COALESCE((SELECT jsonb_agg(ur.role::text) FROM public.user_roles ur
                        WHERE ur.user_id = _user_id AND ur.role <> 'user'), '[]'::jsonb),
    'stats', jsonb_build_object(
      'solved', (SELECT count(*) FROM public.session_ratings sr
                  WHERE sr.ratee_id = _user_id AND sr.solved IN ('yes', 'partial')),
      'ratings', (SELECT count(*) FROM public.session_ratings sr WHERE sr.ratee_id = _user_id),
      'avg_rating', (SELECT round(avg(sr.score)::numeric, 1) FROM public.session_ratings sr WHERE sr.ratee_id = _user_id),
      'sessions', (SELECT count(*) FROM public.private_session_participants sp WHERE sp.user_id = _user_id),
      'reports_made', (SELECT count(*) FROM public.reports r
                        WHERE r.reporter_id = _user_id AND r.reported_user_id IS DISTINCT FROM _user_id)),
    'online_in', (SELECT jsonb_build_object('classroom_id', c.classroom_id, 'subject', s.name, 'room', cl.room_number)
                    FROM public.classroom_video_participants c
                    JOIN public.classrooms cl ON cl.id = c.classroom_id
                    LEFT JOIN public.subjects s ON s.slug = cl.subject_slug
                   WHERE c.user_id = _user_id AND c.status = 'active'
                     AND c.last_seen > now() - interval '75 seconds'
                   LIMIT 1),
    'reports_against', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT r.id, r.created_at, r.reason::text AS reason, r.notes,
               r.reporter_id = r.reported_user_id AS automatic,
               NULLIF(btrim(rp.name), '') AS reporter_name, r.resolution, r.resolved_at
          FROM public.reports r LEFT JOIN public.profiles rp ON rp.id = r.reporter_id
         WHERE r.reported_user_id = _user_id
         ORDER BY r.created_at DESC LIMIT 25) x), '[]'::jsonb),
    'chat_strikes', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT s.created_at, sub.name AS subject
          FROM public.chat_strikes s
          LEFT JOIN public.classrooms cl ON cl.id = s.classroom_id
          LEFT JOIN public.subjects sub ON sub.slug = cl.subject_slug
         WHERE s.user_id = _user_id
         ORDER BY s.created_at DESC LIMIT 25) x), '[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT m.created_at, m.action, m.details, NULLIF(btrim(ap.name), '') AS actor_name
          FROM public.moderation_log m LEFT JOIN public.profiles ap ON ap.id = m.actor_id
         WHERE m.target_user_id = _user_id
         ORDER BY m.created_at DESC LIMIT 30) x), '[]'::jsonb)
  );
END $$;

-- Suspend until a time, or lift a suspension with NULL.
CREATE OR REPLACE FUNCTION public.admin_set_suspension(_user_id uuid, _until timestamptz, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := public.admin_assert();
BEGIN
  IF _user_id = me THEN
    RAISE EXCEPTION 'You cannot suspend yourself.';
  END IF;
  IF public.has_role(_user_id, 'admin') AND NOT public.has_role(me, 'admin') THEN
    RAISE EXCEPTION 'Only an admin can suspend another admin.';
  END IF;
  UPDATE public.profiles p SET suspended_until = _until WHERE p.id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such student.';
  END IF;
  PERFORM public.admin_log(me, _user_id, CASE WHEN _until IS NULL THEN 'unsuspend' ELSE 'suspend' END,
    jsonb_build_object('until', _until, 'note', _reason));
END $$;

-- Grant or remove moderator/admin. Admins only; nobody can remove the last admin.
CREATE OR REPLACE FUNCTION public.admin_set_role(_user_id uuid, _role public.app_role, _grant boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := public.admin_assert(true);
BEGIN
  IF _role = 'user' THEN
    RAISE EXCEPTION 'Everyone already has the student role.';
  END IF;
  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role) ON CONFLICT DO NOTHING;
  ELSE
    IF _role = 'admin' AND _user_id = me THEN
      RAISE EXCEPTION 'You cannot remove your own admin access.';
    END IF;
    IF _role = 'admin' AND (SELECT count(*) FROM public.user_roles ur WHERE ur.role = 'admin') <= 1 THEN
      RAISE EXCEPTION 'Pathwaay needs at least one admin.';
    END IF;
    DELETE FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.role = _role;
  END IF;
  PERFORM public.admin_log(me, _user_id, CASE WHEN _grant THEN 'grant_' ELSE 'revoke_' END || _role::text, '{}'::jsonb);
END $$;

-- What is happening right now: busy classrooms and live private sessions.
CREATE OR REPLACE FUNCTION public.admin_live()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_assert();
  RETURN jsonb_build_object(
    'classrooms', COALESCE((SELECT jsonb_agg(x ORDER BY x.count DESC) FROM (
        SELECT cl.id, cl.room_number, cl.capacity, s.name AS subject, count(*) AS count,
               jsonb_agg(jsonb_build_object('user_id', c.user_id,
                                            'name', COALESCE(NULLIF(btrim(p.name), ''), 'Student'),
                                            'since', c.joined_at) ORDER BY p.name) AS people
          FROM public.classroom_video_participants c
          JOIN public.classrooms cl ON cl.id = c.classroom_id
          LEFT JOIN public.subjects s ON s.slug = cl.subject_slug
          LEFT JOIN public.profiles p ON p.id = c.user_id
         WHERE c.status = 'active' AND c.last_seen > now() - interval '75 seconds'
         GROUP BY cl.id, cl.room_number, cl.capacity, s.name) x), '[]'::jsonb),
    'sessions', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT ps.id, ps.topic, ps.host_name, ps.created_at, sub.name AS subject, cl.room_number,
               COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', sp.user_id, 'name', sp.name,
                                                             'is_host', sp.is_host))
                           FROM public.private_session_participants sp
                          WHERE sp.session_id = ps.id AND sp.status = 'joined'), '[]'::jsonb) AS people
          FROM public.private_sessions ps
          LEFT JOIN public.classrooms cl ON cl.id = ps.classroom_id
          LEFT JOIN public.subjects sub ON sub.slug = cl.subject_slug
         WHERE ps.status = 'live') x), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_end_private_session(_session_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := public.admin_assert();
  host uuid;
BEGIN
  UPDATE public.private_sessions ps SET status = 'ended', ended_at = now()
   WHERE ps.id = _session_id AND ps.status = 'live'
  RETURNING ps.host_id INTO host;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That session has already ended.';
  END IF;
  UPDATE public.private_session_participants sp
     SET status = 'left', mic_on = false, cam_on = false
   WHERE sp.session_id = _session_id AND sp.status = 'joined';
  PERFORM public.admin_log(me, host, 'end_private_session', jsonb_build_object('session_id', _session_id));
END $$;

-- Chat safety: recent strikes and who is muted.
CREATE OR REPLACE FUNCTION public.admin_chat_activity()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.admin_assert();
  RETURN jsonb_build_object(
    'muted', COALESCE((SELECT jsonb_agg(x ORDER BY x.until DESC) FROM (
        SELECT s.user_id, COALESCE(NULLIF(btrim(p.name), ''), 'Student') AS name,
               max(s.created_at) + interval '10 minutes' AS until
          FROM public.chat_strikes s LEFT JOIN public.profiles p ON p.id = s.user_id
         WHERE s.created_at > now() - interval '10 minutes'
         GROUP BY s.user_id, p.name HAVING count(*) >= 3) x), '[]'::jsonb),
    'strikes', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
        SELECT s.user_id, s.created_at, COALESCE(NULLIF(btrim(p.name), ''), 'Student') AS name,
               sub.name AS subject, cl.room_number
          FROM public.chat_strikes s
          LEFT JOIN public.profiles p ON p.id = s.user_id
          LEFT JOIN public.classrooms cl ON cl.id = s.classroom_id
          LEFT JOIN public.subjects sub ON sub.slug = cl.subject_slug
         ORDER BY s.created_at DESC LIMIT 100) x), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_unmute(_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := public.admin_assert();
BEGIN
  DELETE FROM public.chat_strikes s WHERE s.user_id = _user_id AND s.created_at > now() - interval '10 minutes';
  PERFORM public.admin_log(me, _user_id, 'unmute', '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_blocked_terms()
RETURNS TABLE (term text, match text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.admin_assert();
  RETURN QUERY SELECT b.term, b.match FROM public.chat_blocked_terms b ORDER BY b.term;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_blocked_term(_term text, _match text, _remove boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  me uuid := public.admin_assert();
  t text := lower(btrim(COALESCE(_term, '')));
BEGIN
  IF char_length(t) < 2 OR char_length(t) > 60 THEN
    RAISE EXCEPTION 'A blocked word must be 2 to 60 characters.';
  END IF;
  IF _remove THEN
    DELETE FROM public.chat_blocked_terms b WHERE b.term = t;
    PERFORM public.admin_log(me, NULL, 'remove_blocked_word', jsonb_build_object('term', t));
  ELSE
    IF _match NOT IN ('word', 'prefix', 'any') THEN
      RAISE EXCEPTION 'Match must be word, prefix or any.';
    END IF;
    INSERT INTO public.chat_blocked_terms (term, match) VALUES (t, _match)
    ON CONFLICT (term) DO UPDATE SET match = EXCLUDED.match;
    PERFORM public.admin_log(me, NULL, 'add_blocked_word', jsonb_build_object('term', t, 'match', _match));
  END IF;
END $$;

-- Audit trail of every moderation action (and automatic ones).
CREATE OR REPLACE FUNCTION public.admin_audit_log(_action text DEFAULT NULL, _limit integer DEFAULT 200)
RETURNS TABLE (id uuid, created_at timestamptz, action text, details jsonb,
               actor_id uuid, actor_name text, target_id uuid, target_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.admin_assert();
  RETURN QUERY
    SELECT m.id, m.created_at, m.action, m.details,
           m.actor_id, NULLIF(btrim(ap.name), ''), m.target_user_id, NULLIF(btrim(tp.name), '')
      FROM public.moderation_log m
      LEFT JOIN public.profiles ap ON ap.id = m.actor_id
      LEFT JOIN public.profiles tp ON tp.id = m.target_user_id
     WHERE _action IS NULL OR m.action = _action
     ORDER BY m.created_at DESC
     LIMIT LEAST(GREATEST(_limit, 1), 1000);
END $$;

-- Grants: callable by signed-in users (each checks the role inside); the two
-- helpers are internal.
REVOKE ALL ON FUNCTION
  public.admin_assert(boolean),
  public.admin_log(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  public.admin_overview(),
  public.admin_list_reports(text, integer),
  public.admin_resolve_report(uuid, text, integer, text),
  public.admin_search_users(text, text, integer, integer),
  public.admin_user_detail(uuid),
  public.admin_set_suspension(uuid, timestamptz, text),
  public.admin_set_role(uuid, public.app_role, boolean),
  public.admin_live(),
  public.admin_end_private_session(uuid),
  public.admin_chat_activity(),
  public.admin_unmute(uuid),
  public.admin_list_blocked_terms(),
  public.admin_set_blocked_term(text, text, boolean),
  public.admin_audit_log(text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.admin_overview(),
  public.admin_list_reports(text, integer),
  public.admin_resolve_report(uuid, text, integer, text),
  public.admin_search_users(text, text, integer, integer),
  public.admin_user_detail(uuid),
  public.admin_set_suspension(uuid, timestamptz, text),
  public.admin_set_role(uuid, public.app_role, boolean),
  public.admin_live(),
  public.admin_end_private_session(uuid),
  public.admin_chat_activity(),
  public.admin_unmute(uuid),
  public.admin_list_blocked_terms(),
  public.admin_set_blocked_term(text, text, boolean),
  public.admin_audit_log(text, integer)
  TO authenticated, service_role;
