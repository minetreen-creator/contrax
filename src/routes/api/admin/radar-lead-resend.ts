import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { confirmResendDecision } from "~/lib/radar-leads-funnel";

/**
 * POST /api/admin/radar-lead-resend { id } — admin only. Re-sends a pending
 * Radar lead's confirmation email (the same email and link they were first
 * sent). The address is read server-side and never returned; rules live in
 * confirmResendDecision (pending only, once per 24 hours).
 */
const MESSAGES: Record<string, string> = {
  not_found: "Lead not found.",
  already_confirmed: "This lead has already confirmed.",
  unsubscribed: "This lead unsubscribed; it can't be emailed again.",
  too_soon: "A confirmation was resent in the last 24 hours.",
};

async function post({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    const id = Number(body?.id);
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Invalid lead." }, { status: 400 });

    await sql()`ALTER TABLE radar_leads ADD COLUMN IF NOT EXISTS confirm_resent_at TIMESTAMPTZ`;
    const rows = (await sql()`
      SELECT email, unsubscribe_token, confirmed_at, unsubscribed_at, confirm_resent_at
      FROM radar_leads WHERE id = ${id} LIMIT 1
    `) as { email: string; unsubscribe_token: string; confirmed_at: string | null; unsubscribed_at: string | null; confirm_resent_at: string | null }[];
    const lead = rows[0] ?? null;
    const decision = confirmResendDecision(lead);
    if (!decision.ok) return Response.json({ error: MESSAGES[decision.reason] }, { status: 409 });

    // Claim the resend first so two quick clicks can't send twice.
    const claimed = await sql()`
      UPDATE radar_leads SET confirm_resent_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND confirmed_at IS NULL AND unsubscribed_at IS NULL
        AND (confirm_resent_at IS NULL OR confirm_resent_at < NOW() - INTERVAL '24 hours')
      RETURNING id`;
    if ((claimed as unknown[]).length === 0) return Response.json({ error: MESSAGES.too_soon }, { status: 409 });

    const { sendRadarLeadConfirmationEmail } = await import("~/lib/email");
    await sendRadarLeadConfirmationEmail(lead!.email, lead!.unsubscribe_token);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[api/admin/radar-lead-resend] failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Could not resend the confirmation." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/radar-lead-resend")({
  server: { handlers: { POST: post } },
});
