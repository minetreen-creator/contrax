import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

type Activity = { id: number; member_email: string; action: string; details: string | null; bid_title: string | null; created_at: string };
type Member = { id: number; email: string; role: string; status: string; invited_at: string };

async function ensureTables() {
  await sql()`CREATE TABLE IF NOT EXISTS team_members (id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('estimator','proposal_writer','accountant','project_manager')), status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','declined')), invited_at TIMESTAMPTZ DEFAULT NOW(), accepted_at TIMESTAMPTZ, UNIQUE(owner_id,email))`;
  await sql()`CREATE TABLE IF NOT EXISTS team_activity (id SERIAL PRIMARY KEY, member_email TEXT NOT NULL, action TEXT NOT NULL, bid_id INTEGER REFERENCES bids(id), details TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
}

async function handler({ request }: { request: Request }): Promise<Response> {
  try {
    const u = await getUserFromRequest(request);
    if (!u) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const p = await sql()`SELECT id FROM business_profiles WHERE user_id=${u.id} LIMIT 1`;
    if (!p.length) return Response.json({ error: "Only the business owner can access the workspace" }, { status: 403 });
    try { await ensureTables(); } catch { return Response.json({ allowed: true, members: [], activity: [] as Activity[] }); }
    const members = await sql()`SELECT id,email,role,status,invited_at FROM team_members WHERE owner_id=${u.id} ORDER BY invited_at DESC`;
    const emails = [u.email, ...(members as any[]).map(m => m.email)];
    const activity = await sql()`SELECT a.id,a.member_email,a.action,a.details,a.created_at,b.title AS bid_title FROM team_activity a LEFT JOIN bids b ON b.id=a.bid_id WHERE a.member_email = ANY(${emails}) ORDER BY a.created_at DESC LIMIT 50`;
    return Response.json({ allowed: true, members: members as Member[], activity: activity as Activity[] });
  } catch (err) {
    console.error("[api/workspace] error:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Workspace load failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/workspace")({ server: { handlers: { GET: handler } } });
