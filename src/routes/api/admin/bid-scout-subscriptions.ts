import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { qaUserExclusionSQL } from "~/lib/qa-exclusion";
import { ADMIN_EMAILS } from "~/lib/admin";

/**
 * GET /api/admin/bid-scout-subscriptions?status=active
 *
 * Admin-only Bid Scout fulfillment view (owner 2026-09-11, Phase B). Default
 * filter status='active'; sorts oldest active first (created_at ASC) so the
 * fulfillment team works the oldest commitments first. Returns the launch
 * columns exactly:
 *   id, user_id, email, company_name, website, capabilities, naics_codes,
 *   certifications, target_states, notes, source, status,
 *   stripe_subscription_id, created_at
 *
 * status is validated against the table's CHECK ('pending' | 'active' |
 * 'past_due' | 'cancelled'); a missing/blank status defaults to 'active'.
 * QA/admin email exclusions apply the same way they do on every admin surface
 * (never for deletion — this is read-only SELECT).
 */
const VALID_STATUSES = ["pending", "active", "past_due", "cancelled"];

export const handler = async ({ request }: { request: Request }): Promise<Response> => {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  const url = new URL(request.url);
  const rawStatus = (url.searchParams.get("status") ?? "").trim().toLowerCase();
  const status = VALID_STATUSES.includes(rawStatus) ? rawStatus : "active";

  const qaExcl = qaUserExclusionSQL("");
  const adminConds =
    ADMIN_EMAILS.size === 0
      ? "TRUE"
      : ([...ADMIN_EMAILS].map((e) => `LOWER(COALESCE(email, '')) <> '${e.toLowerCase()}'`).join(" AND "));

  const rows: any[] = await sql()`
    SELECT id, user_id, email, company_name, website, capabilities,
           naics_codes, certifications, target_states, notes, source, status,
           stripe_subscription_id, created_at
    FROM bid_scout_subscriptions
    WHERE status = ${status}
      AND ${sql().unsafe(qaExcl)} AND ${sql().unsafe(adminConds)}
    ORDER BY created_at ASC
    LIMIT 500`;
  const subscriptions = rows.map((r) => ({
    id: String(r.id),
    user_id: r.user_id != null ? String(r.user_id) : null,
    email: r.email ?? null,
    company_name: r.company_name ?? null,
    website: r.website ?? null,
    capabilities: r.capabilities ?? null,
    naics_codes: r.naics_codes ?? null,
    certifications: r.certifications ?? null,
    target_states: r.target_states ?? null,
    notes: r.notes ?? null,
    source: r.source ?? null,
    status: r.status ?? null,
    stripe_subscription_id: r.stripe_subscription_id ?? null,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
  }));

  return Response.json({ status, subscriptions });
};

export const Route = createFileRoute("/api/admin/bid-scout-subscriptions")({
  server: { handlers: { GET: handler } },
});