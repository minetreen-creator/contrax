import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { scoreBidServer } from "~/lib/score-bid";

interface DigestEntry {
  bid_id: number; title: string; agency: string; estimated_value: string;
  win_probability: number; reason: string;
}
interface DigestResult { entries: DigestEntry[]; hasRecentBids: boolean; }

// Mirrors fetchDigest in src/routes/dashboard.tsx (migrated from a
// createServerFn client RPC that silently failed on production).
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  try {
    let activeIdForDigest: number | null = null; try { const ur = await sql()`SELECT active_profile_id FROM users WHERE id = ${user.id}`; activeIdForDigest = (ur[0] as any)?.active_profile_id ?? null; } catch {} const profiles = activeIdForDigest ? await sql()`SELECT id FROM business_profiles WHERE id = ${activeIdForDigest} AND user_id = ${user.id}` : await sql()`SELECT id FROM business_profiles WHERE user_id = ${user.id}`;
    if (!profiles.length) return Response.json({ entries: [], hasRecentBids: false });

    const recent = await sql()`SELECT id, title, agency, estimated_value FROM bids WHERE created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 7`;
    if (!recent.length) return Response.json({ entries: [], hasRecentBids: false });
    const scored: DigestEntry[] = [];
    for (const row of recent as any[]) {
      let scoreRows: any[] = [];
      try {
        scoreRows = await sql()`SELECT bid_id, win_probability, ai_explanation FROM bid_scores WHERE user_id = ${user.id} AND bid_id = ${row.id}`;
      } catch { /* scoreBid below will create/migrate the cache table */ }
      let score: any = scoreRows[0];
      if (!score) {
        try { score = await scoreBidServer({ user, bidId: Number(row.id), regenerate: false }); }
        catch { continue; }
      }
      const explanation = String(score.ai_explanation || "").trim();
      scored.push({
        bid_id: Number(row.id), title: String(row.title), agency: String(row.agency),
        estimated_value: String(row.estimated_value || "Not specified"),
        win_probability: Number(score.win_probability) || 0,
        reason: (explanation.split(/(?<=[.!?])\\s+/)[0] || "Strong fit for your business.").slice(0, 180),
      });
    }
    scored.sort((a, b) => b.win_probability - a.win_probability);
    return Response.json({ entries: scored.slice(0, 5), hasRecentBids: true });
  } catch (err) {
    console.error("[api/dashboard-digest] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load digest" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/dashboard-digest")({
  server: { handlers: { GET: handler } },
});
