/**
 * POST /api/bids/$bidId/analyze — AI RFP Executive Summary & Requirements Extractor.
 *
 * Returns an instant executive breakdown of a single bid (plain-English summary,
 * mandatory requirements, key milestones/deadlines, primary trade, and common
 * contractor disqualifiers) so a contractor can assess an opportunity without
 * reading the full solicitation.
 *
 * FLOW:
 *   1. Require an authenticated session (never expose the paid LLM call to
 *      anonymous visitors).
 *   2. Read the bid row. If `ai_summary` is already cached, return it
 *      immediately — the LLM is NOT called again.
 *   3. Otherwise apply the rate limiter (this is a paid LLM call), generate via
 *      the shared `callAI()` helper (gpt-4o-mini, response_format=json_object),
 *      validate the output through a strict Zod schema, and persist it back to
 *      the bid's `ai_summary` / `ai_summary_at`.
 *   4. On ANY LLM or Zod failure, return a fail-safe fallback that surfaces the
 *      raw bid description rather than an error/crash — the UI must never break.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { sql } from "~/db";
import { callAI } from "~/lib/ai";
import { getUserFromRequest } from "~/lib/api-auth";
import {
  checkEmailLimit,
  checkIpLimit,
  rateLimitedResponse,
} from "~/lib/rate-limit";

/**
 * Strict Zod schema for the model's structured output. Enforced with `.strict()`
 * so any extra/unknown field the LLM invents is treated as a parse failure and
 * routed to the fail-safe fallback (never silently accepted / persisted).
 */
const AiSummarySchema = z
  .object({
    summary: z.string(),
    mandatory_requirements: z.array(z.string()),
    key_milestones: z.array(z.object({ event: z.string(), date: z.string() })),
    trade_category: z.string(),
    red_flags: z.array(z.string()),
  })
  .strict();

export type AiSummary = z.infer<typeof AiSummarySchema>;

// This is a PAID LLM call, so cap generation per account + IP (fail-open, so a
// Neon blip can never lock a real user out). Cache hits never reach the limiter
// because the cached check happens first.
const ANALYZE_IP_LIMIT = 20; // uncached generations per IP per 15 min
const ANALYZE_IP_WINDOW = 15 * 60;
const ANALYZE_EMAIL_LIMIT = 15; // uncached generations per account per 15 min
const ANALYZE_EMAIL_WINDOW = 15 * 60;

// Idempotent self-heal: ensure the ai_summary columns exist even if the
// migration hasn't been applied on a given environment yet (mirrors the lazy
// ALTER pattern documented in db/migrations/run-010.ts).
const ENSURE_COLUMNS = `
  ALTER TABLE bids ADD COLUMN IF NOT EXISTS ai_summary JSONB;
  ALTER TABLE bids ADD COLUMN IF NOT EXISTS ai_summary_at TIMESTAMPTZ;
`;

const SYSTEM_PROMPT = `You are a meticulous U.S. federal procurement analyst helping small contractors decide whether to bid. Read the solicitation and return ONLY a strict JSON object — no prose, no markdown, no code fences. The object MUST have exactly these keys:
{
  "summary": "2-3 sentence plain-English overview of the ACTUAL work being contracted (what will be built/delivered, for whom, at roughly what scope).",
  "mandatory_requirements": ["Array of concrete MUST-HAVE conditions a bidder must satisfy: licenses, certifications, insurance, bonding, SAM.gov registration, transit-compensation, security clearances, experience requirements, etc."],
  "key_milestones": [{"event": "a dated milestone such as mandatory site visit, questions/submission deadline, pre-bid conference, notice to proceed", "date": "YYYY-MM-DD or a clear description when no date is given"}],
  "trade_category": "the single primary trade, e.g. HVAC, Electrical, IT / Software, General Construction, Janitorial / Facilities, Engineering, Landscaping, or Unknown.",
  "red_flags": ["Array of common contractor disqualifiers or burdens surfaced in the notice, e.g. 'Requires 5+ years of municipal past performance', '24/7 emergency response SLA', 'Mandatory performance bond > 20%', 'Very short turnaround'. Use an EMPTY array when the notice shows none."]
}
Only include requirements, milestones, and red flags that are grounded in the provided text — never invent details.`;

