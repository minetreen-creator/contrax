/**
 * CONTRACT RADAR — INCUMBENT INTELLIGENCE ON FREE (PRE-SIGNUP) MATCHES.
 *
 * ⚠️ REVENUE BOUNDARY — this is the SINGLE decision point the lead/owner flips.
 *
 * The `Incumbent Intelligence` feature (previous winner + award price, backed by
 * FPDS/USAspending via `~/lib/fpds.getFPDSIntel`) is currently a PROFESSIONAL+
 * paywalled feature everywhere else in the app (`IncumbentCard`). The Contract
 * Radar spec asks to show / demo it on the free (pre-signup) radar matches, which
 * would cross that ratified revenue boundary. To keep it a one-line decision:
 *
 * OWNER-DIRECTED (2026-08-25): previous winner + award price are now shown in
 * FULL on free (pre-signup) radar matches. SHOW_FREE_INCUMBENT = true. The rest
 * of the site keeps the Professional+ incumbent paywall (IncumbentCard teaser,
 * "Reveal Incumbent & Past Pricing" modal, hasProfessionalAccess gating) — only
 * /radar shows it full on the free demo matches.
 *
 * When true, the radar fetches REAL FPDS incumbent intel per revealed bid and
 * renders the full previous-winner + award-price on free matches. When a bid
 * has no incumbent data, a graceful placeholder is shown (never fabricated).
 *
 * The only render path that reads this flag is RadarCard's incumbent block.
 */
export const SHOW_FREE_INCUMBENT = true;

/**
 * RADAR CONVERSION SPRINT (owner 2026-09-07) — ANONYMOUS RESULTS GATING.
 *
 * This is the ONE centralized constant for how many REAL matched opportunities
 * an ANONYMOUS visitor can see on the Radar results screen before the honest
 * locked-results card appears. The conversion UI never scatters a literal `3`
 * anywhere else:
 *
 *   - TOTAL_MATCHES  = real server-computed match count (as produced today)
 *   - VISIBLE_COUNT  = min(TOTAL_MATCHES, FREE_ANONYMOUS_RADAR_RESULTS)
 *   - LOCKED_COUNT   = max(TOTAL_MATCHES - FREE_ANONYMOUS_RADAR_RESULTS, 0)
 *
 * Rules (owner-brief non-negotiables): the locked card is shown ONLY when real
 * matches exceed the free cap (never a manufactured wall), the counts shown are
 * ALWAYS the real ones, and AUTHENTICATED users of any tier never see any gating
 * (they keep normal entitlement — see /radar).
 */
// Owner 2026-10-19 ("do B"): tightened from 3 to 1. Visitors see their single
// strongest match in full and the real count of the rest behind a free account.
// Owner 2026-11-03 ("yes"): back to 3. Today 17 searchers each saw 1 bid and none
// reached pricing, signup or checkout; three real bids show the list is real
// before the $5 ask.
export const FREE_ANONYMOUS_RADAR_RESULTS: number = 3;

/**
 * Owner 2026-11-18 ("yes"): visitors who arrived from Facebook see 10 bids, not
 * 3. That morning 10 phone visitors came from a South Carolina contractors
 * group, each ran one search, saw 3 of 150 and a locked card, and all 10 left
 * without opening a bid or reaching signup. Everyone else keeps the 3.
 */
export const FACEBOOK_ANONYMOUS_RADAR_RESULTS: number = 10;

/** Did this page view come from Facebook (its referrer, or a utm_source=facebook link)? PURE. */
export function isFacebookArrival(referrer: string | null | undefined, path: string | null | undefined): boolean {
  if (/^https?:\/\/([a-z0-9-]+\.)*(facebook\.com|fb\.com|fb\.me)(\/|$|\?)/i.test(String(referrer ?? "").trim())) return true;
  return /[?&]utm_source=(facebook|fb)(&|$)/i.test(String(path ?? ""));
}

/** Postgres form of isFacebookArrival for page_views (columns referrer, path). */
export const FACEBOOK_ARRIVAL_SQL =
  `(referrer ~* '^https?://([a-z0-9-]+\\.)*(facebook\\.com|fb\\.com|fb\\.me)(/|$|\\?)' OR path ~* '[?&]utm_source=(facebook|fb)(&|$)')`;

/** How many bids a signed-out visitor sees before the locked card. PURE. */
export function anonymousPreviewLimit(fromFacebook: boolean): number {
  return fromFacebook ? Math.max(FACEBOOK_ANONYMOUS_RADAR_RESULTS, FREE_ANONYMOUS_RADAR_RESULTS) : FREE_ANONYMOUS_RADAR_RESULTS;
}

/** Anonymous Radar searches per browser per day before signup (owner
 * 2026-11-03 "yes": was 1 ever; a Charlotte, NC visitor searched, checked
 * pricing, came back to search again and was sent to signup instead of bids). */
export const FREE_RADAR_PREVIEW_SCANS: number = 3;
/** Basic accounts: searches per account per day, across browsers and networks
 * (was 2 ever; never fewer than an anonymous visitor gets). Paid is unlimited. */
export const FREE_ACCOUNT_RADAR_SCANS = 5;

/**
 * Most default (title/NAICS-corroborated) matches one Radar scan returns
 * (owner 2026-10-02; was a hard-coded 5). With a cap of 5 every popular search
 * read "5 found" and the locked card always said "Unlock 2 more", whatever the
 * real count. Anonymous visitors still see FREE_ANONYMOUS_RADAR_RESULTS; the
 * rest is the honest locked count. Must not exceed the signup handoff's
 * locked-id limit (25, src/lib/radar-handoff.server.ts).
 */
export const RADAR_MATCH_CAP = 25;
