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
 *   - SHOW_FREE_INCUMBENT = false (DEFAULT, recommended by the lead)
 *       → the radar card renders a TEASER for previous winner + award price
 *         ("unlock with your free account"), preserving the Professional+
 *         paywall. The incumbent lookup is NOT performed at all, so the scan
 *         stays fast and makes no cross-boundary claim.
 *   - SHOW_FREE_INCUMBENT = true
 *       → the radar fetches REAL FPDS incumbent intel per revealed bid and
 *         renders the full previous-winner + award-price on free matches.
 *
 * Flip here and re-run the build. Everything else on the free matches (match %,
 * why-qualifies, requirements, next action, real deadline countdown) is shown
 * fully regardless — that is the value demo.
 *
 * The only render path that reads this flag is RadarCard's incumbent block.
 */
export const SHOW_FREE_INCUMBENT = false;
