import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";

/**
 * Privacy-safe anonymous Radar profile snapshot.
 *
 * The browser already sends its first-party visitor id with funnel events. This
 * endpoint stores only the four criteria the visitor deliberately searched and
 * the real match count. It stores no email, phone, IP address or user agent and
 * is fail-open at the caller so analytics can never break a Radar scan.
 */
const CERTS = new Set(["sdvosb", "8a", "wosb", "hubzone", "sb"]);
const SIZES = new Set(["under250k", "under1m", "under10m", "any"]);

async function post({ request }: { request: Request }) {
  try {
    const limit = await checkIpLimit(request, "radar_profile_ip", 60, 60 * 60);
    if (!limit.allowed) return rateLimitedResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const visitorId = typeof body?.visitor_id === "string" ? body.visitor_id.trim().slice(0, 64) : "";
    const visitId = typeof body?.visit_id === "string" ? body.visit_id.trim().slice(0, 64) : "";
    const trade = typeof body?.trade === "string" ? body.trade.trim().slice(0, 120) : "";
    const stateRaw = typeof body?.state === "string" ? body.state.trim().toUpperCase() : "";
    const state = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : "";
    const certRaw = typeof body?.cert === "string" ? body.cert : "";
    const sizeRaw = typeof body?.sizePref === "string" ? body.sizePref : "";
    const matched = typeof body?.matchedCount === "number" ? Math.floor(body.matchedCount) : -1;

    if (!visitorId || !CERTS.has(certRaw) || !SIZES.has(sizeRaw) || matched < 0 || matched > 1000) {
      return Response.json({ error: "Invalid Radar profile." }, { status: 400 });
    }

    await sql()`CREATE TABLE IF NOT EXISTS anonymous_radar_profiles (
      visitor_id TEXT PRIMARY KEY,
      visit_id TEXT,
      trade TEXT,
      state TEXT,
      cert TEXT NOT NULL,
      size_pref TEXT NOT NULL,
      matched_count INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql()`
      INSERT INTO anonymous_radar_profiles
        (visitor_id, visit_id, trade, state, cert, size_pref, matched_count)
      VALUES
        (${visitorId}, ${visitId || null}, ${trade || null}, ${state || null}, ${certRaw}, ${sizeRaw}, ${matched})
      ON CONFLICT (visitor_id) DO UPDATE SET
        visit_id = EXCLUDED.visit_id,
        trade = EXCLUDED.trade,
        state = EXCLUDED.state,
        cert = EXCLUDED.cert,
        size_pref = EXCLUDED.size_pref,
        matched_count = EXCLUDED.matched_count,
        updated_at = NOW()
    `;
    return Response.json({ success: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[api/radar/profile] save failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Unable to save Radar profile." }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/radar/profile")({
  server: { handlers: { POST: post } },
});
