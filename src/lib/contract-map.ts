/**
 * Shared logic for the /map "U.S. Contract Map" page and its API endpoints
 * (/api/contract-map, /api/contract-map/bids).
 *
 * Everything here is PURE and client-safe (no Neon, no server-only imports) so
 * the map page can import the same state-derivation, value-parsing and
 * money-formatting the API uses — guaranteeing the overlay matches the SVG keys.
 *
 * HONESTY RULES (owner-directed, see /home/team/shared/contract-map-spec.md):
 *  - We never fabricate a state. A bid whose `location` cannot be resolved to a
 *    real US state code rolls into the "Not in a specific state" bucket (its
 *    count is reported separately, not hidden).
 *  - "Stated value" is exactly that: we sum ONLY `estimated_value` strings we
 *    can parse to a positive dollar figure. Rows we can't parse (the large
 *    majority are "Not specified") are counted in `withValue` denominator so the
 *    limitation is transparent — we never present an un-qualified exact total as
 *    if it covered every bid.
 *  - Negative dollar figures are data artifacts (e.g. "$-60,909") and are
 *    treated as not-disclosed rather than subtracted from the stated total.
 */
import { US_STATES } from "~/lib/states";

/** Canonical 2-letter codes we recognise (50 states + DC). */
const CODES = new Set<string>(US_STATES);

/** Full state name per code, for tooltips ("Virginia", "North Carolina", ...). */
export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

// name (lowercased) -> code, for the many rows whose `location` is a bare state
// name like "Virginia" or "North Carolina" rather than "City, ST".
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]),
);

/**
 * Resolve a bid's `location` string to a 2-letter US state code, or null.
 *
 * Priority (all from the SAME `location` column — we never invent a state):
 *  1. The LAST whitespace/comma-delimited token that is exactly a recognised
 *     2-letter state code (handles "Fairfax, VA", "Washington, DC", ...).
 *  2. A full state name mentioned in the string (handles bare "Virginia",
 *     "North Carolina", "District of Columbia", ...).
 * Unparseable / nationwide / empty → null (goes to the "not specified" bucket).
 * Non-state 2-letter tokens (AE, GU, MP, PR, RC, ...) are intentionally ignored.
 */
export function deriveStateCode(location: string | null | undefined): string | null {
  const loc = String(location ?? "").trim();
  if (!loc) return null;
  const tokens = loc.split(/[\s,()/]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].toUpperCase();
    if (/^[A-Z]{2}$/.test(t) && CODES.has(t)) return t;
  }
  const lower = loc.toLowerCase();
  // match "north carolina" (multi-word) with word boundaries
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    const re = new RegExp(`\\b${name.replace(" ", "\\s+")}\\b`);
    if (re.test(lower)) return code;
  }
  return null;
}

/**
 * Parse an `estimated_value` string to a positive dollar figure, or null if it
 * cannot be honestly summed.
 *
 * Handles "$5,000,000", "$680K", "$1.4M", "$2B", "$0". Rejects "Not specified",
 * "TBD", "", etc. (null). Negative amounts (artifacts like "$-60,909") return
 * null rather than distorting the stated total. Uses the FIRST numeric figure in
 * the string (conservative for the rare range-like value).
 */
export function parseStatedValue(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^(not\s*(specified|disclosed)|tbd|to\s*be\s*determined|unknown|none|n\/a|na|unavailable)$/i.test(s)) {
    return null;
  }
  const m = s.match(/-?\$?\s*([\d,]+(?:\.\d+)?)\s*([KMBkmb])?/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  const suffix = (m[2] || "").toUpperCase();
  if (suffix === "K") n *= 1_000;
  else if (suffix === "M") n *= 1_000_000;
  else if (suffix === "B") n *= 1_000_000_000;
  if (n < 0) return null; // negative = data artifact
  return n;
}

/**
 * Format a dollar figure compactly: $500, $95K, $1.4M, $218M, $5.2B.
 * Used for tooltips and headers ("stated value").
 */
