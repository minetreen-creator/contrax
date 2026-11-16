/**
 * Trade coverage (owner 2026-11-16: "we need more janitorial sources nationwide"). Pure tallies for
 * the read-only job in src/jobs/trade-coverage.ts: how many open bids one trade has in each state,
 * and which sources they came from, so the thin states are named from the data and not guessed.
 */
export interface CoverageRow { state: string; open: number; federal: number; sources: Record<string, number> }

const FEDERAL = /^sam/i;

/** One state's tally from its matched rows. A source label starting with "sam" is federal. */
export function coverageRow(state: string, rows: readonly { source?: unknown }[]): CoverageRow {
  const sources: Record<string, number> = {};
  let federal = 0;
  for (const r of rows) {
    const s = String(r.source ?? "").trim() || "unknown";
    sources[s] = (sources[s] ?? 0) + 1;
    if (FEDERAL.test(s)) federal += 1;
  }
  return { state, open: rows.length, federal, sources };
}

/** States with the fewest state-and-local bids first: where another source would matter most. */
export function thinnest(rows: readonly CoverageRow[]): CoverageRow[] {
  return [...rows].sort((a, b) => (a.open - a.federal) - (b.open - b.federal) || a.open - b.open || a.state.localeCompare(b.state));
}

/** Every source across all states, largest first. */
export function sourceTotals(rows: readonly CoverageRow[]): [string, number][] {
  const t: Record<string, number> = {};
  for (const r of rows) for (const [s, n] of Object.entries(r.sources)) t[s] = (t[s] ?? 0) + n;
  return Object.entries(t).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
