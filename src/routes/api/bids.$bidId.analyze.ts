/**
 * POST /api/bids/$bidId/analyze — AI RFP Executive Summary & Requirements Extractor.
 *
 * Returns an instant executive breakdown of a single bid (plain-English summary,
 * mandatory requirements, key milestones/deadlines, primary trade, and common
 * contractor disqualifiers) so a contractor can assess an opportunity without
 * reading the full solicitation.
 *
 * HARDENING (owner spec, 2026-08-28):
 *   1. Cache key = SHA-256 source-content hash + model + schema version (NOT
 *      bid id alone) — an amended solicitation invalidates a stale summary.
 *   2. Stores `generated_from_updated_at` so the UI can warn when the source
 *      data changed since generation.
 *   3. Treats solicitation text as UNTRUSTED data; explicit prompt-injection
 *      defense (delimiter + system instruction, nothing appended after the block).
 *   4. Every mandate / milestone / red flag carries a grounding `source`.
 *   5. Never invents missing dates — `date` is null → rendered "Not specified".
 *   6. Tiered MONTHLY allowance (owner-ratified 2026-08-29, supersedes the
 *      earlier free-tier/ungated call): per-tier monthly brief caps (Basic 1 /
 *      Starter 3 / Pro 50 / Agency 200) enforced atomically via a
 *      per-user-per-month ledger, on top of the existing IP/email/daily
 *      sub-limits. Cached views and failed (fallback) generations do NOT
 *      consume. Over-limit Basic/Starter users get the raw description + a
 *      locked preview; no generation happens.
 *   7. Lightweight telemetry (model, tokens, latency, cache status, validation
 *      failure) — never logs emails, PII, or bid full text.
 *   8. Regeneration only when stale (source changed / admin invalidated); fresh
 *      summaries are served as-is.
 *   9. SOURCE FINGERPRINT v2 (owner order 2026-09-18): the cache identity also
 *      covers `updated_at` and the newest bid_amendments.detected_at, and the
 *      rules live in ~/lib/brief-source.ts — shared with the public homepage
 *      example loader so both surfaces agree on what "fresh" means. Every
 *      previously cached summary reads as stale until regenerated (that is the
 *      intent). The generation core itself moved to ~/lib/ai-brief.ts.
 */
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { sanitizeLogString } from "~/lib/ai";
import { getUserFromRequest } from "~/lib/api-auth";
import {
  AI_MODEL,
  AI_SCHEMA_VERSION,
  buildInput,
  isFingerprintFresh,
  sourceHash,
} from "~/lib/brief-source";
import {
  buildFallback as buildBriefFallback,
  generateBriefSummary,
  storeBriefSummary,
  type AiSummary,
} from "~/lib/ai-brief";
import {
  checkEmailLimit,
  checkIpLimit,
  checkRateLimit,
  rateLimitedResponse,
} from "~/lib/rate-limit";
import {
  getAllowanceStatus,
  consumeAllowance,
  serializeAllowance,
  AI_BRIEF_LOCKED_PREVIEW,
  type AllowanceStatus,
} from "~/lib/ai-brief-allowance";
import { checkTrialCap, consumeTrial } from "~/lib/trial-usage";
import { ensureTrialStarted } from "~/lib/trial";

// Cache identity (AI_MODEL / AI_SCHEMA_VERSION), the source fingerprint, the
// strict Zod schema, the system prompt and the fallback builder all live in the
// shared modules imported above — see ~/lib/brief-source.ts and ~/lib/ai-brief.ts.
// This is a PAID LLM call, so cap generation per account + IP (fail-open, so a
// Neon blip can never lock a real user out). Cache hits never reach the limiter
// because the cached check happens first.
const ANALYZE_IP_LIMIT = 20; // uncached generations per IP per 15 min
const ANALYZE_IP_WINDOW = 15 * 60;
const ANALYZE_EMAIL_LIMIT = 15; // uncached generations per account per 15 min
const ANALYZE_EMAIL_WINDOW = 15 * 60;
// Atomic per-user DAILY cap on uncached generations (point 6). Rolled daily
// (fixed 24h window, matching the rate_limits pattern). Generous for a free
// feature while bounding spend; bump easily here.
const DAILY_GENERATION_LIMIT = 20;
const DAILY_GENERATION_WINDOW = 24 * 60 * 60; // 24h

/**
 * Over-limit response for a lower-tier (Basic/Starter) user who has exhausted
 * their monthly allowance (owner 2026-08-29). They still get the RAW
 * description, plus a locked preview with the exact owner-specified copy. The
 * full structured summary (requirements / milestones / red flags / trade) is
 * gated behind Professional+ / within-allowance. Nothing is fabricated and no
 * partial requirements leak.
 */
