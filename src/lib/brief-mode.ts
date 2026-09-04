/**
 * brief-mode — R2: surfacing the "Run my first Executive Brief" moment after a
 * radar-sourced signup.
 *
 * MECHANISM: the radar SignupGate / nudge CTAs now carry
 * `next=/dashboard?brief=1` (see src/routes/radar.tsx radarSignupHref). When a
 * visitor completes signup with that intent, the post-signup redirect lands on
 * /dashboard?brief=1, and the dashboard reads this module to (a) surface the
 * trial-start card (which is otherwise buried below the radar banners) and
 * (b) auto-attach the radar SEEN match — the visitor's own top match from the
 * anonymous radar scan — to the card as the #1 candidate to brief, so the AI
 * Executive Brief is ONE click away on exactly the bid the radar promised.
 *
 * MATCH-CONSISTENCY (owner requirement): Reuse, never invent. The card's
 * default candidate logic is ~/lib/trial-start-card.ts findTrialStartCandidates
 * (the same LIVE_SQL + LOW_CONTENT_SQL + set-aside + NAICS predicates + geo
 * filter the dashboard feed uses). This module does NOT add a ranker: it only
 * REORDERS candidates so the radar SEEN match — which the radar scan ranked
 * #1 via its own deterministic scorer over real bid fields — is offered first
 * when it is still an open bid in the DB. If the seen match is no longer open
 * (closed / not in the candidate feed), the normal top candidate applies. The
 * seen match is never fabricated: it is a server-computed radar result stored
 * in localStorage (src/lib/radar-session.ts RadarSeen).
 *
 * HONESTY: no new trial/billing behavior. The card still routes to the
 * EXISTING /api/bids/{id}/analyze path, which runs ensureTrialStarted (lazy
 * 14-day Professional trial on first premium action) + consumeTrial('briefs')
 * within the same caps (5 briefs / 3 scores / 1 draft / 3 incumbent). Cached
 * views remain free and never start the trial.
 */

import { getRadarSeen } from "~/lib/radar-session";
import type { TrialStartCandidate } from "~/lib/trial-start-card";

/** R2 funnel events (distinct names so the funnel board can measure the new cohort). */
export const BRIEF_MODE_EVENTS = {
  /** The user landed on /dashboard?brief=1 (radar-sourced post-signup). */
  landing: "radar_brief_landing",
  /** The radar SEEN (#1 from the anonymous scan) was attached to the card. */
  seenAttached: "radar_brief_seen_attached",
} as const;

/**
 * Read the `brief=1` flag from the dashboard's location search (an object of
 * params — TanStack parses the query string). Only `"1"` enables brief mode;
 * anything else is ignored.
 */
export function isBriefMode(search: Record<string, unknown> | URLSearchParams | undefined | null): boolean {
  if (!search) return false;
  const get = (k: string): string => {
    if (search instanceof URLSearchParams) return search.get(k) ?? "";
    const v = search[k];
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return String(v[0] ?? "");
    return "";
  };
  return get("brief") === "1";
}

/**
 * SSR/article-safe wrapper to read the radar SEEN match (localStorage, guarded).
 * Returns the server-computed top match of the anonymous radar scan, or null.
 */
export function readRadarTopMatch(): { id: number; title: string; score: number } | null {
  const seen = getRadarSeen();
  if (!seen) return null;
  const top = seen.matches && seen.matches.length > 0 ? seen.matches[0] : null;
  if (!top || !Number.isInteger(top.id) || top.id <= 0) return null;
  return { id: top.id, title: top.title || "", score: top.score };
}

/**
 * Reorder the trial-start card's candidates so the radar SEEN top match is
 * FIRST when it is still an open bid in the candidate set. Returns the array
 * unchanged (callers must treat it as immutable input) when there is no seen
 * match or it is not among the candidates.
 */
export function preferRadarTopMatch(
  candidates: TrialStartCandidate[],
  radarTop: { id: number } | null,
): TrialStartCandidate[] {
  if (!radarTop || candidates.length <= 1) return candidates;
  const idx = candidates.findIndex((c) => c.id === radarTop.id);
  if (idx <= 0) return candidates; // not present, or already first
  const out = candidates.slice();
  const [top] = out.splice(idx, 1);
  out.unshift(top);
  return out;
}