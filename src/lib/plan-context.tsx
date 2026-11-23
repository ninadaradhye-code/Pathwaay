import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Role = "user" | "moderator" | "admin";
export type Theme = "light" | "dark";

export interface UserProfile {
  name: string;
  college: string;
  course: string;
  year: string;
  email: string;
  avatar?: string;
}

interface PlanContextValue {
  role: Role;
  profile: UserProfile | null;
  suspendedUntil: string | null;
  setRole: (r: Role) => void;
  setProfile: (p: UserProfile) => void;
  refreshProfile: () => Promise<void>;
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  // Legacy no-op stubs kept for backward compatibility with older callers.
  plan: "free";
  setPlan: (_: unknown) => void;
  openUpgrade: () => void;
  closeUpgrade: () => void;
  showUpgrade: false;
  isSuperStudent: false;
  setIsSuperStudent: (_: unknown) => void;
}

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>("user");
  const [profile, setProfileState] = useState<UserProfile | null>(null);
  const [theme, setThemeState] = useState<Theme>("light");

  const loadFromSupabase = async () => {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      setProfileState(null);
      setRoleState("user");
      return;
    }
    const [{ data: prof }, { data: roles }] = await Promise.all([
      supabase
        .from("profiles")
        .select("name, college, course, year, email, avatar_url")
        .eq("id", user.id)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    if (prof) {
      setProfileState({
        name: prof.name ?? "",
        college: prof.college ?? "",
        course: prof.course ?? "",
        year: prof.year ?? "",
        email: prof.email ?? user.email ?? "",
        avatar: prof.avatar_url ?? undefined,
      });
    }
    const has = (r: string) => (roles ?? []).some((x) => x.role === r);
    setRoleState(has("admin") ? "admin" : has("moderator") ? "moderator" : "user");
  };

  useEffect(() => {
    try {
      const t = localStorage.getItem("studyall.theme") as Theme | null;
      if (t === "light" || t === "dark") setThemeState(t);
    } catch {
      // localStorage unavailable (private mode) — fall back to the default theme.
    }

    void loadFromSupabase();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void loadFromSupabase();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setRole = (r: Role) => setRoleState(r);

  const setProfile = (p: UserProfile) => {
    setProfileState(p);
    // Persist to database if signed in
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      await supabase
        .from("profiles")
        .update({
          name: p.name,
          college: p.college,
          course: p.course,
          year: p.year,
          email: p.email,
          avatar_url: p.avatar ?? null,
        })
        .eq("id", data.user.id);
    })();
  };

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem("studyall.theme", t);
    } catch {
      // localStorage unavailable (private mode) — theme still applies for this session.
    }
  };
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <PlanContext.Provider
      value={{
        role,
        profile,
        setRole,
        setProfile,
        refreshProfile: loadFromSupabase,
        suspendedUntil: null,
        theme,
        setTheme,
        toggleTheme,
        plan: "free",
        setPlan: () => {},
        openUpgrade: () => {},
        closeUpgrade: () => {},
        showUpgrade: false,
        isSuperStudent: false,
        setIsSuperStudent: () => {},
      }}
    >
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlan must be used inside PlanProvider");
  return ctx;
}
