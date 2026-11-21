import { HandHelping, Mic, Video } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The product in one picture: a doubt is posted in a classroom, a classmate
 * presses Help, and a private session opens. Built from the same shapes as the
 * real classroom chat, so what a visitor sees here is what they get.
 *
 * The three beats play once, in order, on load (CSS only; skipped when the
 * visitor prefers reduced motion).
 */
export function DoubtDemo({ className }: { className?: string }) {
  return (
    <div
      aria-label="Example: Ananya posts a doubt, Rohan offers help, and they start a private session"
      role="img"
      className={cn(
        "w-full max-w-[400px] rounded-2xl bg-room p-3 text-left text-white shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55)] ring-1 ring-white/10",
        className,
      )}
    >
      <div className="flex items-center justify-between px-1.5 pb-3 pt-1 text-[12px] text-white/55">
        <span>Data Structures, room 2</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success" /> 18 studying
        </span>
      </div>

      <div className="space-y-2">
        <Beat delay={150}>
          <div className="flex flex-col items-start">
            <span className="mb-0.5 px-1 text-[11px] text-white/55">Kabir</span>
            <span className="rounded-2xl rounded-bl-sm bg-white/10 px-3 py-2 text-[13px]">
              anyone else on the linked lists sheet?
            </span>
          </div>
        </Beat>

        <Beat delay={700}>
          <div className="rounded-xl bg-doubt/[0.13] p-3 ring-1 ring-doubt/40">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="rounded bg-doubt/25 px-1.5 py-0.5 font-semibold text-doubt">
                Doubt
              </span>
              <span className="font-semibold text-white/80">Ananya</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-snug">
              Why does quicksort become O(n²) when the array is already sorted?
            </p>
            <div className="mt-2.5 flex justify-end">
              <span className="demo-press inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-1.5 text-[12px] font-semibold">
                <HandHelping className="h-3.5 w-3.5" /> Help
              </span>
            </div>
          </div>
        </Beat>

        <Beat delay={1700}>
          <div className="rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10">
            <p className="text-[12px] text-white/60">Rohan is helping Ananya</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Tile name="Ananya" initials="AS" />
              <Tile name="Rohan" initials="RM" />
            </div>
            <div className="mt-2.5 flex items-center justify-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10">
                <Mic className="h-3.5 w-3.5" />
              </span>
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10">
                <Video className="h-3.5 w-3.5" />
              </span>
              <span className="text-[11px] text-white/50">Private session, mic and camera on</span>
            </div>
          </div>
        </Beat>
      </div>
    </div>
  );
}

function Beat({ delay, children }: { delay: number; children: React.ReactNode }) {
  return (
    <div className="demo-beat" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Tile({ name, initials }: { name: string; initials: string }) {
  return (
    <div className="relative flex aspect-[4/3] items-center justify-center rounded-lg bg-black/35">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-[12px] font-semibold">
        {initials}
      </span>
      <span className="absolute bottom-1 left-1.5 text-[10px] text-white/70">{name}</span>
    </div>
  );
}
