import { useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/** Section heading inside the console. */
export function SectionTitle({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[24px] font-bold leading-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-[65ch] text-[14px] text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A strip of headline numbers, divided by hairlines rather than boxed one by one. */
export function Figures({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-border [&>*]:border-b [&>*]:border-r">
      {children}
    </div>
  );
}

export function Figure({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "attention" | "live" | "danger";
}) {
  return (
    <div className="-mb-px -mr-px px-4 py-4">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-[26px] font-bold leading-none",
          tone === "attention" && "text-doubt-ink",
          tone === "live" && "text-success",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      {note && <p className="mt-1.5 text-[12px] text-muted-foreground">{note}</p>}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "danger" | "attention" | "live" | "brand";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium",
        tone === "neutral" && "bg-secondary text-muted-foreground",
        tone === "danger" && "bg-danger/10 text-danger",
        tone === "attention" && "bg-doubt-soft text-doubt-ink",
        tone === "live" && "bg-success/10 text-success",
        tone === "brand" && "bg-accent text-primary",
        className,
      )}
    >
      {children}
    </span>
  );
}

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-brand-deep disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-secondary disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-danger/90 disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50",
};

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-4">
          <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-56 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-[14px]">
      <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className={btn.secondary}>
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <p className="text-[15px] font-semibold">{title}</p>
      {children && (
        <p className="mx-auto mt-1 max-w-md text-[14px] text-muted-foreground">{children}</p>
      )}
    </div>
  );
}

/**
 * Confirmation for any moderation action. Optional note (recorded in the audit
 * log) and optional duration choice for suspensions.
 */
export function ActionDialog({
  title,
  body,
  confirm,
  tone = "primary",
  withNote,
  durations,
  onCancel,
  onConfirm,
}: {
  title: string;
  body?: ReactNode;
  confirm: string;
  tone?: "primary" | "danger";
  withNote?: boolean;
  durations?: Array<{ label: string; days: number }>;
  onCancel: () => void;
  onConfirm: (input: { note: string; days?: number }) => unknown;
}) {
  const [note, setNote] = useState("");
  const [days, setDays] = useState(durations?.[0]?.days);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 text-foreground shadow-elevated">
        <h2 className="text-[17px] font-bold">{title}</h2>
        {body && <div className="mt-2 text-[14px] text-muted-foreground">{body}</div>}
        {durations && (
          <div className="mt-4">
            <p className="mb-1.5 text-[13px] font-medium">For how long</p>
            <div className="flex flex-wrap gap-2">
              {durations.map((d) => (
                <button
                  key={d.days}
                  onClick={() => setDays(d.days)}
                  aria-pressed={days === d.days}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-[13px] font-medium",
                    days === d.days
                      ? "border-primary bg-accent text-primary"
                      : "border-input hover:bg-secondary",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {withNote && (
          <label className="mt-4 block">
            <span className="mb-1.5 block text-[13px] font-medium">
              Note for the audit log (optional)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Why you're doing this"
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-[14px] focus:border-primary focus:outline-none"
            />
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className={btn.ghost} disabled={busy}>
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm({ note, days });
              } finally {
                setBusy(false);
              }
            }}
            className={tone === "danger" ? btn.danger : btn.primary}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

export const SUSPEND_DURATIONS = [
  { label: "1 day", days: 1 },
  { label: "3 days", days: 3 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];
