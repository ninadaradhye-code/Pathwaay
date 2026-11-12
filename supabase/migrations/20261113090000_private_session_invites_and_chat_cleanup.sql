-- Invite-only private sessions, and chat that leaves with its author.
--
-- 1. Private sessions are invite-only. Besides the student who asked the doubt
--    (the host) and the helper who pressed Help, only people the host invites
--    can join. Someone who was already in and dropped out (refresh, network)
--    may come back. Invites expire after 2 minutes unanswered; inviting a
--    person the host removed earlier lets them back in.
-- 2. Chat messages and doubts disappear when their author leaves the
--    classroom. Stepping into a private session from that classroom does not
--    count as leaving while the session is live.
--
-- Depends on 20261112090000_classroom_chat_and_private_sessions.

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.private_session_invites (
  session_id uuid NOT NULL REFERENCES public.private_sessions(id) ON DELETE CASCADE,
  invitee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  invitee_name text NOT NULL DEFAULT 'Student',
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by_name text NOT NULL DEFAULT 'Student',
  topic text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  PRIMARY KEY (session_id, invitee_id)
);
CREATE INDEX IF NOT EXISTS private_session_invites_pending
  ON public.private_session_invites (invitee_id) WHERE status = 'pending';

ALTER TABLE public.private_session_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_session_invites FROM anon, authenticated;
GRANT SELECT ON public.private_session_invites TO authenticated;
GRANT ALL ON public.private_session_invites TO service_role;

-- The invitee sees their own invites; people in the session see who was invited.
DROP POLICY IF EXISTS "private session invites: invitee and participants read" ON public.private_session_invites;
CREATE POLICY "private session invites: invitee and participants read" ON public.private_session_invites
  FOR SELECT TO authenticated
  USING (invitee_id = auth.uid() OR public.is_private_session_participant(session_id));

-- ---------------------------------------------------------------------------
-- Sweep: also expire unanswered invites and cancel those for ended sessions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_private_sessions()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.private_session_participants p
     SET status = 'left', mic_on = false, cam_on = false
   WHERE p.status = 'joined'
     AND p.last_seen < now() - interval '30 seconds';

  UPDATE public.private_sessions s
     SET status = 'ended', ended_at = now()
   WHERE s.status = 'live'
     AND s.created_at < now() - interval '90 seconds'
     AND NOT EXISTS (
       SELECT 1 FROM public.private_session_participants p
        WHERE p.session_id = s.id AND p.user_id = s.host_id AND p.status = 'joined'
     );

  UPDATE public.private_session_participants p
     SET status = 'left', mic_on = false, cam_on = false
    FROM public.private_sessions s
   WHERE s.id = p.session_id AND s.status = 'ended' AND p.status = 'joined';

  UPDATE public.private_session_invites i
     SET status = 'expired', responded_at = now()
   WHERE i.status = 'pending'
     AND i.created_at < now() - interval '2 minutes';

  UPDATE public.private_session_invites i
     SET status = 'cancelled', responded_at = now()
    FROM public.private_sessions s
   WHERE s.id = i.session_id AND s.status = 'ended' AND i.status = 'pending';
END $$;
REVOKE ALL ON FUNCTION public.sweep_private_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_private_sessions() TO authenticated, service_role;

-- Host invites someone who is in the same classroom right now.
CREATE OR REPLACE FUNCTION public.invite_to_private_session(p_session_id uuid, p_host_id uuid, p_invitee_id uuid, p_max integer DEFAULT 6)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  s public.private_sessions%ROWTYPE;
  v_name text;
  v_status text;
  v_joined integer;
