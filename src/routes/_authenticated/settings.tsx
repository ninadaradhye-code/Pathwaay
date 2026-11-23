import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, LogOut, Moon, ShieldAlert, Sun, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePlan } from "@/lib/plan-context";
import { Avatar, PageBody, PageHeader } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Profile — Pathwaay" },
      { name: "description", content: "Manage your Pathwaay account, profile and appearance." },
    ],
  }),
  component: Settings,
});

const YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function Settings() {
  const nav = useNavigate();
  const { profile, setProfile, theme, setTheme, role } = usePlan();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState({
    name: "",
    college: "",
    course: "",
    year: YEARS[0],
    dob: "",
  });

  // `dob` is not carried on the shared profile context, so read it here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("dob")
        .eq("id", data.user.id)
        .maybeSingle();
      if (!cancelled && prof?.dob) setForm((f) => ({ ...f, dob: prof.dob ?? "" }));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed the form from the profile, but never clobber edits in progress.
  useEffect(() => {
    if (dirty) return;
    setForm((f) => ({
      ...f,
      name: profile?.name ?? "",
      college: profile?.college ?? "",
      course: profile?.course ?? "",
      year: profile?.year || YEARS[0],
    }));
  }, [profile, dirty]);

  const set = (key: keyof typeof form, value: string) => {
    setDirty(true);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const { error } = await supabase
        .from("profiles")
        .update({ dob: form.dob || null })
        .eq("id", data.user.id);
      if (error) {
        setSaving(false);
        toast.error(error.message);
        return;
      }
    }
    setProfile({
      name: form.name.trim(),
      college: form.college.trim(),
      course: form.course.trim(),
      year: form.year,
      email: profile?.email ?? "",
      avatar: profile?.avatar,
    });
    setSaving(false);
    setDirty(false);
    toast.success("Profile updated");
  };

  const uploadAvatar = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error("Image must be under 2 MB");
      return;
    }
    setUploading(true);
    try {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) throw new Error("Sign in required");

      // Stored under a folder named after the user id — storage policy only
      // permits writes there. The timestamp busts the CDN cache on replace.
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${uid}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) {
        // The bucket is created by a migration; say so plainly rather than
        // surfacing "NoSuchBucket" to a student.
        if (/bucket/i.test(upErr.message)) {
          throw new Error("Photo storage isn't set up yet. Run the latest database migration.");
        }
        throw upErr;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path);

      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", uid);
      if (dbErr) throw dbErr;

      setProfile({
        name: profile?.name ?? "",
        college: profile?.college ?? "",
        course: profile?.course ?? "",
        year: profile?.year ?? "",
        email: profile?.email ?? "",
        avatar: publicUrl,
      });
      toast.success("Profile picture updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not upload picture");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeAvatar = async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: null })
      .eq("id", data.user.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setProfile({
      name: profile?.name ?? "",
      college: profile?.college ?? "",
      course: profile?.course ?? "",
      year: profile?.year ?? "",
      email: profile?.email ?? "",
      avatar: undefined,
    });
    toast.success("Profile picture removed");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    nav({ to: "/login", replace: true });
  };

  const displayName = profile?.name?.trim() || "Student";

  return (
    <>
      <PageHeader
        title="Profile"
        description="How classmates see you, and how Pathwaay looks for you."
      />
      <PageBody className="max-w-4xl">
        {/* Avatar + identity */}
        <section className="flex items-center gap-5">
          <div className="relative shrink-0">
            <Avatar name={displayName} src={profile?.avatar} className="h-20 w-20 text-2xl" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change profile picture"
              className="absolute -bottom-0.5 -right-0.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {uploading ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
              }}
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[20px] font-bold">{displayName}</div>
            <div className="truncate text-sm text-muted-foreground">{profile?.email}</div>
            {profile?.avatar && (
              <button
                onClick={() => void removeAvatar()}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-danger"
              >
                <Trash2 className="h-3 w-3" /> Remove photo
              </button>
            )}
          </div>
        </section>

        {/* Personal details — always editable, one save button. */}
        <Section
          title="Personal details"
          description="Your name is shown when you ask or answer a doubt. Course and year decide which subject classrooms you see."
        >
          <Field label="Full name">
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Date of birth">
            <input
              type="date"
              value={form.dob}
              onChange={(e) => set("dob", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="College">
            <input
              value={form.college}
              onChange={(e) => set("college", e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Course">
              <input
                value={form.course}
                onChange={(e) => set("course", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Year">
              <select
                value={form.year}
                onChange={(e) => set("year", e.target.value)}
                className={inputClass}
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex justify-end pt-1">
            <button
              onClick={() => void save()}
              disabled={saving || !dirty}
              className="rounded-lg bg-primary px-5 py-2 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-brand-deep disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </Section>

        {/* Account — read-only facts about the login itself. */}
        <Section title="Account" description="You sign in with a link sent to this email.">
          <div className="flex items-center justify-between gap-4 py-1">
            <div className="min-w-0">
              <div className="text-sm font-medium">Email</div>
              <div className="truncate text-sm text-muted-foreground">{profile?.email}</div>
            </div>
          </div>
        </Section>

        <Section
          title="Appearance"
          description="Classrooms and private sessions are always dark, so video stands out."
        >
          <div className="flex gap-2 sm:max-w-xs">
            <ThemeButton
              active={theme === "light"}
              onClick={() => setTheme("light")}
              icon={<Sun className="h-4 w-4" />}
              label="Light"
            />
            <ThemeButton
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
              icon={<Moon className="h-4 w-4" />}
              label="Dark"
            />
          </div>
        </Section>

        <div className="mt-10 flex flex-wrap gap-3 border-t border-border pt-6">
          {(role === "admin" || role === "moderator") && (
            <Link
              to="/admin"
              className="inline-flex items-center gap-2 rounded-lg border border-input px-5 py-2.5 text-sm font-semibold transition hover:bg-secondary"
            >
              <ShieldAlert className="h-4 w-4" /> Moderation console
            </Link>
          )}
          <button
            onClick={() => void signOut()}
            className="inline-flex items-center gap-2 rounded-lg border border-danger/30 px-5 py-2.5 text-sm font-semibold text-danger transition hover:bg-danger/10"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </PageBody>
    </>
  );
}

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-[15px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

/** Settings row: what it is and why it matters on the left, controls on the right. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 grid gap-4 md:grid-cols-[220px_1fr] md:gap-8">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      {children}
    </label>
  );
}

function ThemeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-semibold transition ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-secondary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
