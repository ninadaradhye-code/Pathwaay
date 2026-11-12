-- Classroom chat, doubts and private help sessions.
--
--   classroom_messages            chat and doubts posted inside a live classroom
--   private_sessions              a help session started from a doubt; the host is
--                                 the student who asked it
--   private_session_participants  who is in each session, mic/cam state, host mute
--                                 and remove
--   private_session_media         server-only: Cloudflare session ids and the track
--                                 mids each person pulled, so a removed person's
--                                 media can be cut off
--
-- Chat is written by clients directly (RLS: only people currently in the
-- classroom, only as themselves). Every write to the session tables goes through
-- server functions using the service role, via the SECURITY DEFINER functions
-- below, so "only the host can mute/remove" and "removed people cannot rejoin"
-- are enforced in the database rather than trusted to the browser.
--
-- Depends on 20260916090000_classroom_video_participants (classroom leases).

-- ---------------------------------------------------------------------------
-- Classroom membership = a fresh, active classroom video lease.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_classroom_member(_classroom_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.classroom_video_participants p
     WHERE p.classroom_id = _classroom_id
       AND p.user_id = auth.uid()
       AND p.status = 'active'
       AND p.last_seen > now() - interval '75 seconds'
  );
$$;
REVOKE ALL ON FUNCTION public.is_classroom_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_classroom_member(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Chat + doubts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.classroom_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name text NOT NULL DEFAULT 'Student',
  kind text NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'doubt')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS classroom_messages_room_time
  ON public.classroom_messages (classroom_id, created_at DESC);

-- The display name comes from the profile, never from the client, so nobody can
-- post under someone else's name. Also stamps the time server-side and stops a
-- single person flooding the room.
CREATE OR REPLACE FUNCTION public.classroom_messages_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  display_name text;
  recent integer;
BEGIN
  NEW.body := btrim(NEW.body);
  NEW.resolved_at := NULL;
  NEW.created_at := now();

  SELECT NULLIF(btrim(p.name), '') INTO display_name
    FROM public.profiles p
   WHERE p.id = NEW.author_id;
  NEW.author_name := COALESCE(display_name, 'Student');

  SELECT count(*) INTO recent
    FROM public.classroom_messages m
   WHERE m.author_id = NEW.author_id
     AND m.created_at > now() - interval '10 seconds';
  IF recent >= 8 THEN
    RAISE EXCEPTION 'You are sending messages too fast. Wait a few seconds.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.classroom_messages_before_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS classroom_messages_before_insert ON public.classroom_messages;
CREATE TRIGGER classroom_messages_before_insert
  BEFORE INSERT ON public.classroom_messages
  FOR EACH ROW EXECUTE FUNCTION public.classroom_messages_before_insert();

ALTER TABLE public.classroom_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.classroom_messages FROM anon, authenticated;
GRANT SELECT, INSERT ON public.classroom_messages TO authenticated;
-- The only thing anyone may change afterwards is marking their own doubt solved.
GRANT UPDATE (resolved_at) ON public.classroom_messages TO authenticated;
GRANT ALL ON public.classroom_messages TO service_role;

DROP POLICY IF EXISTS "classroom chat: members read" ON public.classroom_messages;
CREATE POLICY "classroom chat: members read" ON public.classroom_messages
  FOR SELECT TO authenticated
  USING (public.is_classroom_member(classroom_id));

DROP POLICY IF EXISTS "classroom chat: members post as themselves" ON public.classroom_messages;
CREATE POLICY "classroom chat: members post as themselves" ON public.classroom_messages
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.is_classroom_member(classroom_id));

DROP POLICY IF EXISTS "classroom chat: author resolves own doubt" ON public.classroom_messages;
CREATE POLICY "classroom chat: author resolves own doubt" ON public.classroom_messages
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid() AND kind = 'doubt')
  WITH CHECK (author_id = auth.uid() AND kind = 'doubt');

-- ---------------------------------------------------------------------------
-- Private help sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.private_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  doubt_id uuid REFERENCES public.classroom_messages(id) ON DELETE SET NULL,
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  host_name text NOT NULL DEFAULT 'Student',
  started_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_by_name text NOT NULL DEFAULT 'Student',
  topic text NOT NULL,
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
-- One live session per doubt: a second helper joins the existing one.
CREATE UNIQUE INDEX IF NOT EXISTS private_sessions_one_live_per_doubt
  ON public.private_sessions (doubt_id) WHERE status = 'live' AND doubt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS private_sessions_live_by_room
  ON public.private_sessions (classroom_id) WHERE status = 'live';

