import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Home, ShieldAlert, Trophy, UserRound, Users, type LucideIcon } from "lucide-react";
import { PathwaayMark, PathwaayWordmark } from "@/components/brand";
import { usePlan } from "@/lib/plan-context";
import { cn } from "@/lib/utils";

/**
 * The frame every signed-in tab sits in.
 *
 * Wide screens get a left sidebar with the product's sections and who you are;
 * phones get the same sections as a bottom tab bar. Pages render only their own
 * content inside <PageHeader> and <PageBody>, so width, spacing and navigation
 * are identical everywhere instead of each screen inventing its own.
 */
const NAV: Array<{ to: string; label: string; icon: LucideIcon; match?: string[] }> = [
  { to: "/home", label: "Home", icon: Home, match: ["/home", "/subject"] },
  { to: "/experts", label: "Friends", icon: Users, match: ["/experts", "/u/"] },
  { to: "/ranks", label: "Rankings", icon: Trophy },
  { to: "/settings", label: "Profile", icon: UserRound, match: ["/settings", "/profile"] },
];

function useActive() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (item: (typeof NAV)[number]) =>
    (item.match ?? [item.to]).some(
      (p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : p + "/"),
    );
}

export function initialsOf(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A person's picture, or their initials on a quiet tinted disc. */
export function Avatar({
  name,
  src,
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  className?: string;
}) {
  return src ? (
    <img
      src={src}
      alt=""
      className={cn("h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-border", className)}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-accent-foreground",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, role } = usePlan();
  const isActive = useActive();

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Sidebar — laptop and up */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Link to="/home" className="flex items-center gap-2.5 px-5 pb-6 pt-6">
          <PathwaayMark className="h-8 w-8" />
          <PathwaayWordmark className="text-[13px]" />
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) => {
            const on = isActive(item);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors",
                  on
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <item.icon
                  className={cn("h-[18px] w-[18px]", on && "text-primary")}
                  strokeWidth={on ? 2.2 : 1.8}
                />
                {item.label}
              </Link>
            );
          })}
          {(role === "admin" || role === "moderator") && (
            <Link
              to="/admin"
              className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
            >
              <ShieldAlert className="h-[18px] w-[18px]" strokeWidth={1.8} />
              Moderation
            </Link>
          )}
        </nav>
        <Link
          to="/settings"
          className="m-3 flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-sidebar-accent/60"
        >
          <Avatar name={profile?.name} src={profile?.avatar} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold">
              {profile?.name || "Your profile"}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {[profile?.course, profile?.year].filter(Boolean).join(", ") || "Add your course"}
            </span>
          </span>
        </Link>
      </aside>

      <div className="pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-60">{children}</div>

      {/* Bottom tabs — phones and tablets */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex max-w-lg">
          {NAV.map((item) => {
            const on = isActive(item);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={on ? "page" : undefined}
                className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 pt-1"
              >
                <item.icon
                  className={cn("h-[22px] w-[22px]", on ? "text-primary" : "text-muted-foreground")}
                  strokeWidth={on ? 2.2 : 1.8}
                />
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    on ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/**
 * The top of a page: what this page is, one line of context, and its actions.
 * On phones it also carries the mark, since there is no sidebar to show it.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** A link back to the parent page, shown above the title. */
  back?: ReactNode;
}) {
  return (
    <header className="border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75 max-lg:sticky max-lg:top-0 max-lg:z-30">
      <div className="mx-auto w-full max-w-5xl px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-10 lg:pb-6 lg:pt-10">
        <div className="mb-3 flex items-center gap-2 lg:hidden">
          <PathwaayMark className="h-7 w-7" />
          <PathwaayWordmark className="text-[12px]" />
        </div>
        {back && <div className="mb-2">{back}</div>}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold leading-tight text-foreground sm:text-[26px]">
              {title}
            </h1>
            {description && (
              <div className="mt-1 max-w-[62ch] text-[14px] text-muted-foreground">
                {description}
              </div>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </div>
    </header>
  );
}

/** The page's content column. Same width and gutters on every tab. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={cn("mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8", className)}>
      {children}
    </main>
  );
}

/** A titled group inside a page. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-8 first:mt-0", className)}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** What to show when a list has nothing in it: what it is for, and what to do. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <Icon className="mx-auto h-6 w-6 text-muted-foreground" strokeWidth={1.8} />
      <p className="mt-3 text-[15px] font-semibold">{title}</p>
      {children && (
        <div className="mx-auto mt-1 max-w-sm text-[14px] text-muted-foreground">{children}</div>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** A green "live" marker. Animated only while something is actually live. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)} aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
    </span>
  );
}
