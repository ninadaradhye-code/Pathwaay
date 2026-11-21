import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const LABELS: Record<number, string> = {
  1: "1 — Not helpful at all",
  2: "2 — Barely helped",
  3: "3 — A little helpful",
  4: "4 — Could be better",
  5: "5 — It was okay",
  6: "6 — Pretty good",
  7: "7 — Good session",
  8: "8 — Great session",
  9: "9 — Excellent",
  10: "10 — Absolutely perfect!",
};

export interface Ratee {
  /** Supabase user id — what actually gets stored. */
  userId: string;
  name: string;
}

/**
 * Rate the people who helped with a doubt.
 *
 * A session can hold several helpers, so the rater picks who each score is for
 * and rates them one at a time. Previously the modal took a single fixed id and
 * never showed whose name it was, so in a three-person session you could not
 * tell — or choose — who you were scoring.
 */
export function RatingModal({
  open,
  onClose,
  ratees,
  classroomId,
}: {
  open: boolean;
  onClose: () => void;
  ratees: Ratee[];
  classroomId?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [solved, setSolved] = useState<"yes" | "partial" | "no" | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string[]>([]);

  // Preselect when there is no choice to make.
  useEffect(() => {
    if (!open) return;
    const left = ratees.filter((r) => !done.includes(r.userId));
    setSelected(left.length === 1 ? left[0].userId : null);
  }, [open, ratees, done]);

  useEffect(() => {
    if (open) return;
    // Reset once closed so a later session starts clean.
    setDone([]);
    setSolved(null);
    setScore(null);
    setText("");
  }, [open]);

  if (!open) return null;

  const remaining = ratees.filter((r) => !done.includes(r.userId));
  const current = ratees.find((r) => r.userId === selected) ?? null;

  const color = (n: number, isSelected: boolean) => {
    if (!isSelected) return "text-foreground border-border hover:bg-secondary";
    if (n <= 4) return "bg-danger text-white border-danger";
    if (n <= 7) return "bg-warning text-white border-warning";
    return "bg-success text-white border-success";
  };

  const submit = async () => {
    if (!current) {
      toast.error("Choose who you are rating");
      return;
    }
    if (!score) {
      toast.error("Pick a score from 1 to 10");
      return;
    }
    setSaving(true);
    try {
      const { data } = await supabase.auth.getUser();
      const me = data.user?.id;
      if (!me) throw new Error("Sign in required");
      if (current.userId === me) throw new Error("You cannot rate yourself");

      const { error } = await supabase.from("session_ratings").insert({
        rater_id: me,
        ratee_id: current.userId,
        classroom_id: classroomId ?? null,
        score,
        solved,
        comment: text.trim() || null,
      });
      if (error) throw error;

      const nowDone = [...done, current.userId];
      setDone(nowDone);
      toast.success(`Rated ${current.name}`);

      // More people left to rate? Reset the form and stay open.
      if (ratees.some((r) => !nowDone.includes(r.userId))) {
        setScore(null);
        setSolved(null);
        setText("");
        setSelected(null);
        return;
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save rating");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-elevated">
        <h3 className="text-center text-lg font-bold">
          {ratees.length > 1 ? "Rate the people who helped" : "Was your doubt solved?"}
        </h3>

        {/* Who am I rating? Always visible, so the score is never ambiguous. */}
        {ratees.length > 1 && (
          <>
            <div className="mt-5 text-[13px] font-medium text-muted-foreground">
              Who are you rating?
            </div>
            <div className="mt-2 space-y-2">
              {ratees.map((r) => {
                const isDone = done.includes(r.userId);
                const isActive = selected === r.userId;
                return (
                  <button
                    key={r.userId}
                    disabled={isDone}
                    onClick={() => setSelected(r.userId)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                      isDone
                        ? "border-border opacity-50"
                        : isActive
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-secondary"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        isDone ? "bg-success text-white" : "bg-primary text-primary-foreground"
                      }`}
                    >
                      {isDone ? <Check className="h-4 w-4" /> : r.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                    {isDone && <span className="text-xs text-success">Rated</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {ratees.length === 1 && (
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Rating <span className="font-semibold text-foreground">{ratees[0].name}</span>
          </p>
        )}

        <div className="mt-6 grid grid-cols-3 gap-2">
          {[
            { v: "yes", label: "✅ Yes" },
            { v: "partial", label: "🔶 Partially" },
            { v: "no", label: "❌ No" },
          ].map((o) => (
            <button
              key={o.v}
              onClick={() => setSolved(o.v as never)}
              className={`rounded-lg border py-2 text-sm font-medium ${
                solved === o.v ? "border-primary bg-primary/10 text-primary" : "border-border"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="mt-6 text-center text-[13px] font-medium text-muted-foreground">
          {current ? `Rate ${current.name}` : "Rate your session"}
        </div>
        <div className="mt-3 flex justify-between gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => setScore(n)}
              className={`h-10 w-9 rounded-md border text-sm font-bold ${color(n, score === n)}`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mt-3 min-h-5 text-center text-sm font-medium text-foreground">
          {score ? LABELS[score] : " "}
        </div>

        <label className="mt-4 block text-[13px] font-medium text-muted-foreground">
          Tell us why (optional)
        </label>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What did they explain well? What could be better?"
          className="mt-1 w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground"
        />

        <button
          onClick={submit}
          disabled={saving || !current}
          className="mt-4 w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {saving
            ? "Submitting…"
            : remaining.length > 1
              ? `Submit rating for ${current?.name ?? "…"}`
              : "Submit rating"}
        </button>

        {/* Rating is a courtesy, not a toll gate on leaving the room. */}
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-lg py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {done.length > 0 ? "Done" : "Skip"}
        </button>
      </div>
    </div>
  );
}
