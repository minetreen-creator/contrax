/**
 * /awards — real federal contract awards: who won, for how much (owner 2026-11-08, after
 * comparing with a competitor's awards page; ours listed open bids as "awards" with
 * "Open opportunity" as the winner). PURE helpers, browser-safe.
 */
export interface FederalAward {
  awardKey: string;
  awardId: string;
  recipient: string;
  amount: number;
  startDate: string | null;
  endDate: string | null;
  agency: string | null;
  subAgency: string | null;
  description: string | null;
  state: string | null;
  naicsCode: string | null;
  naicsDescription: string | null;
}

export interface FederalAwardsSummary {
  count: number;
  total: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  topAgencies: { name: string; contracts: number; total: number }[];
  topWinners: { name: string; contracts: number; total: number }[];
}

export interface FederalAwardsData {
  q: string;
  state: string;
  summary: FederalAwardsSummary;
  /** The newest awards; a free viewer gets a short sample, members the full list. */
  awards: FederalAward[];
  paid: boolean;
  /** Rows a member sees; lets the page say how many more there are. */
  memberLimit: number;
  error?: boolean;
}

/** Awards a free viewer sees; members see AWARDS_MEMBER_ROWS. */
export const AWARDS_FREE_ROWS = 5;
export const AWARDS_MEMBER_ROWS = 50;

/** A search term (2–60 characters of letters, digits and simple punctuation), else "". PURE. */
export function cleanAwardQuery(raw: unknown): string {
  const s = String(raw ?? "")
    .replace(/[^\p{L}\p{N}\s&.,'/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return s.length >= 2 ? s : "";
}

/** ILIKE pattern with %, _ and \ escaped. PURE. */
export function awardLikePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** A two-letter state code, else "". PURE. */
export function cleanAwardState(raw: unknown): string {
  const s = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : "";
}

/** $37.8K-style compact money: $9,500, $38K, $1.3M, $12.7B. PURE. */
export function awardMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export const EMPTY_AWARDS_SUMMARY: FederalAwardsSummary = { count: 0, total: 0, median: null, p25: null, p75: null, topAgencies: [], topWinners: [] };
