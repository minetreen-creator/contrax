/**
 * Competitor X-Ray (owner 2026-11-08: "visitors enter a local competitor's name to see the number and
 * total dollar value of public awards they hold, gating the itemized contract list … and expiration
 * dates for members").
 *
 * Source: the active federal contracts Contrax keeps from USAspending.gov (recompete_contracts:
 * recipient, amount, start/end, agency, place of performance). Federal only: city, county and state
 * awards are not in it, and the page says so. Agency contacts are not in the data, so none are
 * promised. PURE: the route does the query.
 */
export interface XrayContractRow {
  award_key: string;
  recipient_name: string;
  amount: number | string | null;
  start_date: string | null;
  end_date: string | null;
  agency: string | null;
  sub_agency: string | null;
  description: string | null;
  pop_state: string | null;
}

export interface XrayContract {
  agency: string;
  amount: number;
  start: string | null;
  end: string | null;
  description: string;
  state: string | null;
}

export interface XraySummary {
  query: string;
  /** Distinct recipient names that matched (most contracts first, at most 5). */
  names: string[];
  contracts: number;
  totalValue: number;
  /** Contracts whose end date falls within the next 12 months. */
  expiringSoon: number;
  /** States where the work is performed (most contracts first, at most 5). */
  states: string[];
}

/** A company-name search term: trimmed, 3–80 characters, else null. PURE. */
export function cleanXrayQuery(raw: unknown): string | null {
  const q = String(raw ?? "").replace(/\s+/g, " ").trim();
  return q.length >= 3 && q.length <= 80 ? q : null;
}

/** The ILIKE pattern for a name search, with % and _ in the name matched literally. PURE. */
export function xrayLikePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const YEAR_MS = 365 * 86_400_000;

/** Summarize matching rows (one contract per award; an award can sit under several trades). PURE. */
export function summarizeXray(query: string, rows: readonly XrayContractRow[], now: number = Date.now()): { summary: XraySummary; contracts: XrayContract[] } {
  const byAward = new Map<string, XrayContractRow>();
  for (const r of rows) if (!byAward.has(r.award_key)) byAward.set(r.award_key, r);
  const unique = [...byAward.values()];
  const tally = (key: (r: XrayContractRow) => string | null) => {
    const m = new Map<string, number>();
    for (const r of unique) {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  };
  const amount = (r: XrayContractRow) => {
    const n = Number(r.amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const contracts: XrayContract[] = unique
    .map((r) => ({
      agency: [r.agency, r.sub_agency].filter(Boolean).join(" · ") || "Federal agency",
      amount: amount(r),
      start: r.start_date ? String(r.start_date).slice(0, 10) : null,
      end: r.end_date ? String(r.end_date).slice(0, 10) : null,
      description: String(r.description ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      state: r.pop_state,
    }))
    .sort((a, b) => (a.end ?? "9999").localeCompare(b.end ?? "9999"));
  return {
    summary: {
      query,
      names: tally((r) => String(r.recipient_name ?? "").trim() || null),
      contracts: unique.length,
      totalValue: unique.reduce((s, r) => s + amount(r), 0),
      expiringSoon: unique.filter((r) => {
        const e = r.end_date ? Date.parse(String(r.end_date)) : NaN;
        return Number.isFinite(e) && e >= now && e - now <= YEAR_MS;
      }).length,
      states: tally((r) => r.pop_state),
    },
    contracts,
  };
}
