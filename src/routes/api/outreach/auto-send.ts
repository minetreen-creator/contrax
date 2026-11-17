import { createFileRoute } from "@tanstack/react-router";
import { autoSendNext, redeemSendTicket } from "~/lib/outreach.server";

/**
 * POST /api/outreach/auto-send  { ticket } → { sent, failed, skipped, left, room }
 *
 * Sends the next few waiting outreach drafts (owner 2026-11-17, away for a few days: "Send them
 * automatically"). Called only by the weekday job, which proves itself with a one-use ticket it
 * wrote to the database a moment before; anything else gets a 401. The emails are rendered, signed
 * and capped exactly as on /admin/outreach, and do-not-contact addresses are never sent.
 */
async function handler({ request }: { request: Request }) {
  const body = (await request.json().catch(() => ({}))) as { ticket?: unknown };
  const ticket = typeof body.ticket === "string" ? body.ticket : "";
  try {
    if (!(await redeemSendTicket(ticket))) return Response.json({ error: "Unauthorized" }, { status: 401 });
    return Response.json(await autoSendNext(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[outreach/auto-send] failed:", err);
    return Response.json({ error: err instanceof Error ? err.message : "Send failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/outreach/auto-send")({ server: { handlers: { POST: handler } } });
