import { BadgeCheck } from "lucide-react";
import { SUPERSTUDENT_EXPLAINER } from "@/lib/superstudent";
import { cn } from "@/lib/utils";

/** The Superstudent mark. Quiet by design: a seal and a word, in the brand blue. */
export function SuperstudentBadge({
  compact,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      title={`Superstudent: ${SUPERSTUDENT_EXPLAINER}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-[12px] font-semibold text-primary",
        className,
      )}
    >
      <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
      {compact ? <span className="sr-only">Superstudent</span> : "Superstudent"}
    </span>
  );
}
