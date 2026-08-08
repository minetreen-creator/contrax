import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

// Mirrors the markRead createServerFn that used to live in src/lib/notifications.ts
// (migrated from a client RPC that silently failed on production).
async function handler({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (!body || typeof body.id !== "number") {
    return Response.json({ error: "Invalid notification id" }, { status: 400 });
  }
  await sql()`UPDATE notifications SET read = true WHERE id = ${body.id} AND user_id = ${user.id}`;
  return Response.json({ success: true });
}

export const Route = createFileRoute("/api/notifications-mark-read")({
  server: { handlers: { POST: handler } },
});
