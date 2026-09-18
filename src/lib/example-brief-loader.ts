/**
 * example-brief-loader.ts — the DB-free, dependency-injected CORE of the
 * homepage / /example-brief loader (owner order 2026-09-18, follow-up to PR
 * #397).
 *
 * ── WHY THIS SPLIT EXISTS ─────────────────────────────────────────────────
 * The first pass (PR #397) repaired a stale example by awaiting the regeneration
 * INLINE with a 25 s ceiling: on the first homepage load after a fingerprint
 * change, the public `getExampleBrief` server fn could hang for up to 25 s. The
 * owner's condition on that bounded repair: an ordinary homepage request must
 * NEVER be held to a timeout. Either serve a valid regenerated brief PROMPTLY,
 * or hide the section immediately — while the regeneration keeps going so a
 * subsequent request serves the persisted result.
 *
 * So the loader is now:
 *   1. FAST PATH — a fresh, persisted, linkable brief exists ⇒ serve it. Zero
 *      repair work, zero model calls, unchanged speed.
 *   2. RECOVERY (bounded by a SHORT grace, default 2.5 s, hard cap) — start the
 *      one allowed regeneration, and if the fresh brief has persisted by the end
 *      of the grace, evaluate + serve it; otherwise return null (the homepage
 *      section hides) and let the bounded regeneration CONTINUE.
 *
 * The grace is the request's budget, not the regeneration's: the background
 * attempt keeps its own (much larger) ceiling so it is not killed mid-flight.
 *
 * ── SERVERLESS REALITY (Vercel) ───────────────────────────────────────────
 * An unawaited promise may not survive a function freeze after the response is
 * sent. That is handled, not assumed away:
 *   - the cooldown record is written BEFORE the attempt starts and lives in the
 *     serving instance's module map, so a frozen/killed attempt can never leave
 *     a "repairing forever" state — the next request on that instance waits out
 *     the cooldown (one attempt per bid per ~10 min) and then tries again, and a
 *     cold start begins with a clean map;
 *   - the recovery continuation is held in a module-level in-flight set (a live
 *     reference, its rejections already handled) so it is neither garbage
 *     collected nor an unhandled-rejection source; on a warm instance it
 *     finishes and persists;
 *   - recovery therefore CONVERGES across requests — the next homepage request
 *     (fast path) or the signed-in analyze route's stale→regenerate path serves
 *     the persisted brief. No cron, no new runner.
 *
 * Everything here is pure with respect to I/O: DB reads, the model call, the
 * notice-link check and the clock are injected, so the semantics above are unit
 * tested deterministically (tests/example-brief-recovery.test.ts).
 */
import {
  isoOrNull,
  type ExampleBidRow,
  type ExampleEvaluation,
  type ExampleSelection,
} from "~/lib/brief-source";
import type { RfpSummary } from "~/components/RfpSummaryCard";
import type { NoticeLinkStatus } from "~/lib/notice-link-check";
import { parseEnvInt } from "~/lib/notice-link-check";

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

// ─────────────────────────────────────────────────────────────────────────────
// Recovery grace — the REQUEST budget (owner: never 25 s)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long a homepage request may wait for a just-started regeneration before
 * giving up and hiding the section. Short by design (the owner's target is
 * ~2–3 s) and env-overridable exactly like the GRANTS flag helpers
 * (EXAMPLE_BRIEF_RECOVERY_GRACE_MS=true-style server-side read, no build-time
 * baking). Clamped so a bad value can neither wedge a request (max 8 s) nor
 * defeat the purpose (min 250 ms).
 */
export const EXAMPLE_BRIEF_RECOVERY_GRACE_ENV = "EXAMPLE_BRIEF_RECOVERY_GRACE_MS";
export const EXAMPLE_BRIEF_RECOVERY_GRACE_DEFAULT_MS = 2_500;
export const EXAMPLE_BRIEF_RECOVERY_GRACE_MIN_MS = 250;
export const EXAMPLE_BRIEF_RECOVERY_GRACE_MAX_MS = 8_000;

