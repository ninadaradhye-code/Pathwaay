import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Keeps exactly OPEN_TARGET joinable (non-full) classrooms available for a
 * subject at all times. When rooms fill up, new ones are created automatically.
 */
const OPEN_TARGET = 3;
// Jitsi routes video through an SFU, so room size no longer multiplies the
// work each browser does. Back to the original 30 after the peer-to-peer mesh
// forced it down to 6.
const DEFAULT_CAPACITY = 30;
const PRESENCE_WINDOW_MS = 2 * 60 * 1000;

export const ensureOpenClassrooms = createServerFn({ method: "POST" })
  .validator((data) => z.object({ subject: z.string().min(1).max(100) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: subject } = await supabaseAdmin
      .from("subjects")
      .select("slug")
      .eq("slug", data.subject)
      .maybeSingle();
    if (!subject) return { created: 0, open: 0 };

    const { data: rooms } = await supabaseAdmin
      .from("classrooms")
      .select("id, room_number, capacity")
      .eq("subject_slug", data.subject);

    const list = rooms ?? [];
    const ids = list.map((r) => r.id);

    let counts: Record<string, number> = {};
    if (ids.length) {
      const { data: presence } = await supabaseAdmin
        .from("user_presence")
        .select("classroom_id")
        .in("classroom_id", ids)
        .gt("last_seen", new Date(Date.now() - PRESENCE_WINDOW_MS).toISOString());
      counts = (presence ?? []).reduce<Record<string, number>>((acc, p) => {
        if (p.classroom_id) acc[p.classroom_id] = (acc[p.classroom_id] ?? 0) + 1;
        return acc;
      }, {});
    }

    const open = list.filter((r) => (counts[r.id] ?? 0) < r.capacity).length;
    const missing = OPEN_TARGET - open;
    if (missing <= 0) return { created: 0, open };

    let next = list.reduce((max, r) => Math.max(max, r.room_number), 0);
    const inserts = Array.from({ length: missing }, () => ({
      subject_slug: data.subject,
      room_number: ++next,
      capacity: DEFAULT_CAPACITY,
      status: "open",
    }));

    const { error } = await supabaseAdmin.from("classrooms").insert(inserts);
    if (error) throw error;

    return { created: inserts.length, open: open + inserts.length };
  });
