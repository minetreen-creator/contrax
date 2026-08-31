/**
 * GET /api/admin/jarvis/brain — admin-only Jarvis BRAIN snapshot (Phase 6).
 *
 * Returns the full Phase 1–5 ledger read-model (Company Health, Biggest Problem,
 * Detected-While-Away, Hypotheses, Recommendations-Waiting, Experiments,
 * Outcome / Learned / Disproven, Strategic Decisions, Unknowns, Recent Runs,
 * Actions queue, owner mode + worker consequence) — every value from real SQL
 * over the existing jarvis_* ledgers; nothing fabricated. READ-ONLY.
 *
 * Auth mirrors the other /api/admin/* routes: 401 unauthenticated, 403 non-admin.
 * The browser never sees a value that was not returned by a real query; the
 * route escapes nothing (all values render-escaped in the /jarvis/brain UI).
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { loadBrainSnapshot } from "~/lib/jarvis/brain";

async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  try {
    const db = sql();
    const snap = await loadBrainSnapshot(db);
    return Response.json(snap);
  } catch (err) {
    console.error("[api/admin/jarvis/brain] error:", err);
    return Response.json({ error: "Jarvis Brain is unavailable right now." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/jarvis/brain")({
  server: { handlers: { GET: handler } },
});