interface BidRow {
  id: number;
  title: string;
  agency: string;
  description: string | null;
  category: string | null;
  set_aside: string | null;
  due_date: string | null;
  estimated_value: string | null;
  ai_summary: unknown;
  ai_summary_at: string | null;
}

/** Parse + Zod-validate the LLM's raw JSON string. Returns null on any failure. */
function parseLlmOutput(raw: string): AiSummary | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const parsed = AiSummarySchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Fail-safe summary that surfaces the raw bid description (never fabricated). */
function buildFallback(bid: Pick<BidRow, "description">): AiSummary {
  const desc = String(bid.description ?? "").trim();
  return {
    summary: desc
      ? `We couldn't generate an AI brief for this solicitation right now. Here is the raw notice summary to review: ${desc.slice(0, 1200)}`
      : "We couldn't generate an AI brief for this solicitation right now, and no full description is available in our system. Please open the original notice for details.",
    mandatory_requirements: [],
    key_milestones: [],
    trade_category: "",
    red_flags: [],
  };
}

async function handler({
  request,
  params,
}: {
  request: Request;
  params: Record<string, string>;
}) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const bidId = Number(params.bidId);
    if (!Number.isInteger(bidId) || bidId <= 0) {
      return Response.json({ error: "Invalid bid id" }, { status: 400 });
    }

    const db = sql();
    await db`${db.unsafe(ENSURE_COLUMNS)}`;

    const rows = (await db`
      SELECT id, title, agency, description, category, set_aside, due_date,
             estimated_value, ai_summary, ai_summary_at
      FROM bids
      WHERE id = ${bidId}
      LIMIT 1
    `) as Array<BidRow>;

    if (!rows.length) return Response.json({ error: "Bid not found" }, { status: 404 });
    const bid = rows[0];

    // Cached? Return immediately — do NOT pay for another LLM call.
    if (bid.ai_summary) {
      return Response.json({
        data: typeof bid.ai_summary === "string" ? JSON.parse(bid.ai_summary) : bid.ai_summary,
        cached: true,
        generated_at: bid.ai_summary_at,
      });
    }

    // Paid LLM path: enforce rate limits before spending.
    const ipLimit = await checkIpLimit(request, "analyze_ip", ANALYZE_IP_LIMIT, ANALYZE_IP_WINDOW);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);
    const acctLimit = await checkEmailLimit(user.email, "analyze_acct", ANALYZE_EMAIL_LIMIT, ANALYZE_EMAIL_WINDOW);
    if (!acctLimit.allowed) return rateLimitedResponse(acctLimit);

    const input = {
      title: String(bid.title ?? ""),
      agency: String(bid.agency ?? ""),
      description: String(bid.description ?? ""),
      category: bid.category ? String(bid.category) : undefined,
      set_aside: bid.set_aside ? String(bid.set_aside) : undefined,
      due_date: bid.due_date ? String(bid.due_date) : undefined,
      estimated_value: bid.estimated_value ? String(bid.estimated_value) : undefined,
    };

    let data: AiSummary;
    let fallback = false;
    try {
      const raw = await callAI(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Analyze this solicitation notice:\n${JSON.stringify(input)}` },
        ],
        { jsonMode: true, max_tokens: 900, temperature: 0.2 },
      );
      const parsed = parseLlmOutput(raw);
      if (!parsed) throw new Error("LLM output failed strict Zod validation");
      // Persist after a successful LLM + validation. Only the successful record
      // is cached so a later retry can attempt regeneration after a blip.
      await db`
        UPDATE bids
        SET ai_summary = ${JSON.stringify(parsed)}::jsonb, ai_summary_at = NOW()
        WHERE id = ${bid.id}
      `;
      data = parsed;
    } catch (err) {
      console.error("[api/bids/$id/analyze] generation/validation failed:", err);
      data = buildFallback(bid);
      fallback = true;
    }

    return Response.json({ data, cached: false, fallback });
  } catch (err) {
    console.error("[api/bids/$id/analyze] error:", err);
    return Response.json({ error: "Analysis unavailable" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/bids/$bidId/analyze")({
  server: { handlers: { POST: handler } },
});
