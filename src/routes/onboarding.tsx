import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PathwaayMark, PathwaayWordmark } from "@/components/brand";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Complete your profile — Pathwaay" },
      { name: "description", content: "Tell us about your course so we can match you to peers." },
    ],
  }),
  component: Onboarding,
});

const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];

interface Course {
  slug: string;
  name: string;
  degree: string;
  duration_years: number;
}

function Onboarding() {
  const nav = useNavigate();
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [form, setForm] = useState({
    name: "",
    dob: "",
    degree: "",
    courseSlug: "",
    college: "",
    year: YEARS[0],
  });

  // The course list drives which subjects a student sees, so load it up front.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("courses")
        .select("slug, name, degree, duration_years")
        .order("degree")
        .order("name");
      if (!cancelled && data) setCourses(data as Course[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Anyone who already finished this should never see it again, and a Google
  // sign-in gives us a name up front worth pre-filling.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        nav({ to: "/login", replace: true });
        return;
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("name, dob, degree, course_slug, college, year, onboarded_at")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (prof?.onboarded_at) {
        nav({ to: "/home", replace: true });
        return;
      }
      const meta = (user.user_metadata ?? {}) as Record<string, string | undefined>;
      setForm((f) => ({
        ...f,
        name: prof?.name?.trim() || meta.full_name || meta.name || "",
        dob: prof?.dob ?? "",
        degree: prof?.degree ?? "",
        courseSlug: prof?.course_slug ?? "",
        college: prof?.college ?? "",
        year: prof?.year || YEARS[0],
      }));
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [nav]);

  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Please enter your full name");
      return;
    }
    if (!form.degree) {
      toast.error("Please choose your degree");
      return;
    }
    if (!form.courseSlug) {
      toast.error("Please choose your course");
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      setSaving(false);
      nav({ to: "/login", replace: true });
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({
        name: form.name.trim(),
        dob: form.dob || null,
        degree: form.degree,
        course_slug: form.courseSlug,
        // Keep the free-text column in step for anything still reading it.
        course: courses.find((c) => c.slug === form.courseSlug)?.name ?? "",
        college: form.college.trim(),
        year: form.year,
        email: user.email ?? "",
        onboarded_at: new Date().toISOString(),
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    nav({ to: "/home", replace: true });
  };

  // A 3-year B.Sc has no 4th year, so do not offer one.
  const coursesForDegree = courses.filter((c) => c.degree === form.degree);
  const selectedCourse = courses.find((c) => c.slug === form.courseSlug) ?? null;
  const yearOptions = YEARS.slice(0, selectedCourse?.duration_years ?? 4);
  const yearIndex = Math.max(1, yearOptions.indexOf(form.year) + 1);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background px-5 pb-16 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-10">
      <div className="flex items-center gap-2.5">
        <PathwaayMark className="h-8 w-8" />
        <PathwaayWordmark className="text-[13px]" />
      </div>
      <div className="mx-auto w-full max-w-[560px] pt-10 sm:pt-16">
        <div>
          <h1 className="text-[26px] font-bold leading-tight">Set up your profile</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            Your course and year decide which subject classrooms you see. Your name is what
            classmates see when you ask or answer a doubt.
          </p>

          <form className="mt-8 space-y-8" onSubmit={submit}>
            <fieldset className="space-y-4">
              <legend className="mb-3 text-[15px] font-semibold">About you</legend>
              <Field label="Full name">
                <input
                  value={form.name}
                  onChange={set("name")}
                  required
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  className={inputClass}
                />
              </Field>

              <Field label="Date of birth">
                <input type="date" value={form.dob} onChange={set("dob")} className={inputClass} />
              </Field>
            </fieldset>

            <fieldset className="space-y-4 border-t border-border pt-7">
              <legend className="float-left mb-3 w-full text-[15px] font-semibold">
                What you study
              </legend>
              <Field label="College">
                <input
                  value={form.college}
                  onChange={set("college")}
                  placeholder="Indian Institute of Technology"
                  className={inputClass}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-[1fr_2fr_1fr]">
                <Field label="Degree">
                  <select
                    value={form.degree}
                    onChange={(e) =>
                      // Courses are degree-specific, so changing degree clears the
                      // course rather than leaving a B.Tech course under B.Sc.
                      setForm((f) => ({ ...f, degree: e.target.value, courseSlug: "" }))
                    }
                    className={inputClass}
                  >
                    <option value="">Select your degree…</option>
                    <option value="B.Tech">B.Tech</option>
                    <option value="B.Sc">B.Sc</option>
                  </select>
                </Field>

                <Field label="Course">
                  <select
                    value={form.courseSlug}
                    onChange={set("courseSlug")}
                    disabled={!form.degree}
                    className={`${inputClass} disabled:opacity-50`}
                  >
                    <option value="">
                      {form.degree ? "Select your course…" : "Choose a degree first"}
                    </option>
                    {coursesForDegree.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Year">
                  <select value={form.year} onChange={set("year")} className={inputClass}>
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {selectedCourse && (
                <p className="text-[13px] text-muted-foreground">
                  You'll see subjects from semesters{" "}
                  <span className="font-semibold text-foreground">
                    {yearIndex * 2 - 1} and {yearIndex * 2}
                  </span>{" "}
                  of {selectedCourse.name}.
                </p>
              )}
            </fieldset>

            <button
              disabled={saving}
              className="w-full rounded-lg bg-primary py-2.5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-brand-deep disabled:opacity-60 sm:w-auto sm:px-8"
            >
              {saving ? "Saving…" : "Continue to your subjects"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-[15px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
