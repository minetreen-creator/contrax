import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { createNotification } from "~/lib/notifications";

async function ensureTables() {
  await sql()`CREATE TABLE IF NOT EXISTS team_members (id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('estimator','proposal_writer','accountant','project_manager')), status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','declined')), invited_at TIMESTAMPTZ DEFAULT NOW(), accepted_at TIMESTAMPTZ, UNIQUE(owner_id,email))`;
  await sql()`CREATE TABLE IF NOT EXISTS team_activity (id SERIAL PRIMARY KEY, member_email TEXT NOT NULL, action TEXT NOT NULL, bid_id INTEGER REFERENCES bids(id), details TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
}

async function owner(request: Request) {
  const u = await getUserFromRequest(request);
  if (!u) throw new Error("Not authenticated");
  const p = await sql()`SELECT id FROM business_profiles WHERE user_id=${u.id} LIMIT 1`;
  if (!p.length) throw new Error("Only the business owner can access the workspace");
  return u;
}

// Mirrors createTeamActivityNotifications in src/routes/workspace.tsx.
async function createTeamActivityNotifications(ownerId: number, action: string, memberEmail: string, details: string) {
  const recipients = await sql()`SELECT ${ownerId} AS user_id UNION SELECT id AS user_id FROM users WHERE lower(email)=lower(${memberEmail}) UNION SELECT u.id AS user_id FROM users u JOIN team_members tm ON lower(tm.email)=lower(u.email) WHERE tm.owner_id=${ownerId}` as any[];
  await Promise.all(recipients.map((r) => createNotification({ userId: Number(r.user_id), type: "team_activity", title: "Team activity", message: details })));
}

// Mirrors removeMember in src/routes/workspace.tsx (migrated from a
// createServerFn client RPC that silently failed on production).
async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    if (!body || typeof body.email !== "string" || !body.email.trim()) {
      return Response.json({ error: "Invalid email" }, { status: 400 });
    }
    const u = await owner(request);
    await ensureTables();
    await sql()`DELETE FROM team_members WHERE owner_id=${u.id} AND email=${body.email}`;
    await createTeamActivityNotifications(u.id, "member_removed", body.email, `removed ${body.email} from the team`);
    return Response.json({ success: true });
  } catch (err) {
    console.error("[api/workspace-remove] error:", err);
    const msg = err instanceof Error ? err.message : "Remove failed";
    const status = msg === "Not authenticated" ? 401 : msg.startsWith("Only the business owner") ? 403 : 500;
    return Response.json({ error: msg }, { status });
  }
}

export const Route = createFileRoute("/api/workspace-remove")({
  server: { handlers: { POST: handler } },
});
