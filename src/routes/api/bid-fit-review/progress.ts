import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getReviewByToken } from "~/lib/bid-fit-review-flow.server";
async function get({ request }: { request: Request }) {
  const row = await getReviewByToken((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  if (!row) return Response.json({ error: "Request link expired or unavailable" }, { status: 403 });
  const documents = await sql()`SELECT id,filename,size FROM bid_fit_review_documents WHERE request_id=${row.id} ORDER BY id`;
  return Response.json({ status: row.status, paymentStatus: row.payment_status, documents }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
export const Route = createFileRoute("/api/bid-fit-review/progress")({ server: { handlers: { GET: get } } });
