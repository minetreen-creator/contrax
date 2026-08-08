import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

/** Owner-only deletion. */
async function handler({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = Number(body?.id);
  const rows = await sql()`DELETE FROM knowledge_documents WHERE id = ${id} AND user_id = ${user.id} RETURNING id`;
  if (rows.length === 0) {
    return Response.json({ error: "Document not found or you don't have permission to delete it" }, { status: 404 });
  }
  return Response.json({ success: true });
}

export const Route = createFileRoute("/api/knowledge-delete")({
  server: { handlers: { POST: handler } },
});
