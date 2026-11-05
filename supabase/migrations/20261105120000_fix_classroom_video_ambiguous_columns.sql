-- Fix classroom video seat functions: `column reference "status" is ambiguous`.
--
-- claim_classroom_video_seat and heartbeat_classroom_video are declared
-- RETURNS TABLE(status text, warning_count smallint). In PL/pgSQL those output
-- columns are also variables, so every unqualified reference to the table
-- columns of the same name was ambiguous and the functions raised on every
-- call — nobody could join classroom video. Recreate both with every column
-- reference qualified (plus `#variable_conflict use_column` as a backstop).
-- Behaviour is otherwise identical to 20260916090000.

CREATE OR REPLACE FUNCTION public.claim_classroom_video_seat(p_classroom_id uuid, p_user_id uuid, p_session_id uuid)
RETURNS TABLE(status text, warning_count smallint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  seats integer;
  old_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_classroom_id::text, 0));

  DELETE FROM classroom_video_participants cvp
   WHERE cvp.classroom_id = p_classroom_id
     AND cvp.status = 'active'
     AND cvp.last_seen < now() - interval '75 seconds';

  SELECT cvp.status INTO old_status
    FROM classroom_video_participants cvp
   WHERE cvp.classroom_id = p_classroom_id AND cvp.user_id = p_user_id
   FOR UPDATE;
  IF old_status = 'kicked' THEN
    RAISE EXCEPTION 'You were removed because your camera remained off.';
  END IF;

  SELECT count(*) INTO seats
    FROM classroom_video_participants cvp
   WHERE cvp.classroom_id = p_classroom_id
     AND cvp.status = 'active'
     AND cvp.user_id <> p_user_id;
  IF seats >= 30 THEN
    RAISE EXCEPTION 'This classroom is full (30 participants).';
  END IF;

  INSERT INTO classroom_video_participants AS cvp (classroom_id, user_id, session_id)
  VALUES (p_classroom_id, p_user_id, p_session_id)
  ON CONFLICT (classroom_id, user_id) DO UPDATE
     SET session_id = EXCLUDED.session_id,
         status = 'active',
         camera_on = true,
         camera_off_since = NULL,
         last_seen = now(),
         joined_at = now();

  RETURN QUERY SELECT 'active'::text, 0::smallint;
END $$;

CREATE OR REPLACE FUNCTION public.heartbeat_classroom_video(p_classroom_id uuid, p_user_id uuid, p_session_id uuid, p_camera_on boolean)
RETURNS TABLE(status text, warning_count smallint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  row_status text;
  warnings smallint;
  off_since timestamptz;
  warned_at timestamptz;
BEGIN
  SELECT cvp.status, cvp.warning_count, cvp.camera_off_since, cvp.last_warning_at
    INTO row_status, warnings, off_since, warned_at
    FROM classroom_video_participants cvp
   WHERE cvp.classroom_id = p_classroom_id
     AND cvp.user_id = p_user_id
     AND cvp.session_id = p_session_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your classroom session is no longer active.';
  END IF;
  IF row_status <> 'active' THEN
    RETURN QUERY SELECT row_status, warnings;
    RETURN;
  END IF;

  IF p_camera_on THEN
    UPDATE classroom_video_participants cvp
       SET last_seen = now(), camera_on = true, camera_off_since = NULL,
           last_warning_at = NULL, warning_count = 0
     WHERE cvp.classroom_id = p_classroom_id AND cvp.user_id = p_user_id;
  ELSE
    UPDATE classroom_video_participants cvp
       SET last_seen = now(), camera_on = false,
           camera_off_since = COALESCE(cvp.camera_off_since, now())
     WHERE cvp.classroom_id = p_classroom_id AND cvp.user_id = p_user_id;

    SELECT cvp.warning_count, cvp.camera_off_since, cvp.last_warning_at
      INTO warnings, off_since, warned_at
      FROM classroom_video_participants cvp
     WHERE cvp.classroom_id = p_classroom_id AND cvp.user_id = p_user_id;

    IF off_since <= now() - interval '5 seconds'
       AND (warned_at IS NULL OR warned_at <= now() - interval '10 seconds') THEN
      IF warnings >= 3 THEN
        UPDATE classroom_video_participants cvp
           SET status = 'kicked'
         WHERE cvp.classroom_id = p_classroom_id AND cvp.user_id = p_user_id;
      ELSE
        UPDATE classroom_video_participants cvp
           SET warning_count = cvp.warning_count + 1, last_warning_at = now()
         WHERE cvp.classroom_id = p_classroom_id AND cvp.user_id = p_user_id;
      END IF;
    END IF;
  END IF;

  RETURN QUERY
    SELECT cvp.status, cvp.warning_count
      FROM classroom_video_participants cvp
     WHERE cvp.classroom_id = p_classroom_id AND cvp.user_id = p_user_id;
END $$;

-- These are server-only (called with the service role key). Supabase grants
-- EXECUTE on new public functions to anon/authenticated explicitly, which the
-- original REVOKE ... FROM PUBLIC did not remove; without this any signed-in
-- user could claim or heartbeat a seat for another user id.
REVOKE ALL ON FUNCTION public.claim_classroom_video_seat(uuid, uuid, uuid),
                       public.heartbeat_classroom_video(uuid, uuid, uuid, boolean),
                       public.leave_classroom_video(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_classroom_video_seat(uuid, uuid, uuid),
                          public.heartbeat_classroom_video(uuid, uuid, uuid, boolean),
                          public.leave_classroom_video(uuid, uuid, uuid)
  TO service_role;
