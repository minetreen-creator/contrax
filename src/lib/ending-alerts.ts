/**
 * Alerts before a contract ends (owner 2026-11-14, competitor review idea 1: push the ending
 * contract to the customer instead of waiting for them to look). PURE: which trade a subscriber's
 * alert profile means, which contracts are "just inside six months", and the email itself.
 * The sender is src/jobs/ending-alerts.ts.
 */
import { STATE_NAMES } from "~/lib/contract-map";
import { FEDERAL_TRADE_NAICS, awardUrl, formatDollars } from "~/lib/federal-trade-data";
import { tradeForText } from "~/lib/pipeline-report";
import { SEO_TRADES, SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";

/** A contract is alerted on when its end date comes inside this many days. */
export const ENDING_ALERT_DAYS = 180;
/** How far back from that edge one weekly run looks; a missed week or two is still caught. */
export const ENDING_ALERT_LOOKBACK_DAYS = 30;
export const ENDING_ALERT_PER_EMAIL = 5;
/** Shared with every other email the site sends through one 100-a-day account. */
export const ENDING_ALERT_RUN_CAP = 60;

/** The site trade behind a subscriber's stored alert profile: a Radar term, a label or a 6-digit NAICS code. */
export function alertTradeFor(profileTrade: string | null | undefined): string | null {
  const t = (profileTrade ?? "").trim();
  if (!t) return null;
  if (/^\d{6}$/.test(t)) {
    for (const s of SEO_TRADES) if ((FEDERAL_TRADE_NAICS[s.slug] ?? []).includes(t)) return s.slug;
    return null;
  }
  const lower = t.toLowerCase();
  const exact = SEO_TRADES.find((s) => s.slug === lower || s.radarTerm.toLowerCase() === lower || s.label.toLowerCase() === lower);
  return exact ? exact.slug : tradeForText(t);
}

export interface EndingRow {
  award_key: string;
  recipient_name: string;
  amount: number;
  end_date: string;
  agency: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function endingAlertEmail(i: { state: string; trade: string; rows: readonly EndingRow[]; unsubscribeUrl: string }): { subject: string; text: string; html: string } | null {
  const stateName = STATE_NAMES[i.state];
  const tradeRow = SEO_TRADE_BY_SLUG[i.trade];
  const rows = i.rows.slice(0, ENDING_ALERT_PER_EMAIL);
  if (!stateName || !tradeRow || rows.length === 0) return null;
  const what = tradeRow.label.toLowerCase();
  const n = rows.length;
  const listUrl = `https://www.contrax.company/recompetes?trade=${i.trade}&state=${i.state}&utm_source=email&utm_campaign=ending_alert`;
  const reportUrl = "https://www.contrax.company/sample-report?utm_source=email&utm_campaign=ending_alert";
  const subject = n === 1
    ? `A ${what} contract in ${stateName} ends in about 6 months`
    : `${n} ${what} contracts in ${stateName} end in about 6 months`;
  const lines = rows.map((r) => `${r.recipient_name}, ${r.agency ?? "agency not listed"}: ${formatDollars(r.amount)}, ends ${day(r.end_date)}\n${awardUrl(r.award_key)}`);
  const caution = "An ending contract is a sign to prepare, not a promise that the work will be rebid. End dates can move if an agency extends.";
  const text = [
    `${n === 1 ? "This federal contract has" : "These federal contracts have"} just come inside six months of ${n === 1 ? "its" : "their"} end date. That is usually when the agency starts planning what comes next.`,
    lines.join("\n\n"),
    `See every ${what} contract ending in ${stateName}: ${listUrl}`,
    `Want the full picture prepared for you? Read a sample report: ${reportUrl}`,
    caution,
    `You get this because you asked Contrax for ${what} alerts in ${stateName}. Unsubscribe: ${i.unsubscribeUrl}`,
  ].join("\n\n");
  const html = [
    `<p>${n === 1 ? "This federal contract has" : "These federal contracts have"} just come inside six months of ${n === 1 ? "its" : "their"} end date. That is usually when the agency starts planning what comes next.</p>`,
    `<ul>${rows.map((r) => `<li><a href="${esc(awardUrl(r.award_key))}">${esc(r.recipient_name)}</a>, ${esc(r.agency ?? "agency not listed")}: <strong>${esc(formatDollars(r.amount))}</strong>, ends ${esc(day(r.end_date))}</li>`).join("")}</ul>`,
    `<p><a href="${esc(listUrl)}">See every ${esc(what)} contract ending in ${esc(stateName)}</a></p>`,
    `<p>Want the full picture prepared for you? <a href="${esc(reportUrl)}">Read a sample report</a>.</p>`,
    `<p style="color:#555;font-size:13px">${esc(caution)}</p>`,
    `<p style="color:#555;font-size:13px">You get this because you asked Contrax for ${esc(what)} alerts in ${esc(stateName)}. <a href="${esc(i.unsubscribeUrl)}">Unsubscribe</a>.</p>`,
  ].join("");
  return { subject, text, html };
}
