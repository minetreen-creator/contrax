/**
 * "Tell me when my trade opens" for co-op contracts (owner 2026-11-13). Co-op categories open on
 * multi-year cycles, so a visitor whose trade has nothing open today can leave an email. The daily
 * co-op sync sends ONE email only when a new category for that trade opens (never a daily email,
 * owner: "no daily email"), at most once per category, with a one-click unsubscribe. PURE.
 */
import { COOP_BY_KEY, type CoopSolicitation } from "~/lib/coop-contracts";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";

export const COOP_ALERT_UNSUBSCRIBE_URL = "https://www.contrax.company/api/coop-alert-unsubscribe";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const fmtDue = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago", timeZoneName: "short" });

export function coopAlertSubject(trade: string, items: CoopSolicitation[]): string {
  const label = SEO_TRADE_BY_SLUG[trade]?.label ?? trade;
  return items.length === 1
    ? `A ${label.toLowerCase()} co-op contract just opened for vendors`
    : `${items.length} ${label.toLowerCase()} co-op contracts just opened for vendors`;
}

/** The "your trade opened" email. Lists only what the co-op published: title, co-op, number, due time, link. */
export function coopAlertEmail(trade: string, items: CoopSolicitation[], token: string): { subject: string; html: string; text: string } {
  const label = SEO_TRADE_BY_SLUG[trade]?.label ?? trade;
  const unsub = `${COOP_ALERT_UNSUBSCRIBE_URL}?token=${encodeURIComponent(token)}`;
  const line = (s: CoopSolicitation) =>
    `${s.title} (${COOP_BY_KEY[s.coop]?.name ?? s.coop}${s.number ? `, proposal ${s.number}` : ""})${s.dueAt ? `, due ${fmtDue(s.dueAt)}` : ""}`;
  const text = [
    `A co-op category for ${label.toLowerCase()} just opened for vendors:`,
    "",
    ...items.map((s) => `- ${line(s)}\n  ${s.url}`),
    "",
    "Answer on the co-op's own site before the due time. Winning puts you on a contract that member agencies can buy from with a purchase order.",
    "All open co-op categories: https://www.contrax.company/co-op-contracts",
    "",
    `You asked Contrax to tell you when ${label.toLowerCase()} opens. Unsubscribe: ${unsub}`,
  ].join("\n");
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.12em;color:#b45309;text-transform:uppercase">Contrax · Co-op contracts</p>
<h1 style="margin:0 0 12px;font-size:22px">${esc(label)} is open for vendors</h1>
<ul style="padding-left:18px;line-height:1.5">${items
    .map((s) => `<li style="margin-bottom:8px"><a href="${esc(s.url)}" style="color:#1d4ed8;font-weight:600">${esc(s.title)}</a><br><span style="color:#475569;font-size:13px">${esc(COOP_BY_KEY[s.coop]?.name ?? s.coop)}${s.number ? ` · proposal ${esc(s.number)}` : ""}${s.dueAt ? ` · due ${esc(fmtDue(s.dueAt))}` : ""}</span></li>`)
    .join("")}</ul>
<p style="line-height:1.5">Answer on the co-op's own site before the due time. Winning puts you on a contract that member agencies can buy from with a purchase order.</p>
<p><a href="https://www.contrax.company/co-op-contracts" style="display:inline-block;background:#f59e0b;color:#0f172a;text-decoration:none;padding:10px 20px;border-radius:10px;font-weight:700">See all open co-op categories</a></p>
<p style="margin-top:24px;font-size:12px;color:#64748b">You asked Contrax to tell you when ${esc(label.toLowerCase())} opens. <a href="${esc(unsub)}" style="color:#64748b">Unsubscribe</a></p>
</div>`;
  return { subject: coopAlertSubject(trade, items), html, text };
}

/** The new, dated solicitations for a trade that this subscriber has not been told about. PURE. */
export function newForAlert(trade: string, open: CoopSolicitation[], notifiedKeys: readonly string[]): CoopSolicitation[] {
  const told = new Set(notifiedKeys);
  return open.filter((s) => s.dueAt && s.trades.includes(trade) && !told.has(s.key));
}
