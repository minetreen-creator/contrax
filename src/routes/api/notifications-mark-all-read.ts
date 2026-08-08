import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

// Mirrors the markAllRead createServerFn that used to live in src/lib/notifications.ts
// (migrated from a client RPC that silently failed on production).
async function handler({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  await sql()`UPDATE notifications SET read = true WHERE user_id = ${user.id} AND read = false`;
  return Response.json({ success: true });
}

export const Route = createFileRoute("/api/notifications-mark-all-read")({
  server: { handlers: { POST: handler } },
});
