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
export const FREE_ANONYMOUS_RADAR_RESULTS = 3;

/**
 * Free Radar scans per network before a paid plan is required (owner 2026-10-07:
 * was 1 — a Milwaukee janitorial visitor who left an email was blocked on their
 * second look — then 3; owner set it to 2 the same day).
 */
export const FREE_RADAR_PREVIEW_SCANS = 2;

/**
 * Most default (title/NAICS-corroborated) matches one Radar scan returns
 * (owner 2026-10-02; was a hard-coded 5). With a cap of 5 every popular search
 * read "5 found" and the locked card always said "Unlock 2 more", whatever the
 * real count. Anonymous visitors still see FREE_ANONYMOUS_RADAR_RESULTS; the
 * rest is the honest locked count. Must not exceed the signup handoff's
 * locked-id limit (25, src/lib/radar-handoff.server.ts).
 */
export const RADAR_MATCH_CAP = 25;
