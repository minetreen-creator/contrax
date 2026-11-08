/**
 * Contrax Payments at the "won" moment (owner 2026-11-08: introduce Payments only after a
 * contractor wins, never next to the bid plans). The wording matches what Payments does today
 * (labor hours by job, paperwork checklist, invoice follow-ups); it does not send invoices or
 * collect payments, so nothing here says it does. PURE, browser-safe.
 */
export const PAYMENTS_MONTHLY_PRICE = 9;

export const PAYMENTS_WON_LINE = `Now that it's yours: track labor hours, paperwork and invoice follow-ups for this job with Contrax Payments, $${PAYMENTS_MONTHLY_PRICE}/month.`;

/** The Payments page, tagged with where the person came from. */
export function paymentsHref(source: "won_email" | "pipeline_won", absolute = false): string {
  return `${absolute ? "https://www.contrax.company" : ""}/contract-payments?source=${source}`;
}
