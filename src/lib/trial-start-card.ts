/**
 * trial-start-card — server-side context for the dashboard "Your 14-day
 * Professional trial is ready" card (R1).
 *
 * PROBLEM IT SOLVES: a trial start is NOT signup — it is the user's FIRST
 * PREMIUM ACTION (owner-ratified lazy-start semantics in ~/lib/trial.ts).
 * Today a free Basic user who finishes onboarding has no surfaced next step,
 * so they can sit on the Basic dashboard forever with trial_started_at NULL
 * and never trigger the 14-day Professional trial. This module computes the
 * honest, SSR-safe context the dashboard card needs:
 *
 *   - whether to SHOW the card (free-Basic tier, trial not started, no
 *     admin / demo / full-access-grant bypass), and
 *   - WHICH bid to analyze first (the user's #1 matched bid — same live-match
 *     predicates as /api/dashboard-data, preferring one without a cached
 *     ai_summary so the click is a REAL generation that actually starts the
 *     trial; cached views are free and never start it).
 *
 * PURELY ADDITIVE: it does NOT change lazy-start semantics in ~/lib/trial.ts
 * or ~/lib/trial-usage.ts. The card is a surface that routes the user to the
 * existing premium brief path (/api/bids/{id}/analyze); this module only
 * answers "show / which bid", and never fabricates a bid.
 */
import { sql } from "~/db";
import { loadUserTrialStatus, type TrialStatus } from "~/lib/trial";
import { LIVE_SQL, ARCHIVED_STATUSES } from "~/lib/bid-status";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { locationMatchesStates, setAsidePredMulti, naicsPred } from "~/lib/open-bids";

/** One candidate match the card could analyze first (top-5, uncached-first). */
export interface TrialStartCandidate {
  id: number;
  title: string;
  agency: string | null;
  dueDate: string | null;
  estimatedValue: string | null;
  /** True when this bid already has a cached ai_summary (a cached view is free
   *  and does NOT start the trial). */
  hasFreshSummary: boolean;
}

/** What the dashboard card needs to render honestly. */
export interface TrialStartCardData {
  /** Render the card at all (free Basic, trial not started, no bypass). */
  show: boolean;
  /** Machine-readable reason when show=false (honest observability). */
  reason: string;
  /** Candidate bids to analyze first (empty when the user has no live matches). */
  candidates: TrialStartCandidate[];
  /** Total live matches for this user (feed count, never fabricated). */
  totalMatches: number;
}

/**
 * Pure predicate — should the trial-start card render for this trial/user?
 * Show ONLY for a free-Basic user whose 14-day Professional trial has NOT
 * started: no active trial window, not expired, no full-access grant, tier
 * exactly 'basic', and no admin bypass. Every other state (paid, demo,
 * admin, active/expired trial, grant) hides the card.
 */
export function shouldShowTrialStartCard(
  trial: Pick<TrialStatus, "active" | "expired" | "fullAccess" | "planTier"> | null | undefined,
  user?: { is_admin?: boolean } | null,
): { show: boolean; reason: string } {
  if (user?.is_admin) return { show: false, reason: "admin" };
  if (!trial) return { show: false, reason: "no-trial-status" };
  if (trial.planTier !== "basic") return { show: false, reason: `tier-${trial.planTier ?? "null"}` };
  if (trial.active) return { show: false, reason: "trial-active" };
  if (trial.expired) return { show: false, reason: "trial-expired" };
  if (trial.fullAccess) return { show: false, reason: "full-access-grant" };
  return { show: true, reason: "" };
}

/**
 * Find the user's top matched bids for the card, preferring ones WITHOUT a
 * cached ai_summary so the card's one-click brief is a REAL generation (only a
 * real generation runs ensureTrialStarted → starts the clock). Mirrors the
 * dashboard feed's relevance: same LIVE_SQL + LOW_CONTENT_SQL + set-aside +
 * NAICS predicates + post-dedup location filter, ordered due-date-ascending
 * (most urgent first). Never fabricates a bid — every candidate is a real row
 * in `bids`. Read-only; throws are the caller's problem (fail-closed for the
 * card, which simply renders nothing on error — it is non-critical UI).
 */
