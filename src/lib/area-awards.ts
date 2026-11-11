/**
 * Federal winning prices near a bid (owner 2026-11-07: "yes" to showing what
 * similar federal jobs in the trade and state went for, and who won them).
 *
 * Reads the federal contract awards already stored in `award_leads`
 * (USAspending, $25K and up). A bid with its own NAICS code is matched on that
 * code, widened to the 4-digit industry group when the exact code has too few
 * awards. A bid with no code (most city and county bids) is matched through
 * its category, and only for the categories that map cleanly to one trade.
 * "Transportation" and "Other" are left out: they mix trucking with passenger
 * transport and everything else, so any federal match would be a guess.
 */

export interface AreaAwardScope {
  /** NAICS prefixes to match (`naics_code LIKE prefix%`), tried in order. */
  prefixes: string[];
  /** Plain words for the work, e.g. "landscaping". */
  label: string;
}

const CATEGORY_SCOPES: Record<string, { prefixes: string[]; label: string }> = {
  Landscaping: { prefixes: ["561730"], label: "landscaping" },
  Janitorial: { prefixes: ["561720"], label: "janitorial" },
  HVAC: { prefixes: ["238220"], label: "HVAC and plumbing" },
  "Plumbing & Electrical": { prefixes: ["238210", "238220"], label: "electrical and plumbing" },
  Security: { prefixes: ["561612"], label: "security guard" },
  Construction: { prefixes: ["236", "237", "238"], label: "construction" },
  "IT Services": { prefixes: ["5415"], label: "IT services" },
};

/** Fewer awards than this on the exact code → widen to the industry group. */
export const AREA_AWARDS_MIN_EXACT = 3;
/** Awards listed for a paid viewer. */
export const AREA_AWARDS_LIST = 5;

/**
 * Which federal awards count as "similar work" for a bid. PURE.
 * Returns the scopes to try in order (exact code first), or [] when there is
 * no honest match.
 */
export function areaAwardScopes(
  naics: string | null | undefined,
  category: string | null | undefined,
  naicsName?: (code: string) => string | undefined,
): AreaAwardScope[] {
  const code = (naics ?? "").trim();
  if (/^\d{6}$/.test(code)) {
    const name = naicsName?.(code);
    const label = name ? name.toLowerCase() : `NAICS ${code}`;
    return [
      { prefixes: [code], label },
      { prefixes: [code.slice(0, 4)], label: `${label} and related` },
    ];
  }
  const cat = (category ?? "").trim();
  // "Construction/Construction Services" is one source's spelling of Construction.
  const c = CATEGORY_SCOPES[cat] ?? (/^Construction\b/.test(cat) ? CATEGORY_SCOPES.Construction : undefined);
  return c ? [{ prefixes: [...c.prefixes], label: c.label }] : [];
}

/** Median of whole-dollar amounts (rounded). PURE. */
export function medianAmount(amounts: number[]): number | null {
  const a = amounts.filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return Math.round(a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2);
}

/** "$1.2M", "$480K", "$25K". PURE. */
export function shortDollars(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/**
 * A size estimate and where it came from. "nation" means the state had too few contracts, so the
 * range is from the same kind of work across the country (owner 2026-11-11: "Do the fallback").
 */
export interface TypicalSize {
  low: number;
  high: number;
  scope: "state" | "nation";
  /** Contracts the range was taken from. */
  count: number;
}

/** Fewer awards than this → no size estimate (a range from a handful of contracts is a guess). */
export const AREA_AWARDS_MIN_RANGE = 5;

/**
 * The typical contract size for a set of awards: the 25th and 75th percentile, or null when the
 * set is too small or the numbers are unusable. PURE.
 */
export function typicalRange(total: number, p25: unknown, p75: unknown): { low: number; high: number } | null {
  const low = Math.round(Number(p25));
  const high = Math.round(Number(p75));
  if (total < AREA_AWARDS_MIN_RANGE || !Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low) return null;
  return { low, high };
}

/** "$80K to $420K", or one figure when both ends round the same. PURE. */
export function typicalRangeText(t: { low: number; high: number }): string {
  const a = shortDollars(t.low);
  const b = shortDollars(t.high);
  return a === b ? `about ${a}` : `${a} to ${b}`;
}

export interface AreaAward {
  winner: string;
  amount: number;
  agency: string | null;
  awardedOn: string | null;
  url: string;
}

export interface AreaAwards {
  /** Plain words for the work matched. */
  label: string;
  state: string;
  total: number;
  /** Earliest award date in the set (YYYY-MM-DD). */
  since: string | null;
  /**
   * The middle half of those awards (25th to 75th percentile), shown to everyone as an estimate of
   * contract size (owner 2026-11-11: "add the budget estimate"). null when there are too few awards.
   */
  typical: TypicalSize | null;
  /** Paid viewers only; null for everyone else. */
  detail: { median: number; low: number; high: number; awards: AreaAward[] } | null;
}