BEGIN
  PERFORM public.sweep_private_sessions();

  SELECT * INTO s FROM public.private_sessions ps WHERE ps.id = p_session_id FOR UPDATE;
  IF NOT FOUND OR s.status <> 'live' THEN
    RAISE EXCEPTION 'This private session has ended.';
  END IF;
  IF s.host_id <> p_host_id THEN
    RAISE EXCEPTION 'Only the student who asked the doubt can invite people.';
  END IF;
  IF p_invitee_id = s.host_id THEN
    RAISE EXCEPTION 'You are already in this session.';
  END IF;

  SELECT NULLIF(btrim(pr.name), '') INTO v_name FROM public.profiles pr WHERE pr.id = p_invitee_id;
  v_name := COALESCE(v_name, 'Student');

  SELECT p.status INTO v_status
    FROM public.private_session_participants p
   WHERE p.session_id = p_session_id AND p.user_id = p_invitee_id;
  IF v_status = 'joined' THEN
    RAISE EXCEPTION '% is already in this session.', v_name;
  END IF;

  SELECT count(*) INTO v_joined
    FROM public.private_session_participants p
   WHERE p.session_id = p_session_id AND p.status = 'joined';
  IF v_joined >= p_max THEN
    RAISE EXCEPTION 'This private session is full (% people).', p_max;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.classroom_video_participants c
     WHERE c.classroom_id = s.classroom_id AND c.user_id = p_invitee_id
       AND c.status = 'active' AND c.last_seen > now() - interval '75 seconds'
  ) THEN
    RAISE EXCEPTION '% is no longer in the classroom.', v_name;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.private_session_participants p
      JOIN public.private_sessions o ON o.id = p.session_id
     WHERE p.user_id = p_invitee_id AND p.status = 'joined' AND o.status = 'live'
       AND o.id <> p_session_id
  ) THEN
    RAISE EXCEPTION '% is already in another private session.', v_name;
  END IF;

  -- Inviting someone the host removed earlier lets them back in.
  IF v_status = 'removed' THEN
    UPDATE public.private_session_participants p
       SET status = 'left'
     WHERE p.session_id = p_session_id AND p.user_id = p_invitee_id;
  END IF;

  INSERT INTO public.private_session_invites AS i
    (session_id, invitee_id, classroom_id, invitee_name, invited_by, invited_by_name, topic,
     status, created_at, responded_at)
  VALUES
    (p_session_id, p_invitee_id, s.classroom_id, v_name, p_host_id, s.host_name, s.topic,
     'pending', now(), NULL)
  ON CONFLICT (session_id, invitee_id) DO UPDATE
     SET status = 'pending', created_at = now(), responded_at = NULL,
         invitee_name = EXCLUDED.invitee_name, topic = EXCLUDED.topic;
END $$;

