import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import {
  fingerprintFor,
  selectExampleBrief,
  type ExampleBidRow,
  type ExampleSelection,
} from "~/lib/brief-source";
import {
  EXAMPLE_BRIEF_MAX_LINK_CHECKS,
  loadExampleBriefWithDeps,
  parseLinkBudgetMs,
  parseRecoveryGraceMs,
} from "~/lib/example-brief-loader";
import {
  checkNoticeLink,
  noticeLinkTimeoutMs,
  type NoticeLinkStatus,
} from "~/lib/notice-link-check";

/**
 * Shared single source of truth for loading the homepage / /example-brief
 * example AI Executive Brief.
 *
 * The brief is a REAL, PRE-GENERATED cached `ai_summary` JSONB from the bids
 * table — never fabricated on the fly. It is read here once and consumed by
 * BOTH:
 *   - the standalone route  src/routes/example-brief.tsx
 *   - the homepage embed     src/routes/index.tsx (via src/components/ExampleBrief.tsx)
 *
 * ── THE SELECTION RULES (owner order 2026-09-18, PR #397) ──────────────────
 * The old loader picked "the richest cached ai_summary" with NO freshness,
 * deadline or milestone checks, so the homepage showed a stale, internally
 * contradictory example: the card header rendered the bid's CURRENT due_date
 * ("Due Sep 23, 2026") while the cached brief still claimed the submission
 * deadline was Sep 16, 2026 and listed mandatory pre-bid meetings that had
 * already happened.
 *
 * The selection rules live in ~/lib/brief-source.ts (pure + unit tested) and
 * are applied in the owner's priority order — every candidate must be:
 *   1. open                    due_date parseable and strictly in the future
 *   2. complete                non-empty summary, ≥1 mandatory requirement,
 *                              ≥1 dated milestone
 *   3. linkable                source_url present (original notice)
 *   4. still biddable          NO binding pre-bid date in the past
 *   5. internally consistent   the cached submission-deadline milestone must
 *                              equal the record's CURRENT due_date
 *   6. FRESH                   the stored source fingerprint must match the
 *                              row's current fingerprint
 *   7. title preference        correction/amendment notices rank last
 *
 * ── TWO OWNER-REQUIRED FOLLOW-UPS (revision 226) ──────────────────────────
 *  (1) NON-BLOCKING SELF-HEAL. Adding updated_at / amendment timestamps to the
 *      fingerprint deliberately invalidates every previously cached brief, so
 *      the loader regenerates the best content-eligible example ONCE through the
 *      shared generation core (~/lib/ai-brief.ts: same prompt, same schema, same
 *      cache identity as /api/bids/:id/analyze). PR #397 did that INLINE with a
 *      25 s ceiling, which could hold a public homepage request for 25 s. Now
 *      the request side is bounded by a short GRACE
 *      (EXAMPLE_BRIEF_RECOVERY_GRACE_MS, default 2.5 s): serve the regenerated
 *      brief if it lands inside the grace, otherwise return null (the homepage
 *      section hides) while the bounded regeneration CONTINUES so the next
 *      request serves the persisted result. A fresh cached brief performs no
 *      repair work at all. Semantics live in ~/lib/example-brief-loader.ts.
 *  (2) THE ORIGINAL NOTICE LINK MUST RESOLVE. The displayed example's
 *      "Open original notice ↗" link (bid 134946, City Record
 *      /20260902028 → /Error/Error404) was dead at the publisher, which fails
 *      the owner's acceptance. A candidate whose source_url does not resolve is
 *      now INELIGIBLE and selection falls through to the next eligible bid —
 *      using the bounded, cached probe in ~/lib/notice-link-check.ts (one
 *      limited GET per URL, ~12 h cache, never on the fast path more than once
 *      per URL per TTL).
 *
 * If NO candidate survives, this returns null: the homepage embed renders
 * nothing at all (never "No example brief is available right now." — banned on
 * the homepage), while the standalone page keeps an honest fallback.
 */

export type { ExampleBrief } from "~/lib/example-brief-loader";

/** How many recent cached briefs to consider before ranking (cheap pre-sort). */
const CANDIDATE_LIMIT = 30;
/** Minimum gap between cache-repair attempts for the same bid. */
const REPAIR_COOLDOWN_MS = 10 * 60 * 1000;
/**
 * Ceiling on a BACKGROUND repair attempt so a hung upstream cannot wedge
 * anything. This is NOT the request budget any more — the homepage request is
 * bounded by EXAMPLE_BRIEF_RECOVERY_GRACE_MS (see the loader core); the
 * background attempt keeps this much larger ceiling so a slow-but-working
 * generation still completes and gets persisted.
 */
const REPAIR_BACKGROUND_TIMEOUT_MS = 25_000;

/** In-process throttle for cache repairs (per server instance). */
const repairAttempts = new Map<number, number>();

/**
 * One repair attempt per bid per cooldown window. The timestamp is written when
 * the attempt STARTS (see the loader core), so a serverless instance frozen
 * after responding cannot leave the homepage retrying the same bid forever.
 */
function repairAllowed(bidId: number, now: number): boolean {
  const last = repairAttempts.get(bidId);
  if (last !== undefined && now - last < REPAIR_COOLDOWN_MS) return false;
  if (repairAttempts.size > 64) {
    for (const [id, at] of repairAttempts) {
      if (now - at > REPAIR_COOLDOWN_MS) repairAttempts.delete(id);
    }
  }
  return true;
}

