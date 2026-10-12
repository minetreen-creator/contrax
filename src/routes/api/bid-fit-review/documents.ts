import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { getReviewByToken, validPdf, DOCUMENT_BUDGET } from "~/lib/bid-fit-review-flow.server";
import { checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";

async function get({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user?.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return new Response(null, { status: 400 });
  const rows = await sql()`SELECT filename, encode(content,'base64') AS data FROM bid_fit_review_documents WHERE id=${id}`;
  if (!rows.length) return new Response(null, { status: 404 });
  return new Response(Buffer.from(rows[0].data, "base64"), { headers: {
    "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].filename)}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}

async function post({ request }: { request: Request }) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  const review = await getReviewByToken((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
  if (!review || ["completed", "declined"].includes(review.status))
    return Response.json({ error: "Request link expired or unavailable" }, { status: 403 });
  const limit = await checkIpLimit(request, "bid_fit_documents", 15, 3600);
  if (!limit.allowed) return rateLimitedResponse(limit);
  // Bound streamed input as well as Content-Length; never trust client headers.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "No file" }, { status: 400 });
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    length += next.value.length;
    if (length > DOCUMENT_BUDGET + 10000) { await reader.cancel(); return Response.json({ error: "Maximum 3 MB per request" }, { status: 413 }); }
    chunks.push(next.value);
  }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
  catch { return Response.json({ error: "Invalid upload" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Select a PDF" }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!/\.pdf$/i.test(file.name) || !validPdf(bytes)) return Response.json({ error: "Upload a PDF, up to 3 MB total" }, { status: 400 });
  const filename = file.name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 150);
  // Atomic budget claim prevents simultaneous uploads exceeding the request limit.
  const rows = await sql()`WITH budget AS (
    UPDATE bid_fit_review_requests SET document_bytes=document_bytes+${bytes.length}, updated_at=NOW()
    WHERE id=${review.id} AND document_bytes+${bytes.length}<=${DOCUMENT_BUDGET}
      AND status NOT IN ('completed','declined') RETURNING id)
    INSERT INTO bid_fit_review_documents(request_id,filename,content,size)
    SELECT id,${filename},decode(${Buffer.from(bytes).toString("base64")},'base64'),${bytes.length} FROM budget RETURNING id`;
  if (!rows.length) return Response.json({ error: "The 3 MB total upload limit was reached" }, { status: 413 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
export const Route = createFileRoute("/api/bid-fit-review/documents")({ server: { handlers: { GET: get, POST: post } } });
