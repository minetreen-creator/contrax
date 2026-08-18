import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";

/**
 * POST /api/pending-drafts — persist a scored-but-not-saved solicitation
 * server-side, keyed to the authenticated user, so the score-page draft
 * promise survives abandoned onboarding.
 *
 * Body: { solicitation_text: string }
 *
 * Fail-open by design: this endpoint is called from signup/onboarding flows
 * that must NEVER break if the persist fails — callers treat non-2xx as
 * "no pending draft persisted" and continue. This handler itself is also
 * best-effort (dedupe + insert are wrapped).
 */
async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => null)) as { solicitation_text?: unknown } | null;
    const text = typeof body?.solicitation_text === "string" ? body.solicitation_text.trim() : "";
    if (!text) {
      return Response.json({ error: "solicitation_text is required" }, { status: 400 });
    }
    const truncated = text.slice(0, 20000);

    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

    // Lazy migration (same pattern as the business_profiles ALTERs / slack
    // tables) so this works on any database without a runner step.
    try {
      await sql()`CREATE TABLE IF NOT EXISTS pending_drafts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        solicitation_text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'awaiting_profile',
        draft_text TEXT,
        citations JSONB DEFAULT '[]'::jsonb,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        fulfilled_at TIMESTAMPTZ
      )`;
      await sql()`CREATE INDEX IF NOT EXISTS idx_pending_drafts_user_status ON pending_drafts (user_id, status)`;
    } catch {
      /* lazy DDL is best-effort */
    }

    // Dedupe: if the user already has an identical awaiting_profile row, return
    // it instead of inserting a duplicate (guards the double-fire case where a
    // persist succeeds server-side but the response is lost).
    const existing = await sql()`
      SELECT id FROM pending_drafts
      WHERE user_id = ${user.id} AND status = 'awaiting_profile' AND solicitation_text = ${truncated}
      ORDER BY id ASC LIMIT 1
    `.catch(() => []);
    if (existing.length > 0) {
      return Response.json({ id: Number((existing[0] as any).id), existing: true });
    }

    const inserted = await sql()`
      INSERT INTO pending_drafts (user_id, solicitation_text, status)
      VALUES (${user.id}, ${truncated}, 'awaiting_profile')
      RETURNING id
    `;
    return Response.json({ id: Number((inserted[0] as any).id), existing: false });
  } catch (err) {
    console.error("[api/pending-drafts] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to save pending draft" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/pending-drafts")({
  server: { handlers: { POST: handler } },
});
