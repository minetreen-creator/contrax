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
