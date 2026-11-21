import { Moon, Sun } from "lucide-react";
import { usePlan } from "@/lib/plan-context";
import { cn } from "@/lib/utils";

/** Switches between light and dark. Says what it will switch to. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = usePlan();
  const toDark = theme !== "dark";
  return (
    <button
      onClick={toggleTheme}
      aria-label={toDark ? "Switch to dark mode" : "Switch to light mode"}
      title={toDark ? "Switch to dark mode" : "Switch to light mode"}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary",
        className,
      )}
    >
      {toDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      <span className="hidden sm:inline">{toDark ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}