export function formatCompactMoney(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${trimNum(n / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `$${trimNum(n / 1_000_000)}M`;
  if (abs >= 1_000) return `$${trimNum(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}
function trimNum(x: number): string {
  const rounded = Math.round(x * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** Shape of the per-MapDisplay aggregate returned by /api/contract-map. */
export interface StateAggregate {
  code: string;
  count: number; // open bids attributed to this state
  setAsideCount: number; // of those, how many carry a set-aside tag
  closingSoon: number; // open bids due within the next 7 days
  statedValue: number; // summed parsed positive amounts (only where parseable)
  withValue: number; // count of bids whose value we could parse (for the honest denominator)
  agencies: { name: string; count: number }[]; // most active agencies
  industries: { name: string; count: number }[]; // top industries (category)
  setAsideBreakdown: { key: string; count: number }[]; // set-aside tag counts
}

export interface ContractMapTotals {
  totalOpen: number;
  totalStates: number;
  totalStatedValue: number;
  totalWithValue: number;
  setAsideCount: number;
  unspecified: number; // open bids not attributable to a specific state
  generatedAt: string; // ISO timestamp of when the aggregate was computed
}

export interface ContractMapAggregate {
  states: Record<string, StateAggregate>;
  totals: ContractMapTotals;
}

interface OpenBidRow {
  location: string | null;
  set_aside: string | null;
  estimated_value: string | null;
  agency: string | null;
  category: string | null;
  due_date: string | Date | null;
}

/**
 * Build the full state aggregate from open bids in ONE pass.
 * `dueNow`/`in7Days` are ISO-ish values used for the closing-soon window.
 */
export function buildContractMap(rows: readonly OpenBidRow[]): ContractMapAggregate {
  const acc = new Map<string, StateAggregate>();
  const agencies = new Map<string, Map<string, number>>();
  const industries = new Map<string, Map<string, number>>();
  const setAsides = new Map<string, Map<string, number>>();
  const now = Date.now();
  const in7 = now + 7 * 24 * 60 * 60 * 1000;

  let totalOpen = 0;
  let totalStatedValue = 0;
  let totalWithValue = 0;
  let setAsideCount = 0;
  let unspecified = 0;

  const ensure = (code: string): StateAggregate => {
    let a = acc.get(code);
    if (!a) {
      a = {
        code, count: 0, setAsideCount: 0, closingSoon: 0,
        statedValue: 0, withValue: 0, agencies: [], industries: [], setAsideBreakdown: [],
      };
      acc.set(code, a);
    }
    return a;
  };

  for (const r of rows) {
    totalOpen++;
    const hasSetAside = !!(r.set_aside && String(r.set_aside).trim());
    if (hasSetAside) setAsideCount++;
    const code = deriveStateCode(r.location);
    if (!code) { unspecified++; continue; }
    const agg = ensure(code);
    agg.count++;

    if (hasSetAside) {
      agg.setAsideCount++;
      const key = String(r.set_aside).trim();
      const m = setAsides.get(code) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + 1);
      setAsides.set(code, m);
    }

    if (r.agency && String(r.agency).trim()) {
      const name = String(r.agency).trim();
      const m = agencies.get(code) ?? new Map<string, number>();
      m.set(name, (m.get(name) ?? 0) + 1);
      agencies.set(code, m);
    }

    if (r.category && String(r.category).trim()) {
      const name = String(r.category).trim();
      const m = industries.get(code) ?? new Map<string, number>();
      m.set(name, (m.get(name) ?? 0) + 1);
      industries.set(code, m);
    }

    // closing soon = due within the next 7 days
    if (r.due_date) {
      const t = new Date(r.due_date).getTime();
      if (!Number.isNaN(t) && t >= now && t <= in7) agg.closingSoon++;
    }

    const parsed = parseStatedValue(r.estimated_value);
    if (parsed != null) {
      agg.statedValue += parsed;
      agg.withValue++;
      totalStatedValue += parsed;
      totalWithValue++;
    }
  }

  for (const [code, agg] of acc) {
    agg.agencies = Array.from(agencies.get(code) ?? [])
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    agg.industries = Array.from(industries.get(code) ?? [])
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    agg.setAsideBreakdown = Array.from(setAsides.get(code) ?? [])
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }

  const states: Record<string, StateAggregate> = {};
  for (const [code, agg] of acc) states[code] = agg;

  return {
    states,
    totals: {
      totalOpen,
      totalStates: acc.size,
      totalStatedValue,
      totalWithValue,
      setAsideCount,
      unspecified,
      generatedAt: new Date().toISOString(),
    },
  };
}
