/**
 * Customer dashboard cockpit (owner 2026-11-06: a procurement-dashboard look —
 * big numbers with context, a map, a table — for the contractor's own matches).
 * PURE: counts from the bids /api/dashboard-data already returns. Never invents
 * a number; a bid with no state or no stated value is simply left out of that
 * figure.
 */
import { resolveBidState } from "~/lib/location-state";

export interface CockpitBid {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  category: string | null;
  due_date: string | null;
  estimated_value: string | null;
  created_at: string | null;
}

export interface CockpitTradeRow {
  trade: string;
  count: number;
  /** Open bids in this trade that close within 7 days. */
  closing7: number;
  /**
   * Median days left (owner 2026-11-06: an average was pulled to 157 days by a
   * few long federal deadlines; most bids close far sooner).
   */
  medianDaysLeft: number | null;
}

export interface CockpitStats {
  open: number;
  newThisWeek: number;
  newLastWeek: number;
  closing7: number;
  saved: number;
  byState: Record<string, number>;
  topState: { code: string; count: number } | null;
  trades: CockpitTradeRow[];
  soonest: CockpitBid | null;
}

const DAY = 86_400_000;

export function cockpitStats(bids: readonly CockpitBid[], savedCount: number, now: number = Date.now()): CockpitStats {
  const open = bids.filter((b) => b.due_date && Date.parse(b.due_date) > now);
  const created = (b: CockpitBid) => (b.created_at ? Date.parse(b.created_at) : NaN);
  const newThisWeek = bids.filter((b) => created(b) > now - 7 * DAY).length;
  const newLastWeek = bids.filter((b) => created(b) > now - 14 * DAY && created(b) <= now - 7 * DAY).length;
  const closing7 = open.filter((b) => Date.parse(b.due_date!) <= now + 7 * DAY).length;

  const byState: Record<string, number> = {};
  for (const b of open) {
    const st = resolveBidState(b.location, b.agency);
    if (st) byState[st] = (byState[st] ?? 0) + 1;
  }
  const top = Object.entries(byState).sort((a, b) => b[1] - a[1])[0];

  const groups = new Map<string, CockpitBid[]>();
  for (const b of open) {
    const t = (b.category || "").trim() || "Other";
    groups.set(t, [...(groups.get(t) ?? []), b]);
  }
  const trades: CockpitTradeRow[] = [...groups.entries()]
    .map(([trade, list]) => {
      const days = list.map((b) => (Date.parse(b.due_date!) - now) / DAY).sort((a, b) => a - b);
      const mid = days.length ? (days.length % 2 ? days[(days.length - 1) / 2] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2) : null;
      return {
        trade,
        count: list.length,
        closing7: days.filter((d) => d <= 7).length,
        medianDaysLeft: mid === null ? null : Math.max(0, Math.round(mid)),
      };
    })
    // "Other" is not a trade: it always goes last.
    .sort((a, b) => Number(a.trade === "Other") - Number(b.trade === "Other") || b.count - a.count || a.trade.localeCompare(b.trade));

  const soonest = [...open].sort((a, b) => Date.parse(a.due_date!) - Date.parse(b.due_date!))[0] ?? null;
  return {
    open: open.length,
    newThisWeek,
    newLastWeek,
    closing7,
    saved: savedCount,
    byState,
    topState: top ? { code: top[0], count: top[1] } : null,
    trades,
    soonest,
  };
}

/** "$1.2M", "$480K", "$950" — compact, rounded down to stay honest. */
export function compactDollars(n: number): string {
  if (n >= 1e9) return `$${Math.floor(n / 1e8) / 10}B`;
  if (n >= 1e6) return `$${Math.floor(n / 1e5) / 10}M`;
  if (n >= 1e3) return `$${Math.floor(n / 1e3)}K`;
  return `$${Math.floor(n)}`;
}

/** The week-over-week line under "New this week". */
export function weekDelta(thisWeek: number, lastWeek: number): { text: string; tone: "up" | "down" | "flat" } {
  const d = thisWeek - lastWeek;
  if (d > 0) return { text: `▲ ${d} vs last week`, tone: "up" };
  if (d < 0) return { text: `▼ ${-d} vs last week`, tone: "down" };
  return { text: "same as last week", tone: "flat" };
}
