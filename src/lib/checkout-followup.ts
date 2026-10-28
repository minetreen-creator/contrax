/**
 * Checkout follow-up (owner 2026-10-28, "someone opened checkout but 0
 * payments"): one short email to a person who reached the Stripe page for a
 * plan and left without paying. PURE: which sessions qualify and what the
 * email says. Sending lives in checkout-followup.server.ts.
 *
 * Rules: plan checkouts only (metadata.plan_tier), unpaid, started between
 * 1 and 48 hours ago; at most one follow-up per address, ever. The email
 * carries the mailing address and an unsubscribe link like outreach does.
 */

export const FOLLOWUP_AFTER_MINUTES = 60;
export const FOLLOWUP_WINDOW_HOURS = 48;

export interface CheckoutSessionLite {
  id: string;
  status: string | null;
  paymentStatus: string | null;
  /** Unix seconds, as Stripe reports it. */
  created: number;
  metadata: Record<string, string> | null;
}

/** An unpaid plan checkout old enough to follow up and not too old to matter. */
export function followupCandidate(s: CheckoutSessionLite, nowMs: number): boolean {
  if (!s.metadata?.plan_tier) return false;
  if (s.status === "complete" || s.paymentStatus === "paid") return false;
  const ageMin = (nowMs - s.created * 1000) / 60_000;
  return ageMin >= FOLLOWUP_AFTER_MINUTES && ageMin <= FOLLOWUP_WINDOW_HOURS * 60;
}

const PLAN_NAMES: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  agency: "Agency",
  savings_premium: "Savings Premium",
};

/** Where the "pick up where you left off" link goes. */
export function returnLink(metadata: Record<string, string> | null): string {
  const tier = metadata?.plan_tier ?? "starter";
  const utm = "utm_source=email&utm_medium=checkout_followup";
  if (metadata?.founding_member === "true") return `https://www.contrax.company/founding-businesses?${utm}`;
  return `https://www.contrax.company/upgrade?plan=${encodeURIComponent(tier)}&${utm}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function checkoutFollowupEmail(i: {
  metadata: Record<string, string> | null;
  postalAddress: string;
  unsubscribeUrl: string;
}): { subject: string; text: string; html: string } {
  const founding = i.metadata?.founding_member === "true";
  const plan = founding ? "the Founding Business plan" : `Contrax ${PLAN_NAMES[i.metadata?.plan_tier ?? ""] ?? "Starter"}`;
  const link = returnLink(i.metadata);
  const lines = [
    "Hi,",
    "",
    `You started checkout for ${plan} but didn't finish. No problem, nothing was charged.`,
    "",
    `If you'd like to pick up where you left off: ${link}`,
    "",
    "If something stopped you, like the price or a question about which bids we cover, just reply to this email. I read every reply myself.",
    "",
    "Nathaniel Minetree",
    "Owner and CEO, Contrax LLC",
  ];
  const footer = [`Contrax LLC, ${i.postalAddress}`, `Don't want emails like this? Unsubscribe: ${i.unsubscribeUrl}`];
  const text = [...lines, "", ...footer].join("\n");
  const html =
    lines
      .map((l) => (l === "" ? "<br>" : l.includes(link) ? `<p style="margin:0">If you'd like to pick up where you left off: <a href="${esc(link)}">${esc(link)}</a></p>` : `<p style="margin:0">${esc(l)}</p>`))
      .join("\n") +
    `\n<p style="margin-top:24px;color:#6b7280;font-size:12px">${esc(footer[0]!)}<br>Don't want emails like this? <a href="${esc(i.unsubscribeUrl)}">Unsubscribe</a></p>`;
  return { subject: "Still deciding on Contrax?", text, html };
}
