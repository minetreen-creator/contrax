import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { sanitizeWorkspace } from "~/lib/launchpad-sync";

/**
 * /api/launchpad/workspace (owner 2026-10-17): the signed-in user's Launchpad
 * workspace, so it follows them across devices.
 *   GET → { data: LaunchpadData | null }   (401 when signed out)
 *   PUT { data } → { success, updatedAt }  (sanitized with the same rules as
 *                                           browser storage; ~100 KB cap)
 */
async function ensureTable() {
  await sql()`
    CREATE TABLE IF NOT EXISTS launchpad_workspaces (
      user_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function getHandler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
    await ensureTable();
    const rows = (await sql()`SELECT data FROM launchpad_workspaces WHERE user_id = ${String(user.id)}`) as { data: unknown }[];
    return Response.json({ data: rows[0] ? sanitizeWorkspace(rows[0].data) : null });
  } catch (error) {
    console.error("[api/launchpad/workspace] GET error:", error);
    return Response.json({ error: "Couldn't load your Launchpad." }, { status: 500 });
  }
}

async function putHandler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { data?: unknown } | null;
    const data = sanitizeWorkspace(body?.data);
    if (!data) return Response.json({ error: "That Launchpad couldn't be saved." }, { status: 400 });
    if (!data.updatedAt) data.updatedAt = new Date().toISOString();
    await ensureTable();
    await sql()`
      INSERT INTO launchpad_workspaces (user_id, data, updated_at)
      VALUES (${String(user.id)}, CAST(${JSON.stringify(data)} AS JSONB), NOW())
      ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `;
    return Response.json({ success: true, updatedAt: data.updatedAt });
  } catch (error) {
    console.error("[api/launchpad/workspace] PUT error:", error);
    return Response.json({ error: "Couldn't save to your account." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/launchpad/workspace")({
  server: { handlers: { GET: getHandler, PUT: putHandler } },
});
