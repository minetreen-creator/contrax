import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { dateOnly } from "~/lib/brief-source";
import { crmContactLink } from "~/lib/pipeline-contacts";
import { sql } from "~/db";
import { workspaceScopeClause } from "~/lib/workspaces";
import { resolveActiveWorkspaceId } from "~/lib/workspaces.server";

/**
 * GET /api/my-pipeline
 *
 * Lists the authenticated user's saved matches (status = 'saved'), joined to
 * bid info for display in the "My Pipeline" page. Auth-required: 401 without a
 * valid session cookie.
 *
 * Returns { data: PipelineItem[] } where PipelineItem is:
 *   { id, bid_id, status, created_at, title, agency, estimated_value,
 *     due_date, location, category, source_url, set_aside,
 *     crm_contact_id, crm_contact }
 *
 * crm_contact (CRM phase 2) is the contact the saved bid is linked to:
 * `{ id, name, organization }`, or null. It comes from a LEFT JOIN on
 * crm_contacts keyed `c.id = sm.crm_contact_id AND c.user_id = sm.user_id` — the
 * composite key, not the bare id, so a link can NEVER surface another user's
 * contact even if a row were mis-keyed; an unlinked bid keeps its NULL
 * crm_contact_id and comes back with crm_contact null, and every other field is
 * byte-identical to the pre-phase-2 response.
 *
 * NOTE ON THE DEPENDENCY: this statement already selects the migration-052
 * bid-workspace columns (pursuit_status / next_action / follow_up_date /
 * contact_*), so it has always required its migrations to be applied; phase 2
 * adds migration 059's column to the same list rather than papering over a
 * half-migrated database. The awards block below IS fail-open, for a different
 * reason — that table is written by a scheduled job that may not have run yet.
 */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  try {
    // The caller's ACTIVE client workspace (Agency tier, migration 068) or null: the
    // pipeline shows only the saved bids filed under the client being viewed. A
    // Starter/Professional account (and any account in its own context) is null, so
    // its pipeline is exactly what it always was.
    const workspaceId = await resolveActiveWorkspaceId(user.id);
    const rows = await sql()`
      SELECT sm.id, sm.bid_id, sm.status, sm.created_at, sm.notes,
             sm.pursuit_status, sm.next_action, sm.follow_up_date,
             sm.contact_name, sm.contact_organization, sm.contact_role, sm.contact_email,
             sm.crm_contact_id,
             c.name AS crm_contact_name, c.organization AS crm_contact_organization,
             b.title, b.agency, b.estimated_value, b.due_date, b.location,
             b.category, b.source_url, b.set_aside
      FROM saved_matches sm
      JOIN bids b ON b.id = sm.bid_id
      LEFT JOIN crm_contacts c ON c.id = sm.crm_contact_id AND c.user_id = sm.user_id
      WHERE sm.user_id = ${user.id} AND sm.status = 'saved'
        AND ${sql().unsafe(workspaceScopeClause(workspaceId, "sm"))}
      ORDER BY sm.created_at DESC NULLS LAST, b.due_date ASC NULLS LAST
    `;
    const data = (rows as any[]).map((r) => ({
      id: Number(r.id),
      bid_id: Number(r.bid_id),
      status: r.status ?? "saved",
      pursuit_status: r.pursuit_status ?? "evaluating",
      notes: r.notes ?? "",
      next_action: r.next_action ?? "",
      follow_up_date: dateOnly(r.follow_up_date),
      contact_name: r.contact_name ?? "",
      contact_organization: r.contact_organization ?? "",
      contact_role: r.contact_role ?? "",
      contact_email: r.contact_email ?? "",
      // CRM phase 2: the linked contact (null when nothing is linked). The
      // mapper is shared with the UI so both read the same wire shape.
      crm_contact_id: r.crm_contact_id == null ? null : Number(r.crm_contact_id),
      crm_contact: crmContactLink(r),
      created_at: r.created_at ? String(r.created_at) : null,
      title: r.title || "Untitled opportunity",
      agency: r.agency || "Unknown agency",
      estimated_value: r.estimated_value || "Not specified",
      due_date: dateOnly(r.due_date),
      location: r.location ?? null,
      category: r.category ?? null,
      source_url: r.source_url ?? null,
      set_aside: r.set_aside ?? null,
    }));
    // "Did I win?" awards (owner 2026-10-03). Separate, fail-open query: the
    // table is created by the daily award-check job and may not exist yet.
    try {
      const ids = data.map((d) => d.bid_id);
      if (ids.length > 0) {
        const awards = (await sql()`
          SELECT bid_id, awardee_name, amount, award_date FROM bid_award_checks
          WHERE found_at IS NOT NULL AND bid_id = ANY(${ids})
        `) as any[];
        const byBid = new Map(awards.map((a) => [Number(a.bid_id), a]));
        for (const d of data as any[]) {
          const a = byBid.get(d.bid_id);
          d.award = a
            ? { awardee_name: String(a.awardee_name), amount: a.amount != null ? Number(a.amount) : null, award_date: dateOnly(a.award_date) }
            : null;
        }
      }
    } catch {
      // no awards table yet: cards render without the award line
    }
    return Response.json({ data });
  } catch (err) {
    console.error("[api/my-pipeline] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load pipeline" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/my-pipeline")({
  server: { handlers: { GET: handler } },
});
