import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Pathwaay's mark: an open book whose pages rise as coloured bars.
 *
 * Two files rather than one recoloured SVG, because the artwork itself differs
 * between themes — the light version sits on blue, the dark on navy. Both are
 * always in the DOM and swapped with CSS so there is no flash on theme change
 * and no JavaScript needed to pick one.
 */
export function PathwaayMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-block h-8 w-8 shrink-0", className)}>
      <img
        src="/logo-light.png"
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full rounded-[22%] object-contain dark:hidden"
      />
      <img
        src="/logo-dark.png"
        alt=""
        aria-hidden
        className="absolute inset-0 hidden h-full w-full rounded-[22%] object-contain dark:block"
      />
    </span>
  );
}

/**
 * The wordmark on its own, set the way the brand sheet sets it: wide geometric
 * caps in Jura. The spacing and casing live in the `wordmark` utility so the
 * name looks identical everywhere it appears — a wordmark that is retyped with
 * different tracking on each screen stops reading as one brand.
 *
 * `tone` picks the colour: "brand" for light surfaces, "onDark" inside the
 * classroom and other dark chrome.
 */
export function PathwaayWordmark({
  className,
  tone = "brand",
}: {
  className?: string;
  tone?: "brand" | "onDark" | "inherit";
}) {
  return (
    <span
      className={cn(
        "wordmark leading-none",
        tone === "brand" && "text-primary",
        tone === "onDark" && "text-white",
        className,
      )}
    >
      Pathwaay
    </span>
  );
}

/**
 * Mark plus wordmark. `size="lg"` for auth screens, default for chrome.
 * `tagline` adds "Be Limitless" underneath — worth it on entry screens, noise
 * anywhere it appears next to other UI.
 */
export function PathwaayLogo({
  className,
  size = "md",
  tagline = false,
  tone = "brand",
}: {
  className?: string;
  size?: "md" | "lg";
  tagline?: boolean;
  tone?: "brand" | "onDark";
}) {
  return (
    <div className={cn("inline-flex flex-col items-center", className)}>
      <div className="inline-flex items-center gap-3">
        <PathwaayMark className={size === "lg" ? "h-16 w-16" : "h-10 w-10"} />
        <PathwaayWordmark tone={tone} className={size === "lg" ? "text-3xl" : "text-xl"} />
      </div>
      {tagline && <Tagline size={size} tone={tone} />}
    </div>
  );
}

/**
 * "Be Limitless", ruled either side by the four bars of the mark so the tagline
 * carries the brand colours even where the logo is small.
 */
export function Tagline({
  size = "md",
  tone = "brand",
}: {
  size?: "md" | "lg";
  tone?: "brand" | "onDark";
}) {
  return (
    <span
      className={cn(
        "mt-2.5 flex items-center gap-2.5 font-semibold uppercase tracking-[0.3em]",
        size === "lg" ? "text-[10px]" : "text-[9px]",
        tone === "onDark" ? "text-white/60" : "text-muted-foreground",
      )}
    >
      <span className="brand-rainbow h-px w-8 rounded-full opacity-80" />
      Be Limitless
      <span className="brand-rainbow h-px w-8 rotate-180 rounded-full opacity-80" />
    </span>
  );
}