CREATE TABLE IF NOT EXISTS public.private_session_participants (
  session_id uuid NOT NULL REFERENCES public.private_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Student',
  is_host boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'joined' CHECK (status IN ('joined', 'left', 'removed')),
  mic_on boolean NOT NULL DEFAULT false,
  cam_on boolean NOT NULL DEFAULT false,
  host_muted boolean NOT NULL DEFAULT false,
  -- Bumped every time this person (re)publishes media, so others know to pull.
  media_version integer NOT NULL DEFAULT 0,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS private_session_participants_joined
  ON public.private_session_participants (classroom_id) WHERE status = 'joined';

CREATE TABLE IF NOT EXISTS public.private_session_media (
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  cf_session_id text NOT NULL,
  pulled_mids text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id, user_id)
    REFERENCES public.private_session_participants (session_id, user_id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION public.is_private_session_participant(_session_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.private_session_participants p
     WHERE p.session_id = _session_id AND p.user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_private_session_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_private_session_participant(uuid) TO authenticated, service_role;

ALTER TABLE public.private_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_session_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_session_media ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.private_sessions, public.private_session_participants, public.private_session_media
  FROM anon, authenticated;
GRANT SELECT ON public.private_sessions, public.private_session_participants TO authenticated;
GRANT ALL ON public.private_sessions, public.private_session_participants, public.private_session_media
  TO service_role;
-- private_session_media: no policies and no grants — server only.

-- Visible to the classroom it belongs to (so anyone there can find and join it)
-- and to everyone involved in it.
DROP POLICY IF EXISTS "private sessions: classroom and participants read" ON public.private_sessions;
CREATE POLICY "private sessions: classroom and participants read" ON public.private_sessions
  FOR SELECT TO authenticated
  USING (
    host_id = auth.uid()
    OR started_by = auth.uid()
    OR public.is_classroom_member(classroom_id)
    OR public.is_private_session_participant(id)
  );

DROP POLICY IF EXISTS "private session roster: classroom and participants read" ON public.private_session_participants;
CREATE POLICY "private session roster: classroom and participants read" ON public.private_session_participants
  FOR SELECT TO authenticated
  USING (
    public.is_classroom_member(classroom_id)
    OR public.is_private_session_participant(session_id)
  );

-- ---------------------------------------------------------------------------
-- Session lifecycle (service role only, except the harmless sweep)
-- ---------------------------------------------------------------------------

-- People who stopped heartbeating are gone; a session whose host is gone ends.
-- The host gets 90 seconds from creation to accept a help request.
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
END $$;
REVOKE ALL ON FUNCTION public.sweep_private_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sweep_private_sessions() TO authenticated, service_role;

-- A helper presses "Help" on a doubt. Returns the live session for that doubt,
-- creating it if needed. The doubt's author becomes the host.
CREATE OR REPLACE FUNCTION public.start_help_session(p_doubt_id uuid, p_helper_id uuid, p_helper_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  d public.classroom_messages%ROWTYPE;
  existing uuid;
  new_id uuid;
BEGIN
  PERFORM public.sweep_private_sessions();

  -- Lock the doubt so two helpers pressing at once get the same session.
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

  SELECT s.id INTO existing
    FROM public.private_sessions s
   WHERE s.doubt_id = p_doubt_id AND s.status = 'live';
  IF existing IS NOT NULL THEN
    RETURN existing;
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

-- Enter (or re-enter after a refresh) a live session. Returns whether the caller
-- is the host. Removed people are refused; sessions hold at most p_max people.
CREATE OR REPLACE FUNCTION public.join_private_session(p_session_id uuid, p_user_id uuid, p_name text, p_max integer DEFAULT 6)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  s public.private_sessions%ROWTYPE;
  prior text;
  others integer;
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
  RETURN p_user_id = s.host_id;
END $$;

-- Record a successful publish so the others pull this person's tracks.
CREATE OR REPLACE FUNCTION public.mark_private_media_published(p_session_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.private_session_participants p
     SET media_version = p.media_version + 1, last_seen = now()
   WHERE p.session_id = p_session_id AND p.user_id = p_user_id AND p.status = 'joined';
$$;

-- Liveness + mic/cam state. A host-muted person's mic is always reported off.
CREATE OR REPLACE FUNCTION public.heartbeat_private_session(p_session_id uuid, p_user_id uuid, p_mic boolean, p_cam boolean)
RETURNS TABLE (participant_status text, host_muted boolean, session_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.private_session_participants p
     SET last_seen = now(),
         mic_on = p_mic AND NOT p.host_muted,
         cam_on = p_cam
   WHERE p.session_id = p_session_id AND p.user_id = p_user_id AND p.status = 'joined';

  PERFORM public.sweep_private_sessions();

  RETURN QUERY
    SELECT p.status, p.host_muted, s.status
      FROM public.private_session_participants p
      JOIN public.private_sessions s ON s.id = p.session_id
     WHERE p.session_id = p_session_id AND p.user_id = p_user_id;
END $$;

-- Host-only moderation: 'mute' | 'unmute' | 'remove' | 'mute_all'.
CREATE OR REPLACE FUNCTION public.moderate_private_session(p_session_id uuid, p_host_id uuid, p_target uuid, p_action text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  s public.private_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.private_sessions ps WHERE ps.id = p_session_id FOR UPDATE;
  IF NOT FOUND OR s.status <> 'live' THEN
    RAISE EXCEPTION 'This private session has ended.';
  END IF;
  IF s.host_id <> p_host_id THEN
    RAISE EXCEPTION 'Only the student who asked the doubt can do that.';
  END IF;

  IF p_action = 'mute_all' THEN
    UPDATE public.private_session_participants p
       SET host_muted = true, mic_on = false
     WHERE p.session_id = p_session_id AND p.user_id <> s.host_id AND p.status = 'joined';
    RETURN;
  END IF;

  IF p_target IS NULL OR p_target = s.host_id THEN
    RAISE EXCEPTION 'The host cannot be muted or removed.';
  END IF;

  IF p_action = 'mute' THEN
    UPDATE public.private_session_participants p
       SET host_muted = true, mic_on = false
     WHERE p.session_id = p_session_id AND p.user_id = p_target AND p.status = 'joined';
  ELSIF p_action = 'unmute' THEN
    UPDATE public.private_session_participants p
       SET host_muted = false
     WHERE p.session_id = p_session_id AND p.user_id = p_target;
  ELSIF p_action = 'remove' THEN
    UPDATE public.private_session_participants p
       SET status = 'removed', mic_on = false, cam_on = false
     WHERE p.session_id = p_session_id AND p.user_id = p_target AND p.status = 'joined';
  ELSE
    RAISE EXCEPTION 'Unknown action.';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That person is not in this session.';
  END IF;
END $$;

-- Leave. When the host leaves (or declines a help request) the session ends for
-- everyone. Returns true when the session is over.
CREATE OR REPLACE FUNCTION public.leave_private_session(p_session_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  s public.private_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.private_sessions ps WHERE ps.id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN true;
  END IF;

  UPDATE public.private_session_participants p
     SET status = 'left', mic_on = false, cam_on = false
   WHERE p.session_id = p_session_id AND p.user_id = p_user_id AND p.status = 'joined';

  IF s.status = 'live' AND s.host_id = p_user_id THEN
    UPDATE public.private_sessions ps SET status = 'ended', ended_at = now() WHERE ps.id = p_session_id;
    UPDATE public.private_session_participants p
       SET status = 'left', mic_on = false, cam_on = false
     WHERE p.session_id = p_session_id AND p.status = 'joined';
    RETURN true;
  END IF;
  RETURN s.status <> 'live';
END $$;

REVOKE ALL ON FUNCTION
  public.start_help_session(uuid, uuid, text),
  public.join_private_session(uuid, uuid, text, integer),
  public.mark_private_media_published(uuid, uuid),
  public.heartbeat_private_session(uuid, uuid, boolean, boolean),
  public.moderate_private_session(uuid, uuid, uuid, text),
  public.leave_private_session(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.start_help_session(uuid, uuid, text),
  public.join_private_session(uuid, uuid, text, integer),
  public.mark_private_media_published(uuid, uuid),
  public.heartbeat_private_session(uuid, uuid, boolean, boolean),
  public.moderate_private_session(uuid, uuid, uuid, text),
  public.leave_private_session(uuid, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Realtime: chat, the live-session list and each session's roster.
-- REPLICA IDENTITY FULL so filtered UPDATE/DELETE events carry the whole row.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['classroom_messages', 'private_sessions', 'private_session_participants']
  LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_object THEN NULL;  -- no realtime publication (local tests)
    END;
  END LOOP;
END $$;
