import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

const REASONS = [
  { id: "spam", label: "🚫 Spam or fake doubts" },
  { id: "harass", label: "😠 Harassment or bullying" },
  { id: "nsfw", label: "🔞 Inappropriate content" },
  { id: "cheat", label: "🎮 Cheating the points system" },
  { id: "other", label: "📝 Other" },
];

export function ReportModal({
  open,
  onClose,
  target = "user",
  name = "this user",
}: {
  open: boolean;
  onClose: () => void;
  target?: "user" | "doubt";
  name?: string;
}) {
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="relative w-full max-w-md rounded-2xl bg-card p-6 shadow-elevated">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
        <h3 className="text-lg font-bold">Report {target === "doubt" ? "this doubt" : name}</h3>
        <div className="mt-4 space-y-2">
          {REASONS.map((r) => (
            <label
              key={r.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 hover:bg-secondary"
            >
              <input
                type="radio"
                name="reason"
                value={r.id}
                checked={reason === r.id}
                onChange={() => setReason(r.id)}
                className="accent-primary"
              />
              <span className="text-sm">{r.label}</span>
            </label>
          ))}
        </div>
        <label className="mt-4 block text-[13px] font-medium text-muted-foreground">
          Tell us more (optional)
        </label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={3}
          placeholder="Give us any extra context..."
          className="mt-1 w-full rounded-lg border border-input bg-background p-3 text-sm"
        />
        <button
          onClick={() => {
            toast.success("Thanks for reporting. Our team will review this shortly.");
            onClose();
          }}
          className="mt-4 w-full rounded-lg bg-danger py-3 text-sm font-semibold text-white hover:opacity-90"
        >
          Submit Report
        </button>
      </div>
    </div>
  );
}

export function BlockModal({
  open,
  onClose,
  name,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-elevated">
        <h3 className="text-lg font-bold">Block this user</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Are you sure? {name} won't be able to see your doubts or join your sessions.
        </p>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              toast.success(`${name} has been blocked.`);
              onClose();
            }}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Block
          </button>
        </div>
      </div>
    </div>
  );
}
