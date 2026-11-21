// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // We deploy to Vercel. Left unset, nitro falls back to `cloudflare-module`
  // (a Lovable default), so a local `npm run build` would produce a Cloudflare
  // Worker that Vercel can't run. Vercel's CI auto-detects itself, but pinning
  // it here keeps local builds identical to production.
  nitro: { preset: "vercel" },
  // The camera-moderation worker loads its models lazily (code-split), which
  // needs ES-module workers rather than the default single-file IIFE.
  vite: { worker: { format: "es" } },
});
