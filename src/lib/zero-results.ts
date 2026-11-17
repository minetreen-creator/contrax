/**
 * What to offer when a search finds nothing (owner 2026-11-16: "what can we do to get more
 * searches?"; 34 visitors searched in a week and only 18 saw a match). PURE.
 */
export interface ZeroOption { trade: string; label: string; count: number }

const TABS = [
  { id: "construction", label: "Construction", trade: "construction" },
  { id: "landscaping", label: "Landscaping", trade: "landscaping" },
  { id: "janitorial", label: "Janitorial", trade: "janitorial" },
  { id: "security", label: "Security guards", trade: "security guard" },
] as const;

/**
 * The popular trades that have open bids in the state, most first, with their real counts. The
 * trade just searched is left out (it found nothing), and so is any trade with no open bids: a
 * button here never leads to another empty result.
 */
export function zeroStateOptions(data: { counts: Record<string, number> } | null | undefined, searched: string): ZeroOption[] {
  if (!data) return [];
  const was = searched.trim().toLowerCase();
  return TABS.map((t) => ({ trade: t.trade, label: t.label, count: Number(data.counts[t.id]) || 0 }))
    .filter((o) => o.count > 0 && o.trade !== was && o.label.toLowerCase() !== was)
    .sort((a, b) => b.count - a.count);
}