function lockedResponse(
  bid: Pick<BidRow, "description">,
  allowance: AllowanceStatus,
): Response {
  return Response.json(
    {
      locked: true,
      allowance: serializeAllowance(allowance),
      raw_description: String(bid.description ?? ""),
      preview: AI_BRIEF_LOCKED_PREVIEW,
    },
    { status: 200 },
  );
}


/**
 * Over-limit response for an ACTIVE Professional-trial user who has exhausted
 * their per-trial Executive Brief cap (5). They still get the RAW description
 * plus a locked preview, and are prompted to upgrade to keep generating
 * (Professional+). Nothing is fabricated and no partial requirements leak.
 */
function trialBriefLockedResponse(
  bid: Pick<BidRow, "description">,
  used: number,
  limit: number,
): Response {
  return Response.json(
    {
      locked: true,
      trial_locked: true,
      trial_remaining: Math.max(0, limit - used),
      raw_description: String(bid.description ?? ""),
      preview:
        "You've used all 5 of your trial's AI Executive Briefs. Upgrade to Professional to keep generating briefs with mandatory requirements, milestones and red flags.",
    },
    { status: 200 },
  );
}
interface BidRow {
  id: number;
  title: string;
  agency: string;
  description: string | null;
  category: string | null;
  set_aside: string | null;
  due_date: string | null;
  estimated_value: string | null;
  updated_at: string | null;
  /** Newest bid_amendments.detected_at for this bid (v2 fingerprint component). */
  latest_amendment_at: string | null;
  ai_summary: unknown;
  ai_summary_at: string | null;
  ai_summary_source_hash: string | null;
  ai_summary_schema_version: number | null;
  ai_summary_model: string | null;
  ai_summary_generated_from_updated_at: string | null;
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
    const rows = (await db`
      SELECT id, title, agency, description, category, set_aside, due_date,
             estimated_value, updated_at, ai_summary, ai_summary_at,
             ai_summary_source_hash, ai_summary_schema_version, ai_summary_model,
             ai_summary_generated_from_updated_at,
             (SELECT max(a.detected_at) FROM bid_amendments a
               WHERE a.bid_id = bids.id::text) AS latest_amendment_at
      FROM bids
      WHERE id = ${bidId}
      LIMIT 1
    `) as Array<BidRow>;
    if (!rows.length) return Response.json({ error: "Bid not found" }, { status: 404 });
    const bid = rows[0];

    // Build the untrusted source input once — reused for hashing and the LLM.
    const input = buildInput(bid);
    const currentHash = await sourceHash(input);
    // Tiered monthly allowance (owner 2026-08-29), computed here so both cached
    // and generated responses carry an honest allowance indicator.
    let allowance = await getAllowanceStatus(user.id, user);

    // Regeneration intent (point 8): the client may POST { regenerate: true }
    // only when it believes the cached summary is stale or invalidated.
    const body = (await request.json().catch(() => ({}))) as {
      regenerate?: boolean;
    };
    const wantsRegenerate = body?.regenerate === true;

    const hasSummary = bid.ai_summary != null;
    // The ONE shared definition of "fresh" (hash + schema version + model) —
    // see ~/lib/brief-source.ts. The hash now also covers updated_at and the
    // newest amendment stamp.
    const isStale = hasSummary && !isFingerprintFresh(bid, currentHash);

    const serveCached = (): Response =>
      Response.json({
        data:
          typeof bid.ai_summary === "string"
            ? JSON.parse(bid.ai_summary)
            : bid.ai_summary,
        cached: true,
        generated_at: bid.ai_summary_at,
        generated_from_updated_at: bid.ai_summary_generated_from_updated_at,
        source_updated_at: bid.updated_at,
        stale: isStale,
        allowance: serializeAllowance(allowance),
      });

    // Serve an existing summary unless regeneration is explicitly requested.
    if (hasSummary && !wantsRegenerate) return serveCached();
    // Refuse gratuitous regeneration of a FRESH summary (point 8). Only stale
    // summaries (source data changed) or admin-invalidated ones (ai_summary
    // cleared → not hasSummary) are eligible to regenerate.
    if (hasSummary && wantsRegenerate && !isStale) return serveCached();

