import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { createNotification } from "~/lib/notifications";

type Role = "estimator" | "proposal_writer" | "accountant" | "project_manager";
type Member = { id: number; email: string; role: Role; status: "pending" | "active" | "declined"; invited_at: string };
const ROLES: Role[] = ["estimator", "proposal_writer", "accountant", "project_manager"];

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

// Mirrors inviteMember in src/routes/workspace.tsx (migrated from a
// createServerFn client RPC that silently failed on production).
async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
    if (!body || typeof body.email !== "string" || typeof body.role !== "string") {
      return Response.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    if (!(ROLES as string[]).includes(body.role)) {
      return Response.json({ error: "Choose a valid role" }, { status: 400 });
    }
    const u = await owner(request);
    if (email === u.email.toLowerCase()) {
      return Response.json({ error: "You cannot invite yourself" }, { status: 400 });
    }
    await ensureTables();
    const rows = await sql()`INSERT INTO team_members(owner_id,email,role) VALUES(${u.id},${email},${body.role}) RETURNING id,email,role,status,invited_at`;
    await createTeamActivityNotifications(u.id, "member_invited", email, `invited ${email} as ${body.role}`);
    return Response.json(rows[0] as Member);
  } catch (err) {
    console.error("[api/workspace-invite] error:", err);
    const msg = err instanceof Error ? err.message : "Invite failed";
    const status = msg === "Not authenticated" ? 401 : msg.startsWith("Only the business owner") ? 403 : 500;
    return Response.json({ error: msg }, { status });
  }
}

export const Route = createFileRoute("/api/workspace-invite")({
  server: { handlers: { POST: handler } },
});
