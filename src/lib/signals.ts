/**
 * Early buying signals from local government meeting agendas (owner 2026-11-14,
 * the pivot toward sales teams). A council votes on contract renewals, awards,
 * planned solicitations and budget items weeks or months before a bid is
 * posted or a contract changes hands. This file decides which agenda items are
 * such signals. PURE; the fetching is in src/jobs/signals-probe.ts.
 */
export type SignalKind = "renewal" | "award" | "solicitation" | "budget";

export interface AgendaSignal {
  kind: SignalKind;
  /** Dollar amount named in the item, when there is one. */
  amount: number | null;
}

const PROCUREMENT = /\b(contract|agreement|purchase|procure\w*|rfp|rfq|ifb|bid|vendor|services|lease|task order|change order)\b/i;
const RENEWAL = /\b(renew\w*|extension|extend\w*|option (year|period|term)|amendment (no\.?|number|#)? ?\d+)\b/i;
const SOLICIT = /\b(request for (proposals?|qualifications|bids)|rfps?|rfqs?|invitation (for|to) bids?|ifb|solicit\w*|advertise for bids)\b/i;
const AWARD = /\b(award\w*|authoriz\w+ .{0,80}\b(contract|agreement|purchase)|execute (a|an|the)? ?(contract|agreement))\b/i;
const BUDGET = /\b(appropriat\w+|budget (amendment|transfer|adjustment)|capital improvement (plan|program)|accept\w* .{0,40}grant)\b/i;
/** Routine business that mentions a contract word without being a buying signal. */
const NOISE = /\b(minutes|proclamation|rezoning|special use permit|public comment|closed session|employment agreement|collective bargaining|settlement agreement|franchise agreement)\b/i;

/** "$1,250,000", "$1.2 million", "$750K" → dollars. The largest amount in the text. */
export function amountIn(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s?(million|billion|m\b|k\b)?/gi)) {
    let n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] ?? "").toLowerCase();
    if (unit === "million" || unit === "m") n *= 1_000_000;
    else if (unit === "billion") n *= 1_000_000_000;
    else if (unit === "k") n *= 1_000;
    if (best === null || n > best) best = n;
  }
  return best;
}

/** The buying signal in one agenda item's text, or null. Renewals first: they name work that will be re-bought. */
export function agendaSignal(text: string | null | undefined): AgendaSignal | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 15 || NOISE.test(t)) return null;
  const amount = amountIn(t);
  if (SOLICIT.test(t)) return { kind: "solicitation", amount };
  if (!PROCUREMENT.test(t)) return BUDGET.test(t) && amount !== null && amount >= 25_000 ? { kind: "budget", amount } : null;
  if (RENEWAL.test(t)) return { kind: "renewal", amount };
  if (AWARD.test(t)) return { kind: "award", amount };
  return null;
}

/** Legistar's public Web API for one client ("alexandria" → alexandria.legistar.com). */
export const LEGISTAR_API = "https://webapi.legistar.com/v1";

/** Events in a date window, soonest first. Dates are YYYY-MM-DD. */
export function legistarEventsUrl(client: string, from: string, to: string): string {
  const filter = `EventDate ge datetime'${from}' and EventDate lt datetime'${to}'`;
  return `${LEGISTAR_API}/${encodeURIComponent(client)}/events?$filter=${encodeURIComponent(filter)}&$orderby=EventDate&$top=60`;
}

export function legistarItemsUrl(client: string, eventId: number): string {
  return `${LEGISTAR_API}/${encodeURIComponent(client)}/events/${eventId}/eventitems`;
}