function markRepairAttempt(bidId: number, now: number): void {
  repairAttempts.set(bidId, now);
}

/**
 * Candidates: only rows that can possibly qualify — a cached brief, a future
 * due date, and a real source link. Everything else is decided in pure code.
 */
async function loadCandidates(): Promise<ExampleBidRow[]> {
  return (await sql()`
    SELECT b.id, b.title, b.agency, b.description, b.category, b.set_aside,
           b.due_date, b.source_url, b.location, b.estimated_value, b.naics_code,
           b.updated_at, b.ai_summary, b.ai_summary_at,
           b.ai_summary_source_hash, b.ai_summary_schema_version, b.ai_summary_model,
           b.ai_summary_generated_from_updated_at,
           (SELECT max(a.detected_at) FROM bid_amendments a
             WHERE a.bid_id = b.id::text) AS latest_amendment_at
    FROM bids b
    WHERE b.ai_summary IS NOT NULL
      AND b.due_date IS NOT NULL
      AND b.due_date > NOW()
      AND b.source_url IS NOT NULL
      AND btrim(b.source_url) <> ''
    ORDER BY
      (CASE WHEN jsonb_typeof(b.ai_summary->'mandatory_requirements') = 'array'
            THEN jsonb_array_length(b.ai_summary->'mandatory_requirements') ELSE 0 END
       + CASE WHEN jsonb_typeof(b.ai_summary->'red_flags') = 'array'
              THEN jsonb_array_length(b.ai_summary->'red_flags') ELSE 0 END) DESC,
      b.ai_summary_at DESC NULLS LAST
    LIMIT ${CANDIDATE_LIMIT}
  `) as unknown as ExampleBidRow[];
}

async function evaluateCandidates(now: number): Promise<ExampleSelection> {
  const rows = await loadCandidates();
  const candidates = await Promise.all(
    rows.map(async (row) => ({ row, currentFingerprint: await fingerprintFor(row) })),
  );
  return selectExampleBrief(candidates, now);
}

/**
 * Regenerate one stale example through the shared generation core. Bounded by
 * the BACKGROUND ceiling (the request side is already bounded by the grace) and
 * gated by the cooldown in the caller.
 */
async function regenerateExample(row: ExampleBidRow): Promise<boolean> {
  try {
    const { generateAndStoreBrief } = await import("~/lib/ai-brief");
    const ok = await withTimeout(
      generateAndStoreBrief({
        id: Number(row.id),
        title: row.title,
        agency: row.agency,
        description: row.description,
        category: row.category,
        set_aside: row.set_aside,
        due_date: row.due_date,
        estimated_value: row.estimated_value,
        updated_at: row.updated_at,
        latest_amendment_at: row.latest_amendment_at,
      }),
      REPAIR_BACKGROUND_TIMEOUT_MS,
      false,
    );
    return ok;
  } catch (err) {
    console.error("[example-brief] cache repair failed:", err);
    return false;
  }
}

/** Run a promise with a hard cap; resolves to `onTimeout` instead of hanging. */
async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Cached notice-link probe → status only (the loader never sees raw probes). */
async function checkLinkStatus(url: string, timeoutMs: number): Promise<NoticeLinkStatus> {
  const probe = await checkNoticeLink(url, { timeoutMs });
  return probe.status;
}

function logEvent(event: Record<string, unknown>): void {
  console.log("[example-brief]", JSON.stringify(event));
}

/**
 * Pick the best REAL, currently-open, internally consistent, LINK-RESOLVING
 * example brief. Honest — never fabricated, never stale, never a dead notice
 * link, null when nothing qualifies.
 */
export const getExampleBrief = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const env = process.env;
      const result = await loadExampleBriefWithDeps({
        now: () => Date.now(),
        loadSelection: evaluateCandidates,
        checkLink: checkLinkStatus,
        regenerate: regenerateExample,
        repairAllowed,
        markRepairAttempt,
        graceMs: parseRecoveryGraceMs(env),
        linkTimeoutMs: noticeLinkTimeoutMs(env),
        linkBudgetMs: parseLinkBudgetMs(env),
        maxLinkChecks: EXAMPLE_BRIEF_MAX_LINK_CHECKS,
        log: logEvent,
      });

      if (!result.brief) {
        // The regeneration (if any) is still running in the background; the
        // section hides for this request and the next one serves the result.
        logEvent({
          event: "no_valid_example",
          path: result.path,
          waited_ms: result.waitedMs,
          link_checks: result.linkChecks,
          dead_link_ids: result.deadLinkIds,
          uncertain_link_ids: result.uncertainLinkIds,
          repair_target: result.repairTargetId,
        });
        return null;
      }

      if (result.deadLinkIds.length > 0 || result.path !== "fresh") {
        logEvent({
          event: "example_served",
          bid_id: result.brief.id,
          path: result.path,
          waited_ms: result.waitedMs,
          link_checks: result.linkChecks,
          dead_link_ids: result.deadLinkIds,
          uncertain_link_ids: result.uncertainLinkIds,
        });
      }
      return result.brief;
    } catch (e) {
      console.error("[example-brief] load failed:", e);
      return null;
    }
  },
);
