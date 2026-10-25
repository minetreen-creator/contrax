import { createFileRoute } from "@tanstack/react-router";
import { checkIpLimit, rateLimitedResponse } from "~/lib/rate-limit";
import { askMax } from "~/lib/max.server";

/**
 * POST /api/max/ask — Max, the public homepage assistant (src/lib/max.ts).
 * Body: { question, history, lang?, bid_id? }. Returns { say, cta, remindBid, capability, trade, state, lang, bids }.
 * Public, so rate limited per IP (an hour and a day) to bound the AI bill.
 */
async function handler({ request }: { request: Request }) {
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Max is offline right now." }, { status: 503 });
  for (const [scope, limit, windowSec] of [["max_ask_hour", 25, 3600], ["max_ask_day", 80, 86400]] as const) {
    const r = await checkIpLimit(request, scope, limit, windowSec);
    if (!r.allowed) return rateLimitedResponse(r);
  }
  const body = (await request.json().catch(() => ({}))) as { question?: unknown; history?: unknown; lang?: unknown; bid_id?: unknown };
  const question = String(body.question ?? "").trim();
  if (!question) return Response.json({ error: "Ask me something" }, { status: 400 });
  return Response.json(await askMax({ question, history: body.history, lang: body.lang === "es" ? "es" : "en", bidId: body.bid_id }));
}

export const Route = createFileRoute("/api/max/ask")({ server: { handlers: { POST: handler } } });