    // ----- Paid generation path -----
    // LAZY TRIAL START BEFORE MONTHLY LEDGER (QA fix): the 14-day Professional
    // trial must be started BEFORE the monthly ai_brief_allowance ledger is read
    // and debited, so the FIRST premium brief is tiered under the active trial
    // (Professional, 50/mo) rather than the pre-start Basic (1/mo) ledger.
    // ensureTrialStarted is a cheap, idempotent, fail-open no-op for users whose
    // trial is already started or who are paid (no trial applies). Cached views
    // return above, so this only runs on the paid generation path. We re-read the
    // allowance afterwards so the over-limit gate below, the ledger debit, and the
    // response all reflect the now-active trial tier.
    await ensureTrialStarted(user.id);
    allowance = await getAllowanceStatus(user.id, user);
    // 6. Tiered monthly allowance (owner 2026-08-29). A lower-tier (Basic/
    // Starter) user who has exhausted their monthly allowance gets the raw
    // description + locked preview and NO generation happens (and nothing is
    // decremented — we don't consume on an over-limit rejection).
    if (!allowance.covered && allowance.overLimit) {
      return lockedResponse(bid, allowance);
    }
    // TRIAL CAP (owner): during an ACTIVE Professional trial the per-trial
    // Executive Brief cap (5) binds — separate from the MONTHLY allowance (the
    // monthly Professional allowance of 50/mo still applies but 5 < 50 so the
    // trial cap is the binding constraint while the trial runs). Cached /
    // re-viewed briefs are served before this point and never consume either
    // ledger. An over-cap trial user gets the raw description + locked preview
    // and a clear upgrade prompt.
    const trialBrief = await checkTrialCap(user.id, "briefs");
    if (trialBrief.trialActive && !trialBrief.allowed) {
      return trialBriefLockedResponse(bid, trialBrief.used, trialBrief.limit);
    }
    // Existing IP/email sub-limits (15-min windows).
    const ipLimit = await checkIpLimit(request, "analyze_ip", ANALYZE_IP_LIMIT, ANALYZE_IP_WINDOW);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);
    const acctLimit = await checkEmailLimit(user.email, "analyze_acct", ANALYZE_EMAIL_LIMIT, ANALYZE_EMAIL_WINDOW);
    if (!acctLimit.allowed) return rateLimitedResponse(acctLimit);
    // 6. Atomic per-user DAILY cap.
    const dailyLimit = await checkRateLimit({
      scope: "analyze_daily",
      key: `user:${user.id}`,
      limit: DAILY_GENERATION_LIMIT,
      windowSec: DAILY_GENERATION_WINDOW,
    });
    if (!dailyLimit.allowed) return rateLimitedResponse(dailyLimit);

    const startedAt = Date.now();
    const generatedFromUpdatedAt = bid.updated_at ?? new Date().toISOString();
    let data: AiSummary;
    let fallback = false;
    let validationFail: string | null = null;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    try {
      // Shared generation core (~/lib/ai-brief.ts): same prompt, same strict
      // schema, same fallback rule as the public example loader's cache repair.
      const gen = await generateBriefSummary(input, bid.description);
      promptTokens = gen.promptTokens;
      completionTokens = gen.completionTokens;
      validationFail = gen.validationFail;
      fallback = gen.fallback;
      data = gen.data;
      if (fallback) throw new Error(gen.error ?? "AI brief generation failed");
      // Persist after a successful LLM + validation (point 1/2). Only the
      // successful record is cached so a later retry can attempt regeneration.
      await storeBriefSummary({
        bidId: bid.id,
        sourceHash: currentHash,
        data,
        generatedFromUpdatedAt,
      });
    } catch (err) {
      console.error("[ai-brief]", JSON.stringify({
        event: "generation_failed",
        model: AI_MODEL,
        schema_version: AI_SCHEMA_VERSION,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        latency_ms: Date.now() - startedAt,
        cache: "generated",
        validation_fail: validationFail,
        status: (err as { status?: number } | null)?.status ?? null,
        error: sanitizeLogString(err),
      }));
      data = buildBriefFallback(bid.description);
      fallback = true;
    }
    // Consume ONE ledger unit only for a successful, non-cached, non-fallback
    // generation (owner: cached views and failed generations are free). The
    // atomic guarded increment can never overshoot the monthly cap.
    let used = allowance.used;
    if (!fallback) {
      const consumed = await consumeAllowance(user.id, allowance.tier, allowance.limit);
      if (consumed != null) used = consumed;
      // Consume ONE unit against the per-trial ledger on a successful non-cached,
      // non-fallback generation (cached views / failed generations are free).
      await consumeTrial(user.id, "briefs");
    }
    const respAllowance: AllowanceStatus = {
      ...allowance,
      used,
      remaining: Math.max(0, allowance.limit - used),
      overLimit: !allowance.covered && used >= allowance.limit,
    };

    // 7. Telemetry — structural fields only, no email/PII/bid text.
    console.log("[ai-brief]", JSON.stringify({
      event: "result",
      model: AI_MODEL,
      schema_version: AI_SCHEMA_VERSION,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      latency_ms: Date.now() - startedAt,
      cache: "generated",
      validation_fail: validationFail,
      fallback,
    }));

    return Response.json({
      data,
      cached: false,
      fallback,
      allowance: serializeAllowance(respAllowance),
    });
  } catch (err) {
    console.error("[api/bids/$id/analyze] error:", err);
    return Response.json({ error: "Analysis unavailable" }, { status: 500 });
  }
}
export const Route = createFileRoute("/api/bids/$bidId/analyze")({
  server: { handlers: { POST: handler } },
});
