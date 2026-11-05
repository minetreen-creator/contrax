import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { decodeWatermarks } from "~/lib/bid-watermark";

/**
 * POST /api/admin/watermark { text } — admin only (owner 2026-11-05). Paste text
 * copied from another site; returns which Contrax bid-page visit each hidden
 * watermark came from (bid, time, country, browser). No IP is returned.
 */
async function post({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const tokens = decodeWatermarks(typeof body.text === "string" ? body.text.slice(0, 200_000) : "");
  if (!tokens.length) return Response.json({ found: [], note: "No Contrax watermark in that text." });
  try {
    const { lookupBidWatermarks } = await import("~/lib/bid-watermark.server");
    return Response.json({ found: await lookupBidWatermarks(tokens) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[api/admin/watermark] lookup failed:", err);
    return Response.json({ error: "Lookup failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/watermark")({ server: { handlers: { POST: post } } });
