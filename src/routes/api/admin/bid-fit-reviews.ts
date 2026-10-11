import { createFileRoute } from "@tanstack/react-router";
import { createReviewCheckout, issueReviewAccess } from "~/lib/bid-fit-review-flow.server";
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
             documents_available, status, notification_status, created_at, updated_at, payment_status, paid_at, paid_amount, checkout_url, accepted_at,
             (SELECT COALESCE(json_agg(json_build_object('id',d.id,'filename',d.filename,'size',d.size)),'[]'::json) FROM bid_fit_review_documents d WHERE d.request_id=bid_fit_review_requests.id) AS documents
      FROM bid_fit_review_requests
      ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'awaiting_payment' THEN 2 WHEN 'in_progress' THEN 3 ELSE 4 END,
               created_at ASC
      LIMIT 300`;
    return Response.json({ requests: rows }, {headers:{"Cache-Control":"private, no-store"}});
  } catch (error) {
    console.error("[api/admin/bid-fit-reviews] list failed", error);
    return Response.json({ error: "Could not load review requests" }, { status: 500 });
  }
}

const updateSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(BID_FIT_STATUSES).optional(),
  action: z.enum(["accept", "checkout", "access"]).optional(),
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
  if (!body.success || (!body.data.status && !body.data.action)) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    await ensureBidFitReviewTable();
    const { id, action, status } = body.data;
    if (action === 'access') {
      const token = await issueReviewAccess(id);
      return Response.json({ url: `https://www.contrax.company/bid-fit-review/request#${token}` }, { headers: { 'Cache-Control':'no-store' } });
    }
    if (action === 'checkout') return Response.json({ url: await createReviewCheckout(id) }, {headers:{"Cache-Control":"private, no-store"}});
    if (action === 'accept') {
      const accepted = await sql()`UPDATE bid_fit_review_requests SET accepted_at=COALESCE(accepted_at,NOW()),
        status='awaiting_payment', updated_at=NOW() WHERE id=${id} AND payment_status<>'paid'
        AND status IN ('new','reviewing','awaiting_information','awaiting_payment') RETURNING id`;
      if (!accepted.length) return Response.json({ error: 'Request cannot be accepted in its current state' }, { status:409 });
      return Response.json({ ok:true });
    }
    if (status === 'awaiting_payment') return Response.json({ error:'Use Accept review to offer payment' }, { status:400 });
    if (status === 'declined' || status === 'awaiting_information') {
      const current=await sql()`SELECT checkout_session_id,payment_status FROM bid_fit_review_requests WHERE id=${id}`;
      if(current[0]?.checkout_session_id && current[0].payment_status !== 'paid') {
        const {getStripe}=await import("~/lib/stripe");
        const session=await getStripe().checkout.sessions.retrieve(current[0].checkout_session_id);
        if(session.status==='complete') return Response.json({error:'Checkout completed; wait for payment confirmation before changing status'}, {status:409});
        if(session.status==='open') await getStripe().checkout.sessions.expire(session.id);
        await sql()`UPDATE bid_fit_review_requests SET checkout_url=NULL WHERE id=${id}`;
      }
    }
    const rows = await sql()`UPDATE bid_fit_review_requests SET status=${status},updated_at=NOW()
      WHERE id=${id} AND (${status} NOT IN ('in_progress','completed') OR payment_status='paid')
      AND (payment_status='paid' OR checkout_session_id IS NULL OR ${status} IN ('declined','awaiting_information')) RETURNING id`;
    if (!rows.length) return Response.json({ error: "Status cannot be changed: confirm payment first, or expire the open checkout in Stripe" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[api/admin/bid-fit-reviews] update failed", error);
    return Response.json({ error: "Could not update review request" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/bid-fit-reviews")({ server: { handlers: { GET: get, POST: post } } });
