import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import type { RfpSummary } from "~/components/RfpSummaryCard";
import {
  fingerprintFor,
  isoOrNull,
  selectExampleBrief,
  type ExampleBidRow,
  type ExampleEvaluation,
} from "~/lib/brief-source";

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
 * ── WHY THIS FILE CHANGED (owner order 2026-09-18) ─────────────────────────
 * The old loader picked "the richest cached ai_summary" with NO freshness,
 * deadline or milestone checks, so the homepage showed a stale, internally
 * contradictory example: the card header rendered the bid's CURRENT due_date
 * ("Due Sep 23, 2026") while the cached brief still claimed the submission
 * deadline was Sep 16, 2026 and listed mandatory pre-bid meetings that had
 * already happened.
 *
 * The selection rules now live in ~/lib/brief-source.ts (pure + unit tested) and
 * are applied in the owner's priority order — every candidate must be:
 *   1. open                    due_date parseable and strictly in the future
 *                              (rank: ≥7 days remaining preferred),
 *   2. complete                non-empty summary, ≥1 mandatory requirement,
 *                              ≥1 dated milestone,
 *   3. linkable                source_url present (original notice),
 *   4. still biddable          NO binding pre-bid date (mandatory site visit /
 *                              pre-bid conference / Q&A deadline) in the past,
 *   5. internally consistent   the cached submission-deadline milestone must
 *                              equal the record's CURRENT due_date,
 *   6. FRESH                   the stored source fingerprint (hash + model +
 *                              schema version, now including updated_at and the
 *                              newest amendment stamp) must match the row's
 *                              current fingerprint — stale cached briefs are
 *                              never displayed,
 *   7. title preference        correction/amendment notices rank last.
 *
 * If NO candidate survives, this returns null: the homepage embed renders
 * nothing at all (never "No example brief is available right now." — banned on
 * the homepage), while the standalone page keeps an honest fallback.
 *
 * ── STALE CACHE REPAIR ────────────────────────────────────────────────────
 * Adding updated_at / amendment timestamps to the fingerprint deliberately
 * invalidates every previously cached brief (owner: "existing cached summaries
 * will be treated stale until regenerated. That is the intent"). To keep the
 * homepage section alive — instead of hiding forever until some signed-in user
 * happens to press "Regenerate" — when no fresh candidate exists the loader
 * regenerates the best content-eligible example ONCE through the shared
 * generation core (~/lib/ai-brief.ts: same prompt, same schema, same cache
 * identity as /api/bids/:id/analyze). It is bounded: one attempt per bid per
 * cooldown window, it only ever runs for a candidate that already passed every
 * content check above, and a successful generation is persisted, so the next
 * load (and every other surface) is fresh with no further calls.
 */

export interface ExampleBrief {
  id: number;
  title: string;
  agency: string | null;
  set_aside: string | null;
  due_date: string | null;
  source_url: string | null;
  location: string | null;
  estimated_value: string | null;
  summary: RfpSummary | null;
  /** Real NAICS code from the bids row — used as a trade fallback when the
   *  brief's `trade_category` is missing or "Unknown". */
  naics_code: string | null;
  generatedAt: string | null;
}

/** How many recent cached briefs to consider before ranking (cheap pre-sort). */
const CANDIDATE_LIMIT = 30;
/** Minimum gap between cache-repair attempts for the same bid. */
const REPAIR_COOLDOWN_MS = 10 * 60 * 1000;
/** Hard cap on a repair attempt so a hung upstream can never wedge the loader. */
const REPAIR_TIMEOUT_MS = 25_000;

/** In-process throttle for cache repairs (per server instance). */
const repairAttempts = new Map<number, number>();

function repairAllowed(bidId: number, now: number): boolean {
  const last = repairAttempts.get(bidId);
  if (last !== undefined && now - last < REPAIR_COOLDOWN_MS) return false;
  if (repairAttempts.size > 64) {
    for (const [id, at] of repairAttempts) {
      if (now - at > REPAIR_COOLDOWN_MS) repairAttempts.delete(id);
    }
  }
  repairAttempts.set(bidId, now);
  return true;
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

async function evaluateCandidates(now: number) {
  const rows = await loadCandidates();
  const candidates = await Promise.all(
    rows.map(async (row) => ({ row, currentFingerprint: await fingerprintFor(row) })),
  );
  return selectExampleBrief(candidates, now);
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

/**
 * Regenerate the best content-eligible example whose cached brief is stale
 * (fingerprint changed) so the homepage has a fresh, internally consistent
 * example to show. Returns true when a fresh brief is now cached.
 */
async function repairStaleExample(target: ExampleEvaluation): Promise<boolean> {
  if (!repairAllowed(target.row.id, Date.now())) return false;
  try {
    const { generateAndStoreBrief } = await import("~/lib/ai-brief");
    const row = target.row;
    const ok = await withTimeout(
      generateAndStoreBrief({
        id: row.id,
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
      REPAIR_TIMEOUT_MS,
      false,
    );
    console.log(
      "[example-brief]",
      JSON.stringify({
        event: "cache_repair",
        bid_id: row.id,
        due_date: isoOrNull(row.due_date),
        ok,
      }),
    );
    return ok;
  } catch (err) {
    console.error("[example-brief] cache repair failed:", err);
    return false;
  }
}

/** Map a ranked evaluation to the public ExampleBrief contract. */
function toExampleBrief(evaluation: ExampleEvaluation): ExampleBrief {
  const r = evaluation.row;
  return {
    id: Number(r.id),
    title: String(r.title ?? ""),
    agency: r.agency ? String(r.agency) : null,
    set_aside: r.set_aside ? String(r.set_aside) : null,
    due_date: isoOrNull(r.due_date),
    source_url: r.source_url ? String(r.source_url) : null,
    location: r.location ? String(r.location) : null,
    estimated_value: r.estimated_value ? String(r.estimated_value) : null,
    summary: evaluation.summary,
    naics_code: r.naics_code ? String(r.naics_code) : null,
    generatedAt: isoOrNull(r.ai_summary_at),
  };
}

/**
 * Pick the best REAL, currently-open, internally consistent example brief.
 * Honest — never fabricated, never stale, null when nothing qualifies.
 */
export const getExampleBrief = createServerFn({ method: "GET" }).handler(
  async (): Promise<ExampleBrief | null> => {
    try {
      let selection = await evaluateCandidates(Date.now());

      // No fresh example? Repair the best content-eligible one once (bounded),
      // then re-evaluate. Nothing else is ever displayed.
      if (!selection.best && selection.staleEligible.length > 0) {
        const repaired = await repairStaleExample(selection.staleEligible[0]);
        if (repaired) selection = await evaluateCandidates(Date.now());
      }

      if (!selection.best) {
        console.log(
          "[example-brief]",
          JSON.stringify({
            event: "no_valid_example",
            considered: selection.all.length,
            reasons: selection.all.map((e) => ({ id: e.row.id, why: e.reasons })),
          }),
        );
        return null;
      }
      return toExampleBrief(selection.best);
    } catch (e) {
      console.error("[example-brief] load failed:", e);
      return null;
    }
  },
);
