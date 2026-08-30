import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { runRadarScan } from "~/routes/radar";

/**
 * GET /api/saved-radar-matches — in-app fulfillment of the anonymous
 * "Save your matches" radar capture (owner direction 2026-08-30: NO email).
 *
 * When a LOGGED-IN user's account email matches a `radar_saves` row that has
 * not yet been fulfilled, this returns that saved criteria + the CURRENT
 * matching open bids, recomputed live by the SAME radar scan the /radar route
 * uses (runRadarScan). Matches are NEVER fabricated — they are recomputed from
 * the live `bids` table on every request, so the dashboard honestly shows
 * "matching bids for the criteria you saved".
 *
 * Auth-gated: only the authenticated user's own email is looked up, so no other
 * user's data can leak. Fail-open: any error returns an empty result so the
 * dashboard never breaks.
 *
 * The row id is returned for dedupe/fulfillment tracking (see
 * /api/saved-radar-fulfilled), so a row the user has already acted on does not
 * reappear on every login.
 */
const CERTS = new Set(["sdvosb", "8a", "wosb", "hubzone", "sb"]);
const SIZE_PREFS = new Set(["under250k", "under1m", "under10m", "any"]);

async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const email = user.email.trim().toLowerCase();
    if (!email) return Response.json({ hasSaved: false });

    // Lazy self-heal: ensure the fulfillment columns exist even if migration
    // 020 hasn't run in this environment yet (same pattern as /api/radar-save).
    try {
      await sql()`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ`;
      await sql()`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS fulfilled_user_id BIGINT`;
    } catch (e) {
      console.error("[api/saved-radar-matches] ensure columns:", (e as Error).message);
    }

    const rows = (await sql()`
      SELECT id, trade, state, cert, size_pref
      FROM radar_saves
      WHERE email = ${email} AND fulfilled_at IS NULL
      ORDER BY id DESC
      LIMIT 1
    `) as { id: number; trade: string | null; state: string | null; cert: string | null; size_pref: string | null }[];

    if (rows.length === 0) {
      return Response.json({ hasSaved: false, row: null, certLabel: "", matches: [], total: 0 });
    }
    const r = rows[0];
    const trade = r.trade ?? "";
    const state = r.state ?? "";
    const cert = r.cert && CERTS.has(r.cert) ? r.cert : "sb";
    const sizePref = r.size_pref && SIZE_PREFS.has(r.size_pref) ? r.size_pref : "any";

    // Reuse the /radar scan engine so matching is identical to what the
    // visitor originally saw — nothing hand-rolled, nothing fabricated.
    const scan = await runRadarScan({
      data: { trade, state, cert, sizePref },
    });
    const matches = scan.matches.map((m) => ({
      id: m.id,
      title: m.title,
      agency: m.agency,
      due_date: m.due_date,
      set_aside: m.set_aside,
      source_url: m.source_url,
      score: m.score,
      score_label: m.score_label,
    }));

    return Response.json({
      hasSaved: true,
      row: { id: Number(r.id), trade, state, cert, sizePref },
      certLabel: scan.certLabel,
      matches,
      total: matches.length,
    });
  } catch (e) {
    console.error("[api/saved-radar-matches] error:", (e as Error).message);
    // Fail-open — never break the dashboard because a lookup errored.
    return Response.json({ hasSaved: false, row: null, certLabel: "", matches: [], total: 0 });
  }
}

export const Route = createFileRoute("/api/saved-radar-matches")({
  server: { handlers: { GET: handler } },
});
