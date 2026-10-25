/**
 * /subcontracts-in/:state — one state's subcontracting work on one page (owner
 * 2026-10-23: "we need subcontracts for LV", after a Las Vegas visitor kept
 * returning to /subcontracts, which had 2 Nevada notices, both near Reno).
 *
 * PURE: state slugs, choosing which recent federal winners to show, and money
 * text. Data: state-data.ts.
 */
import { STATE_NAMES } from "~/lib/contract-map";
import type { AwardLead } from "~/lib/award-leads";

export interface StateRef {
  code: string;
  name: string;
  slug: string;
}

export const stateSlug = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

/** "nevada", "new-york" or "NV" → the state; null for anything else. */
export function stateFromSlug(raw: string): StateRef | null {
  const s = decodeURIComponent(raw || "").trim().toLowerCase();
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    if (s === code.toLowerCase() || s === stateSlug(name)) return { code, name, slug: stateSlug(name) };
  }
  return null;
}

/** Federal awards this big usually come with subcontracting work worth asking about. */
export const WINNER_MIN_AMOUNT = 250_000;
/** Winners shown free on the page; the full list is the Award Leads product. */
export const WINNERS_SHOWN = 10;
export const WINNER_DAYS = 90;

/**
 * The biggest recent awards performed in (or won by a company in) the state,
 * one row per company (its largest award), largest first.
 */
export function pickWinners(rows: readonly AwardLead[], limit = WINNERS_SHOWN): AwardLead[] {
  const best = new Map<string, AwardLead>();
  for (const r of rows) {
    if (!(r.amount >= WINNER_MIN_AMOUNT)) continue;
    const key = (r.recipient_uei || r.recipient_name).toUpperCase();
    const prev = best.get(key);
    if (!prev || r.amount > prev.amount) best.set(key, r);
  }
  return [...best.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

/** $1.2M, $640K, $25K. */
export function moneyText(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** USAspending names are all caps; "ACME BUILDERS LLC" → "Acme Builders LLC". */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Llc|Inc|Lp|Llp|Pllc|Usa|Us|Jv|Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());
}


/** A prime as the state page lists it (trimmed from the directory row). */
export interface StatePrime {
  legalName: string;
  uei: string;
  naicsLabel: string | null;
  agencies: string[];
}

/** Primes listed before "Show all" (owner 2026-10-25: M.C. Dean was #250+ of 449). */
export const PRIMES_SHOWN = 24;
/** Directory pages read for one state (100 rows each). */
export const PRIMES_MAX_PAGES = 10;

/** Letters and digits only, lowercase: "M. C. DEAN, INC." and "mc dean" meet as "mcdean". */
export function primeNameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Primes whose name contains the query (punctuation and spaces ignored). */
export function searchPrimes(primes: StatePrime[], q: string): StatePrime[] {
  const key = primeNameKey(q);
  if (!key) return primes;
  return primes.filter((p) => primeNameKey(p.legalName).includes(key));
}