export function parseRecoveryGraceMs(env: Record<string, string | undefined>): number {
  return parseEnvInt(
    env,
    EXAMPLE_BRIEF_RECOVERY_GRACE_ENV,
    EXAMPLE_BRIEF_RECOVERY_GRACE_DEFAULT_MS,
    EXAMPLE_BRIEF_RECOVERY_GRACE_MIN_MS,
    EXAMPLE_BRIEF_RECOVERY_GRACE_MAX_MS,
  );
}

/**
 * How many ranked candidates one link-resolution pass may probe. The first
 * candidate is the normal case (one probe, then cached for the TTL); the cap
 * only bounds the pathological "everything is dead" scan.
 */
export const EXAMPLE_BRIEF_MAX_LINK_CHECKS = 3;
/** Overall wall-clock budget for one link pass (per-probe cap also applies). */
export const EXAMPLE_BRIEF_LINK_BUDGET_ENV = "EXAMPLE_BRIEF_LINK_CHECK_BUDGET_MS";
export const EXAMPLE_BRIEF_LINK_BUDGET_DEFAULT_MS = 6_000;

export function parseLinkBudgetMs(env: Record<string, string | undefined>): number {
  return parseEnvInt(
    env,
    EXAMPLE_BRIEF_LINK_BUDGET_ENV,
    EXAMPLE_BRIEF_LINK_BUDGET_DEFAULT_MS,
    500,
    15_000,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Injected dependencies
// ─────────────────────────────────────────────────────────────────────────────

export interface ExampleBriefDeps {
  /** Injected clock (ms) — keeps every wait assertionable in tests. */
  now: () => number;
  /** Pure ranking pass over the DB candidates (DB read is the caller's job). */
  loadSelection: (now: number) => Promise<ExampleSelection>;
  /** Cached, bounded notice-link check (see ~/lib/notice-link-check). */
  checkLink: (url: string, timeoutMs: number) => Promise<NoticeLinkStatus>;
  /** The one bounded regeneration for a stale-but-otherwise-eligible bid. */
  regenerate: (row: ExampleBidRow) => Promise<boolean>;
  /** Bounded cooldown gate (one attempt per bid per window). */
  repairAllowed: (bidId: number, now: number) => boolean;
  /** Record the attempt BEFORE starting it (survives an instance freeze). */
  markRepairAttempt: (bidId: number, now: number) => void;
  /** Request budget for the recovery path (never the regeneration ceiling). */
  graceMs: number;
  /** Per-probe link timeout. */
  linkTimeoutMs: number;
  /** Optional: per-link-pass wall-clock budget (defaults to the constant). */
  linkBudgetMs?: number;
  /** Optional: max candidates probed per link pass. */
  maxLinkChecks?: number;
  /** Optional structured logger. */
  log?: (event: Record<string, unknown>) => void;
}

export type ExampleBriefPath =
  | "fresh"
  | "recovered"
  | "cooldown"
  /** The regeneration is still running after the grace expired (section hides). */
  | "deferred"
  | "none";

export interface ExampleBriefLoadResult {
  brief: ExampleBrief | null;
  /** Which branch produced it — asserted by tests, useful in logs. */
  path: ExampleBriefPath;
  /** Time the request actually spent inside the loader. */
  waitedMs: number;
  /** Bid id targeted by a repair attempt (null when none was started). */
  repairTargetId: number | null;
  /** Link probes performed (proven/cached results are free). */
  linkChecks: number;
  /** Candidate ids skipped because their notice link is proven dead. */
  deadLinkIds: number[];
  /** Candidate ids whose link could not be verified inside the cap. */
  uncertainLinkIds: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Link resolution
// ─────────────────────────────────────────────────────────────────────────────

export interface LinkPick {
  chosen: ExampleEvaluation | null;
  checked: number;
  deadLinkIds: number[];
  uncertainLinkIds: number[];
}

/**
 * Walk the ranked candidates and return the first one whose ORIGINAL NOTICE
 * LINK actually resolves.
 *
 * Honesty rules (owner acceptance: the link must open; and the section must not
 * be hidden when we simply could not tell):
 *   - a candidate proven `dead` is never displayed — selection falls through to
 *     the next eligible opportunity;
 *   - a candidate we could not verify (`unknown`: timeout, network error, a
 *     bot-blocking 401/403/429) is remembered and used ONLY if no proven-live
 *     candidate is found — "healthy-link-uncertain → prefer a proven-working
 *     one; if none, still allow it rather than hide everything";
 *   - nothing verifyable at all ⇒ null (the homepage section hides honestly).
 */
export async function pickLinkableCandidate(
  evaluations: readonly ExampleEvaluation[],
  deps: Pick<ExampleBriefDeps, "checkLink" | "linkTimeoutMs" | "now">,
  opts: { maxChecks?: number; budgetMs?: number } = {},
): Promise<LinkPick> {
  const maxChecks = Math.max(1, opts.maxChecks ?? EXAMPLE_BRIEF_MAX_LINK_CHECKS);
  const budgetMs = opts.budgetMs ?? EXAMPLE_BRIEF_LINK_BUDGET_DEFAULT_MS;
  const startedAt = deps.now();

  const deadLinkIds: number[] = [];
  const uncertainLinkIds: number[] = [];
  let firstUncertain: ExampleEvaluation | null = null;
  let checked = 0;

  for (const evaluation of evaluations.slice(0, maxChecks)) {
    const url = String(evaluation.row.source_url ?? "").trim();
    if (!url) {
      // The pure rules already reject a missing link; belt and braces.
      deadLinkIds.push(Number(evaluation.row.id));
      continue;
    }
    const remaining = budgetMs - (deps.now() - startedAt);
    const timeoutMs = Math.max(250, Math.min(deps.linkTimeoutMs, remaining));
    const status = await deps.checkLink(url, timeoutMs);
    checked += 1;
    if (status === "live") {
      return { chosen: evaluation, checked, deadLinkIds, uncertainLinkIds };
    }
    if (status === "dead") {
      deadLinkIds.push(Number(evaluation.row.id));
    } else {
      uncertainLinkIds.push(Number(evaluation.row.id));
      if (!firstUncertain) firstUncertain = evaluation;
    }
    if (deps.now() - startedAt >= budgetMs) break;
  }

  return { chosen: firstUncertain, checked, deadLinkIds, uncertainLinkIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recovery continuation bookkeeping (serverless-freeze mitigation)
// ─────────────────────────────────────────────────────────────────────────────

/** Live references to in-flight recoveries: never GC'd, never unhandled. */
const inFlightRecoveries = new Set<Promise<unknown>>();

function trackRecovery(promise: Promise<unknown>): void {
  inFlightRecoveries.add(promise);
  const done = () => inFlightRecoveries.delete(promise);
  void promise.then(done, done);
}

/** Test hook: number of recoveries still running after their grace expired. */
export function __inFlightRecoveryCount(): number {
  return inFlightRecoveries.size;
}

/**
 * Resolve to `onTimeout` after `ms` WITHOUT cancelling the underlying promise —
 * the recovery continuation must survive the request that started it.
 */
async function withTimeout<T, D>(
  promise: Promise<T>,
  ms: number,
  onTimeout: D,
): Promise<T | D> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<D>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Sentinel: the grace expired before the regeneration settled. */
const GRACE_EXPIRED = Symbol("example-brief-grace-expired");

// ─────────────────────────────────────────────────────────────────────────────
// The loader
// ─────────────────────────────────────────────────────────────────────────────

/** Map a ranked evaluation to the public ExampleBrief contract. */
export function toExampleBrief(evaluation: ExampleEvaluation): ExampleBrief {
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
 * Resolve the homepage example brief. Never throws (the caller wraps errors);
 * never waits longer than `deps.graceMs` on the recovery path; performs no
 * repair and no model call on the fast path.
 */
export async function loadExampleBriefWithDeps(
  deps: ExampleBriefDeps,
): Promise<ExampleBriefLoadResult> {
  const startedAt = deps.now();
  const log = deps.log ?? (() => {});
  const budgetMs = deps.linkBudgetMs ?? EXAMPLE_BRIEF_LINK_BUDGET_DEFAULT_MS;
  const maxChecks = deps.maxLinkChecks ?? EXAMPLE_BRIEF_MAX_LINK_CHECKS;
  const linkOpts = { maxChecks, budgetMs };

  const selection = await deps.loadSelection(deps.now());

  // ── 1. FAST PATH ─────────────────────────────────────────────────────────
  // A fresh persisted brief exists: only its notice link is verified (cached per
  // URL for ~12 h). No repair, no model call, unchanged speed.
  const fresh = await pickLinkableCandidate(selection.eligible, deps, linkOpts);
  if (fresh.chosen) {
    return {
      brief: toExampleBrief(fresh.chosen),
      path: "fresh",
      waitedMs: deps.now() - startedAt,
      repairTargetId: null,
      linkChecks: fresh.checked,
      deadLinkIds: fresh.deadLinkIds,
      uncertainLinkIds: fresh.uncertainLinkIds,
    };
  }

  const baseResult = {
    waitedMs: deps.now() - startedAt,
    repairTargetId: null as number | null,
    linkChecks: fresh.checked,
    deadLinkIds: fresh.deadLinkIds,
    uncertainLinkIds: fresh.uncertainLinkIds,
  };

  // ── 2. RECOVERY (bounded by the SHORT grace; never 25 s) ─────────────────
  // Only a stale-but-otherwise-eligible bid is ever regenerated, and only if its
  // own notice link resolves (regenerating a bid we still cannot display would
  // burn a model call for nothing).
  const repairPick = await pickLinkableCandidate(selection.staleEligible, deps, linkOpts);
  baseResult.linkChecks += repairPick.checked;
  const target = repairPick.chosen;
  if (!target) {
    return { brief: null, path: "none", ...baseResult };
  }

  const now = deps.now();
  if (!deps.repairAllowed(Number(target.row.id), now)) {
    log({ event: "cache_repair_skipped", bid_id: Number(target.row.id), why: "cooldown" });
    return { brief: null, path: "cooldown", ...baseResult };
  }
  // Recorded BEFORE the attempt: if the instance is frozen mid-flight the
  // cooldown still bounds retries instead of leaving a repeating 25 s wait.
  deps.markRepairAttempt(Number(target.row.id), now);
  baseResult.repairTargetId = Number(target.row.id);

  const recovery: Promise<ExampleBrief | null> = (async () => {
    const regenerated = await deps.regenerate(target.row);
    if (!regenerated) return null;
    const after = await deps.loadSelection(deps.now());
    const pick = await pickLinkableCandidate(after.eligible, deps, linkOpts);
    return pick.chosen ? toExampleBrief(pick.chosen) : null;
  })().catch((err: unknown) => {
    log({ event: "cache_repair_failed", bid_id: Number(target.row.id), error: String(err) });
    return null;
  });
  trackRecovery(recovery);

  const outcome = await withTimeout(recovery, deps.graceMs, GRACE_EXPIRED);
  const waitedMs = deps.now() - startedAt;

  if (typeof outcome === "object" && outcome !== null) {
    log({
      event: "cache_repair",
      bid_id: Number(target.row.id),
      served_within_grace: true,
      waited_ms: waitedMs,
    });
    return { brief: outcome, path: "recovered", ...baseResult, waitedMs };
  }

  if (outcome === GRACE_EXPIRED) {
    // The rewrite did not land inside the request's budget: the section hides
    // NOW and the bounded regeneration continues in the background, so a later
    // request serves the persisted brief. The cooldown record written above
    // makes this converge even if the instance is frozen mid-flight.
    log({
      event: "cache_repair_deferred",
      bid_id: Number(target.row.id),
      grace_ms: deps.graceMs,
      waited_ms: waitedMs,
    });
    return { brief: null, path: "deferred", ...baseResult, waitedMs };
  }

  // The attempt finished inside the grace but produced no fresh brief.
  log({
    event: "cache_repair",
    bid_id: Number(target.row.id),
    served_within_grace: false,
    waited_ms: waitedMs,
  });
  return { brief: null, path: "none", ...baseResult, waitedMs };
}
