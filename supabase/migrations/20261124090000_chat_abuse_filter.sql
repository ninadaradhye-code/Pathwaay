-- Chat abuse filter for classroom chat and doubts.
--
-- Every message now goes through post_classroom_message(), which runs on the
-- server: it refuses messages containing abusive language, counts a strike for
-- each refused message, and mutes the sender for 10 minutes after 3 strikes in
-- 10 minutes (also filing a report for moderators). Direct inserts from the
-- browser are no longer allowed, so the filter cannot be skipped.
--
-- Matching normalises the text first so common dodges still match:
--   "f u c k" -> fuck, "fuuuck" -> fuck, "f.u.c.k" -> fuck, "sh1t" -> shit
-- Each term says how it may match, so ordinary words are not caught:
--   word   - whole word only      ("ass" blocks "ass", not "class"/"assignment")
--   prefix - start of a word      ("bastard" also blocks "bastards")
--   any    - anywhere in the text ("fuck" also blocks "motherfucker")
--
-- Moderators can add or remove terms in the chat_blocked_terms table.
--
-- Depends on 20261112090000_classroom_chat_and_private_sessions.

CREATE TABLE IF NOT EXISTS public.chat_blocked_terms (
  term text PRIMARY KEY,
  match text NOT NULL DEFAULT 'word' CHECK (match IN ('word', 'prefix', 'any'))
);

CREATE TABLE IF NOT EXISTS public.chat_strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  classroom_id uuid REFERENCES public.classrooms(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_strikes_user_time ON public.chat_strikes (user_id, created_at DESC);

ALTER TABLE public.chat_blocked_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_strikes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_blocked_terms, public.chat_strikes FROM anon, authenticated;
GRANT ALL ON public.chat_blocked_terms, public.chat_strikes TO service_role;

INSERT INTO public.chat_blocked_terms (term, match) VALUES
  -- English
  ('fuck', 'any'), ('fuk', 'prefix'), ('fck', 'word'), ('fcking', 'word'),
  ('shit', 'prefix'), ('bullshit', 'any'),
  ('bitch', 'any'), ('asshole', 'any'), ('ass', 'word'), ('arse', 'word'),
  ('bastard', 'prefix'), ('dick', 'word'), ('dickhead', 'any'), ('cock', 'word'),
  ('cunt', 'word'), ('pussy', 'word'), ('slut', 'any'), ('whore', 'any'),
  ('nigga', 'any'), ('nigger', 'any'), ('fag', 'word'), ('faggot', 'any'),
  ('retard', 'word'), ('wanker', 'prefix'), ('twat', 'word'), ('prick', 'word'),
  ('kys', 'word'), ('kill yourself', 'any'),
  -- Hindi / Hinglish
  ('madarchod', 'any'), ('maderchod', 'any'), ('madarchot', 'any'),
  ('bhenchod', 'any'), ('behenchod', 'any'), ('bhenchot', 'any'), ('benchod', 'any'),
  ('chutiya', 'any'), ('chutiye', 'any'), ('chutia', 'any'), ('chut', 'word'),
  ('bhosdi', 'prefix'), ('bhosda', 'prefix'), ('bhosdike', 'any'),
  ('gandu', 'any'), ('gand', 'word'), ('gaand', 'word'),
  ('lund', 'word'), ('lauda', 'word'), ('lavda', 'word'), ('lawda', 'word'), ('loda', 'word'),
  ('randi', 'word'), ('harami', 'word'), ('haramkhor', 'any'), ('kutiya', 'word'),
  ('kamine', 'word'), ('jhatu', 'word'), ('bsdk', 'word'), ('bkl', 'word'), ('mkc', 'word'),
  ('teri maa ki', 'any'), ('maa ki aankh', 'any')
ON CONFLICT (term) DO NOTHING;

-- Lowercase, undo leetspeak, join spaced-out letters, drop punctuation, and
-- collapse repeated letters. Terms are normalised the same way when compared.
CREATE OR REPLACE FUNCTION public.normalize_chat_text(t text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(
               translate(lower(coalesce(t, '')), '013457@$!|', 'oieastasii'),
               '\m([a-z])\s+(?=[a-z]\M)', '\1', 'g'),
             '[^a-z\s]', '', 'g'),
           '(.)\1+', '\1', 'g');
$$;

CREATE OR REPLACE FUNCTION public.chat_text_is_abusive(t text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH n AS (SELECT public.normalize_chat_text(t) AS x)
  SELECT EXISTS (
    SELECT 1
      FROM public.chat_blocked_terms b, n
     WHERE (b.match = 'word'   AND n.x ~ ('\m' || public.normalize_chat_text(b.term) || '\M'))
        OR (b.match = 'prefix' AND n.x ~ ('\m' || public.normalize_chat_text(b.term)))
        OR (b.match = 'any'    AND position(public.normalize_chat_text(b.term) IN n.x) > 0)
  );
$$;

-- The only way to post in a classroom. Returns {status: sent|blocked|muted}.
CREATE OR REPLACE FUNCTION public.post_classroom_message(_classroom_id uuid, _kind text, _body text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  recent integer;
  last_strike timestamptz;
  new_id uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;
  IF NOT public.is_classroom_member(_classroom_id) THEN
    RAISE EXCEPTION 'You need to be connected to the classroom to chat.';
  END IF;
  IF _kind NOT IN ('chat', 'doubt') THEN
    RAISE EXCEPTION 'Unknown message type.';
  END IF;

  SELECT count(*), max(s.created_at) INTO recent, last_strike
    FROM public.chat_strikes s
   WHERE s.user_id = me AND s.created_at > now() - interval '10 minutes';
  IF recent >= 3 THEN
    RETURN jsonb_build_object('status', 'muted', 'muted_until', last_strike + interval '10 minutes');
  END IF;

  IF public.chat_text_is_abusive(_body) THEN
    INSERT INTO public.chat_strikes (user_id, classroom_id) VALUES (me, _classroom_id);
    recent := recent + 1;
    IF recent >= 3 THEN
      INSERT INTO public.reports (reporter_id, reported_user_id, reason, notes)
      VALUES (me, me, 'abuse',
              'Auto-flagged: abusive language in classroom chat 3 times; muted for 10 minutes');
      RETURN jsonb_build_object('status', 'muted', 'muted_until', now() + interval '10 minutes');
    END IF;
    RETURN jsonb_build_object('status', 'blocked', 'strikes', recent, 'max', 3);
  END IF;

  INSERT INTO public.classroom_messages (classroom_id, author_id, kind, body)
  VALUES (_classroom_id, me, _kind, _body)
  RETURNING id INTO new_id;
  RETURN jsonb_build_object('status', 'sent', 'id', new_id);
END $$;

REVOKE ALL ON FUNCTION public.post_classroom_message(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_classroom_message(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.chat_text_is_abusive(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_text_is_abusive(text) TO service_role;

-- No more direct inserts from the browser: everything goes through the filter.
REVOKE INSERT ON public.classroom_messages FROM authenticated;
DROP POLICY IF EXISTS "classroom chat: members post as themselves" ON public.classroom_messages;
