import { createFileRoute } from "@tanstack/react-router";
import { checkIpLimit } from "~/lib/rate-limit";
import { MAX_TIER_LIMITS } from "~/lib/max";
import { askMax, resolveMaxTier } from "~/lib/max.server";

/**
 * POST /api/max/ask — Max, the public homepage assistant (src/lib/max.ts).
 * Body: { question, history, lang?, bid_id? }. Returns { say, cta, remindBid,
 * capability, trade, state, lang, bids, tier }.
 *
 * Tiered per IP (MAX_TIER_LIMITS, owner 2026-10-25): free visitors get a few
 * questions a day, an email unlocks more, paid plans are fair-use. Over the
 * limit: 429 { gate: "email" | "paid" | "wait" } and the page says what's next.
 */
async function handler({ request }: { request: Request }) {
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Max is offline right now." }, { status: 503 });
  const tier = await resolveMaxTier(request);
  const lim = MAX_TIER_LIMITS[tier];
  // The daily limit first: it decides the gate (email, then paid).
  for (const [scope, limit, windowSec] of [[`max_ask_day_${tier}`, lim.perDay, 86400], [`max_ask_hour_${tier}`, lim.perHour, 3600]] as const) {
    const r = await checkIpLimit(request, scope, limit, windowSec);
    if (!r.allowed) {
      const daily = scope.startsWith("max_ask_day");
      const gate = daily && tier === "free" ? "email" : daily && tier === "email" ? "paid" : "wait";
      return Response.json({ gate, tier }, { status: 429, headers: { "retry-after": String(r.retryAfterSec ?? 60) } });
    }
  }
  const body = (await request.json().catch(() => ({}))) as { question?: unknown; history?: unknown; lang?: unknown; bid_id?: unknown };
  const question = String(body.question ?? "").trim();
  if (!question) return Response.json({ error: "Ask me something" }, { status: 400 });
  const reply = await askMax({ question, history: body.history, lang: body.lang === "es" ? "es" : "en", bidId: body.bid_id, tier });
  return Response.json({ ...reply, tier });
}

export const Route = createFileRoute("/api/max/ask")({ server: { handlers: { POST: handler } } });