CREATE OR REPLACE FUNCTION public.decline_private_invite(p_session_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.private_session_invites i
     SET status = 'declined', responded_at = now()
   WHERE i.session_id = p_session_id AND i.invitee_id = p_user_id AND i.status = 'pending';
$$;

-- Who the host can invite: everyone in the classroom right now who is not
-- already in this session, with any invite already sent.
CREATE OR REPLACE FUNCTION public.list_private_session_invitees(p_session_id uuid, p_host_id uuid)
RETURNS TABLE (user_id uuid, name text, invite_status text, busy boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  s public.private_sessions%ROWTYPE;
BEGIN
  PERFORM public.sweep_private_sessions();
  SELECT * INTO s FROM public.private_sessions ps WHERE ps.id = p_session_id;
  IF NOT FOUND OR s.status <> 'live' THEN
    RAISE EXCEPTION 'This private session has ended.';
  END IF;
  IF s.host_id <> p_host_id THEN
    RAISE EXCEPTION 'Only the student who asked the doubt can invite people.';
  END IF;

  RETURN QUERY
    SELECT c.user_id,
           COALESCE(NULLIF(btrim(pr.name), ''), 'Student'),
           i.status,
           EXISTS (
             SELECT 1 FROM public.private_session_participants sp
               JOIN public.private_sessions o ON o.id = sp.session_id
              WHERE sp.user_id = c.user_id AND sp.status = 'joined' AND o.status = 'live'
           )
      FROM public.classroom_video_participants c
      LEFT JOIN public.profiles pr ON pr.id = c.user_id
      LEFT JOIN public.private_session_invites i
             ON i.session_id = p_session_id AND i.invitee_id = c.user_id
     WHERE c.classroom_id = s.classroom_id
       AND c.status = 'active'
       AND c.last_seen > now() - interval '75 seconds'
       AND c.user_id <> s.host_id
       AND NOT EXISTS (
         SELECT 1 FROM public.private_session_participants sp
          WHERE sp.session_id = p_session_id AND sp.user_id = c.user_id AND sp.status = 'joined'
       )
     ORDER BY 2;
END $$;

-- ---------------------------------------------------------------------------
-- Joining is invite-only now.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_private_session(p_session_id uuid, p_user_id uuid, p_name text, p_max integer DEFAULT 6)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  s public.private_sessions%ROWTYPE;
  prior text;
  others integer;
  admitted boolean;
BEGIN
  PERFORM public.sweep_private_sessions();

  SELECT * INTO s FROM public.private_sessions ps WHERE ps.id = p_session_id FOR UPDATE;
  IF NOT FOUND OR s.status <> 'live' THEN
    RAISE EXCEPTION 'This private session has ended.';
  END IF;

  SELECT p.status INTO prior
    FROM public.private_session_participants p
   WHERE p.session_id = p_session_id AND p.user_id = p_user_id;
  IF prior = 'removed' THEN
    RAISE EXCEPTION 'The host removed you from this private session.';
  END IF;

  admitted := p_user_id = s.host_id
           OR p_user_id = s.started_by
           OR COALESCE(prior IN ('joined', 'left'), false)
           OR EXISTS (
                SELECT 1 FROM public.private_session_invites i
                 WHERE i.session_id = p_session_id AND i.invitee_id = p_user_id
                   AND i.status IN ('pending', 'accepted')
              );
  IF NOT admitted THEN
    RAISE EXCEPTION 'This private session is invite-only. Ask the host to invite you.';
  END IF;

  SELECT count(*) INTO others
    FROM public.private_session_participants p
   WHERE p.session_id = p_session_id AND p.status = 'joined' AND p.user_id <> p_user_id;
  IF others >= p_max THEN
    RAISE EXCEPTION 'This private session is full (% people).', p_max;
  END IF;

  INSERT INTO public.private_session_participants AS p
    (session_id, user_id, classroom_id, name, is_host, status, mic_on, cam_on, joined_at, last_seen)
  VALUES
    (p_session_id, p_user_id, s.classroom_id, COALESCE(NULLIF(btrim(p_name), ''), 'Student'),
     p_user_id = s.host_id, 'joined', false, false, now(), now())
  ON CONFLICT (session_id, user_id) DO UPDATE
     SET status = 'joined', name = EXCLUDED.name, mic_on = false, cam_on = false,
         last_seen = now();

  UPDATE public.private_session_invites i
     SET status = 'accepted', responded_at = now()
   WHERE i.session_id = p_session_id AND i.invitee_id = p_user_id AND i.status = 'pending';

  RETURN p_user_id = s.host_id;
END $$;

-- "Help" on a doubt that already has a session no longer lets anyone in.
CREATE OR REPLACE FUNCTION public.start_help_session(p_doubt_id uuid, p_helper_id uuid, p_helper_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  d public.classroom_messages%ROWTYPE;
  existing public.private_sessions%ROWTYPE;
  new_id uuid;
BEGIN
  PERFORM public.sweep_private_sessions();

  SELECT * INTO d FROM public.classroom_messages m WHERE m.id = p_doubt_id FOR UPDATE;
  IF NOT FOUND OR d.kind <> 'doubt' THEN
    RAISE EXCEPTION 'That doubt no longer exists.';
  END IF;
  IF d.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'That doubt has already been solved.';
  END IF;
  IF d.author_id = p_helper_id THEN
    RAISE EXCEPTION 'You cannot help with your own doubt.';
  END IF;

  SELECT * INTO existing
    FROM public.private_sessions s
   WHERE s.doubt_id = p_doubt_id AND s.status = 'live';
  IF FOUND THEN
    IF existing.started_by = p_helper_id
       OR EXISTS (
         SELECT 1 FROM public.private_session_participants p
          WHERE p.session_id = existing.id AND p.user_id = p_helper_id
            AND p.status IN ('joined', 'left')
       )
       OR EXISTS (
         SELECT 1 FROM public.private_session_invites i
          WHERE i.session_id = existing.id AND i.invitee_id = p_helper_id
            AND i.status IN ('pending', 'accepted')
       )
    THEN
      RETURN existing.id;
    END IF;
    RAISE EXCEPTION 'Someone is already helping with this doubt. % can invite you into the session.', d.author_name;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.classroom_video_participants p
     WHERE p.classroom_id = d.classroom_id AND p.user_id = p_helper_id
       AND p.status = 'active' AND p.last_seen > now() - interval '75 seconds'
  ) THEN
    RAISE EXCEPTION 'Join the classroom before offering help.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.private_session_participants p
      JOIN public.private_sessions s ON s.id = p.session_id
     WHERE p.user_id = d.author_id AND p.status = 'joined' AND s.status = 'live'
  ) THEN
    RAISE EXCEPTION '% is already in a private session.', d.author_name;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.classroom_video_participants p
     WHERE p.classroom_id = d.classroom_id AND p.user_id = d.author_id
       AND p.status = 'active' AND p.last_seen > now() - interval '75 seconds'
  ) THEN
    RAISE EXCEPTION '% has left the classroom, so they cannot be helped right now.', d.author_name;
  END IF;

  INSERT INTO public.private_sessions
    (classroom_id, doubt_id, host_id, host_name, started_by, started_by_name, topic)
  VALUES
    (d.classroom_id, d.id, d.author_id, d.author_name, p_helper_id,
     COALESCE(NULLIF(btrim(p_helper_name), ''), 'Student'), left(d.body, 280))
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

