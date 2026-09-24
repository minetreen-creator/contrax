import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BID_FIT_STATUSES, ensureBidFitReviewTable } from "~/lib/bid-fit-review.server";

async function authorize(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  return null;
}

async function get({ request }: { request: Request }) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    await ensureBidFitReviewTable();
    const rows = await sql()`
      SELECT id, name, business, email, solicitation_url, capabilities, deadline,
             documents_available, status, notification_status, created_at, updated_at
      FROM bid_fit_review_requests
      ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'awaiting_payment' THEN 2 WHEN 'in_progress' THEN 3 ELSE 4 END,
               created_at ASC
      LIMIT 300`;
    return Response.json({ requests: rows });
  } catch (error) {
    console.error("[api/admin/bid-fit-reviews] list failed", error);
    return Response.json({ error: "Could not load review requests" }, { status: 500 });
  }
}

const updateSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(BID_FIT_STATUSES),
});

async function post({ request }: { request: Request }) {
  const denied = await authorize(request);
  if (denied) return denied;
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const raw = await request.text();
  if (raw.length > 1000) return Response.json({ error: "Request too large" }, { status: 413 });
  let body;
  try { body = updateSchema.safeParse(JSON.parse(raw)); }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    await ensureBidFitReviewTable();
    const rows = await sql()`
      UPDATE bid_fit_review_requests SET status = ${body.data.status}, updated_at = NOW()
      WHERE id = ${body.data.id} RETURNING id`;
    if (!rows.length) return Response.json({ error: "Request not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[api/admin/bid-fit-reviews] update failed", error);
    return Response.json({ error: "Could not update review request" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/bid-fit-reviews")({ server: { handlers: { GET: get, POST: post } } });
