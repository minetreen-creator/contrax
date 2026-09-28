import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";

const statuses = ["evaluating", "preparing", "submitted", "won", "lost"] as const;
const fields = ["notes", "next_action", "contact_name", "contact_organization", "contact_role", "contact_email"] as const;

async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid request" }, { status: 400 });
  const bidId = body.bid_id;
  if (!Number.isSafeInteger(bidId) || bidId <= 0 || !statuses.includes(body.pursuit_status)) {
    return Response.json({ error: "Invalid bid or pursuit status" }, { status: 400 });
  }
  for (const key of fields) {
    if (typeof body[key] !== "string" || body[key].length > (key === "notes" ? 5000 : 300)) {
      return Response.json({ error: `Invalid ${key}` }, { status: 400 });
    }
  }
  if (body.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contact_email)) {
    return Response.json({ error: "Invalid contact email" }, { status: 400 });
  }
  const date = body.follow_up_date;
  if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
    return Response.json({ error: "Invalid follow-up date" }, { status: 400 });
  }
  try {
    const rows = await sql()`
      UPDATE saved_matches SET
        pursuit_status = ${body.pursuit_status}, notes = ${body.notes.trim()},
        next_action = ${body.next_action.trim()}, follow_up_date = ${date},
        contact_name = ${body.contact_name.trim()}, contact_organization = ${body.contact_organization.trim()},
        contact_role = ${body.contact_role.trim()}, contact_email = ${body.contact_email.trim()}
      WHERE user_id = ${user.id} AND bid_id = ${bidId} AND status = 'saved'
      RETURNING bid_id, pursuit_status, notes, next_action, follow_up_date,
                contact_name, contact_organization, contact_role, contact_email
    `;
    if (!rows.length) return Response.json({ error: "Saved bid not found" }, { status: 404 });
    const row = rows[0];
    return Response.json({ data: { ...row, bid_id: Number(row.bid_id), follow_up_date: row.follow_up_date ? String(row.follow_up_date).slice(0, 10) : null } });
  } catch (error) {
    console.error("[api/pipeline-workspace] update failed", error);
    return Response.json({ error: "Could not save bid details" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/pipeline-workspace")({
  server: { handlers: { POST: handler } },
});