export async function findTrialStartCandidates(
  userId: number,
): Promise<{ candidates: TrialStartCandidate[]; totalMatches: number }> {
  // Load the user's profile filters (same columns /api/dashboard-data uses).
  // A user with no profile matches nationwide with no set-aside restriction —
  // the same honest semantics as the dashboard feed itself.
  let certs: string[] = [];
  let naics: string[] = [];
  let locations: string[] = [];
  try {
    const profRows = (await sql()`
      SELECT certifications, naics_codes, locations
      FROM business_profiles
      WHERE user_id = ${userId}
      ORDER BY id DESC
      LIMIT 1
    `) as Array<{ certifications?: unknown; naics_codes?: unknown; locations?: unknown }>;
    if (profRows.length > 0) {
      const p = profRows[0];
      certs = Array.isArray(p.certifications) ? p.certifications.map(String) : [];
      naics = Array.isArray(p.naics_codes) ? p.naics_codes.map(String) : [];
      locations = Array.isArray(p.locations) ? p.locations.map(String) : [];
    }
  } catch {
    // Non-blocking: fall back to nationwide matching (same as dashboard-data).
  }
  const setAsideFrag = setAsidePredMulti(certs, sql);
  const naicsFrag = naicsPred(naics, sql);
  // Lazy migration guards (idempotent) — mirror dashboard-data so the
  // predicates can run on older databases.
  try { await sql()`ALTER TABLE bids ADD COLUMN IF NOT EXISTS set_aside TEXT`; } catch {}
  try { await sql()`ALTER TABLE bids ADD COLUMN IF NOT EXISTS naics_code TEXT`; } catch {}
  const rows = (await sql()`
    SELECT * FROM (
      SELECT DISTINCT ON (title, agency)
        id, title, agency, location, due_date, estimated_value,
        (ai_summary IS NOT NULL) AS has_fresh_summary
      FROM bids
      WHERE ${sql().unsafe(LIVE_SQL)}
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
        AND id NOT IN (
          SELECT bid_id FROM saved_matches
          WHERE user_id = ${userId} AND status = ANY(${ARCHIVED_STATUSES})
        )
        ${setAsideFrag} ${naicsFrag}
      ORDER BY title, agency
    ) matched
    ORDER BY (has_fresh_summary) ASC, due_date ASC NULLS LAST
    LIMIT 20
  `) as Array<{
    id: number;
    title: string;
    agency: string | null;
    location: string | null;
    due_date: string | Date | null;
    estimated_value: string | null;
    has_fresh_summary: boolean;
  }>;
  const all = rows.filter((b) => locationMatchesStates(b.location, locations));
  const totalMatches = all.length;
  const candidates: TrialStartCandidate[] = all.slice(0, 5).map((b) => ({
    id: Number(b.id),
    title: String(b.title ?? ""),
    agency: b.agency ? String(b.agency) : null,
    dueDate: b.due_date ? String(b.due_date) : null,
    estimatedValue: b.estimated_value ? String(b.estimated_value) : null,
    hasFreshSummary: b.has_fresh_summary === true,
  }));
  return { candidates, totalMatches };
}

/**
 * Full server-side context for the card. Used by the dashboard's
 * createServerFn (component file) AND by the R1 dry-run test (scripts/), so
 * the tested predicate is exactly what production renders from.
 */
export async function loadTrialStartCardData(
  userId: number,
  user?: { is_admin?: boolean } | null,
): Promise<TrialStartCardData> {
  const trial = await loadUserTrialStatus(userId);
  const { show, reason } = shouldShowTrialStartCard(trial, user);
  if (!show) return { show, reason, candidates: [], totalMatches: 0 };
  const { candidates, totalMatches } = await findTrialStartCandidates(userId);
  return { show: true, reason: "", candidates, totalMatches };
}