import type { ContractMapAggregate } from "~/lib/contract-map";

/**
 * Homepage "Spin the map" (owner 2026-10-29: "Do 3"). A US map lit up by how
 * many bids are open in each state; tap a state to see its count, what closes
 * this week and what it buys most, with one-tap trade chips into Radar.
 * Everything comes from the homepage's existing contract-map aggregate (the same
 * open-bid filters as /map), so the map adds no database work.
 */

/** Five shades, darkest = most open bids. */
export const HOME_MAP_SHADES = ["#1e3a5f", "#1d4f91", "#2563eb", "#3b82f6", "#60a5fa"] as const;

/** Shade index 0..4 for a count, on a square-root scale so small states still show. PURE. */
export function shadeIndex(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const r = Math.sqrt(count) / Math.sqrt(max);
  return Math.min(HOME_MAP_SHADES.length - 1, Math.max(0, Math.ceil(r * HOME_MAP_SHADES.length) - 1));
}

/** Rank of each state by count (0 = most bids): drives the light-up order. PURE. */
export function lightUpOrder(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code], i) => [code, i]),
  );
}

export interface HomeMapState {
  code: string;
  count: number;
  closingSoon: number;
  topWork: { name: string; count: number }[];
}

/** Per-state counts and the panel facts, from the contract-map aggregate. PURE. */
export function homeMapStates(map: ContractMapAggregate | null | undefined): Record<string, HomeMapState> {
  const out: Record<string, HomeMapState> = {};
  for (const [code, s] of Object.entries(map?.states ?? {})) {
    if (!s || s.count <= 0) continue;
    out[code] = {
      code,
      count: s.count,
      closingSoon: s.closingSoon,
      topWork: (s.industries ?? []).filter((i) => i.name && i.name !== "Other" && i.count > 0).slice(0, 3),
    };
  }
  return out;
}

/** The state with the most open bids, for when the visitor's state is unknown. PURE. */
export function busiestState(states: Record<string, HomeMapState>): string {
  return Object.values(states).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))[0]?.code ?? "";
}

/** A bid category as the Radar search term behind its chip. PURE. */
export function categoryTrade(category: string): string {
  const map: Record<string, string> = {
    Transportation: "Trucking",
    Security: "Security guards",
    "Plumbing & Electrical": "Electrical",
    "IT Services": "IT services",
  };
  return map[category] ?? category;
}
