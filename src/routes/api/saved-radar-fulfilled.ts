import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";

/**
 * POST /api/saved-radar-fulfilled — marks a user's `radar_saves` row(s) as
 * fulfilled in-app (owner direction 2026-08-30: radar saves surface on login,
 * never by email).
 *
 * Called after a logged-in user successfully saves their recomputed radar
 * matches to their pipeline (from the SavedRadarMatches banner on /dashboard),
 * so the banner does not reappear on every login for a row they've already
 * acted on.
 *
 * Auth-gated: only the authenticated user's own email is updated. Idempotent:
 * COALESCE keeps the first fulfilled_at and the UPDATE only touches rows not
 * already fulfilled. No radar data leaves this endpoint.
 */
async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const email = user.email.trim().toLowerCase();
    if (!email) return Response.json({ success: false, error: "No email" }, { status: 400 });

    // Lazy self-heal: ensure the fulfillment columns exist (same pattern as
    // /api/radar-save).
    try {
      await sql()`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ`;
      await sql()`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS fulfilled_user_id BIGINT`;
    } catch (e) {
      console.error("[api/saved-radar-fulfilled] ensure columns:", (e as Error).message);
    }

    await sql()`
      UPDATE radar_saves
      SET fulfilled_at = COALESCE(fulfilled_at, NOW()),
          fulfilled_user_id = ${user.id}
      WHERE email = ${email} AND fulfilled_at IS NULL
    `;
    return Response.json({ success: true });
  } catch (e) {
    console.error("[api/saved-radar-fulfilled] error:", (e as Error).message);
    return Response.json({ success: false, error: "Something went wrong." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/saved-radar-fulfilled")({
  server: { handlers: { POST: handler } },
});