REVOKE ALL ON FUNCTION
  public.invite_to_private_session(uuid, uuid, uuid, integer),
  public.decline_private_invite(uuid, uuid),
  public.list_private_session_invitees(uuid, uuid),
  public.join_private_session(uuid, uuid, text, integer),
  public.start_help_session(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.invite_to_private_session(uuid, uuid, uuid, integer),
  public.decline_private_invite(uuid, uuid),
  public.list_private_session_invitees(uuid, uuid),
  public.join_private_session(uuid, uuid, text, integer),
  public.start_help_session(uuid, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Chat leaves with its author.
-- ---------------------------------------------------------------------------

-- Called by the browser when someone leaves the classroom on purpose.
CREATE OR REPLACE FUNCTION public.withdraw_my_classroom_messages(_classroom_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.classroom_messages m
   WHERE m.classroom_id = _classroom_id AND m.author_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.withdraw_my_classroom_messages(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_my_classroom_messages(uuid) TO authenticated, service_role;

-- Catches everyone who left without saying so (closed tab, crash, kicked).
-- Messages stay while the author is in the classroom, during a 90-second grace
-- after leaving it (the walk into a private session), and while they are in a
-- live private session of this classroom.
CREATE OR REPLACE FUNCTION public.sweep_classroom_messages(_classroom_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.classroom_messages m
   WHERE m.classroom_id = _classroom_id
     AND NOT EXISTS (
       SELECT 1 FROM public.classroom_video_participants c
        WHERE c.classroom_id = m.classroom_id AND c.user_id = m.author_id
          AND c.status IN ('active', 'left')
          AND c.last_seen > now() - interval '90 seconds'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.private_session_participants sp
         JOIN public.private_sessions s ON s.id = sp.session_id
        WHERE sp.user_id = m.author_id AND s.classroom_id = m.classroom_id
          AND s.status = 'live' AND sp.status = 'joined'
     );
$$;
REVOKE ALL ON FUNCTION public.sweep_classroom_messages(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_classroom_messages(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Realtime for invites.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.private_session_invites REPLICA IDENTITY FULL';
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.private_session_invites';
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;  -- no realtime publication (local tests)
  END;
END $$;
