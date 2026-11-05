import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Page authorization is server-side; Cloudflare credentials stay in the media proxy. */
export const authorizeClassroom = createServerFn({ method: "POST" })
  .validator((data) => z.object({ classId: z.string().uuid(), accessToken: z.string().min(10) }).parse(data))
  .handler(async ({ data }) => {
    const { authorizeClassroomAccess } = await import("@/lib/classroom-access");
    const access = await authorizeClassroomAccess(data.accessToken, data.classId);
    return { isModerator: access.isModerator, title: access.title, capacity: Math.min(30, access.capacity), identity: access.userId, name: access.displayName };
  });
