/**
 * BidNet cadence (owner 2026-10-22: "change it to once a day").
 *
 * The first sync with all 48 BidNet purchasing groups read ~430 list pages in
 * about 8 minutes, and BidNet then answered every request with HTTP 403. Bids
 * stay open for weeks, so a daily read is enough; reading every group on every
 * 4-hourly sync was ~6× the traffic for almost no freshness.
 *
 * Each `<st>_bidnet` source now runs at most once per MIN_HOURS (by its own
 * collector_run_log rows; a refused run counts too, so a blocked group backs
 * off for a day instead of retrying every sync), and one sync runs at most
 * PER_RUN of them, most overdue first, so the groups spread across the day's
 * syncs instead of arriving as one burst. Every other source is untouched.
 */
import type { NeonQueryFunction } from "@neondatabase/serverless";

export const BIDNET_MIN_HOURS = 20;
export const BIDNET_PER_RUN = 12;

export const isBidnetSource = (name: string) => name.endsWith("_bidnet");

/**
 * PURE: which BidNet sources this sync runs. `lastRun` maps a source to its most
 * recent collector_run_log time (absent = never ran → most overdue).
 */
export function chooseBidnetSources(
  names: readonly string[],
  lastRun: ReadonlyMap<string, Date>,
  now: number,
  opts: { minHours?: number; perRun?: number } = {},
): string[] {
  const minMs = (opts.minHours ?? BIDNET_MIN_HOURS) * 3_600_000;
  const perRun = opts.perRun ?? BIDNET_PER_RUN;
  const last = (n: string) => lastRun.get(n)?.getTime() ?? -Infinity;
  return names
    .filter((n) => now - last(n) >= minMs)
    .map((n, i) => ({ n, i }))
    .sort((a, b) => last(a.n) - last(b.n) || a.i - b.i)
    .slice(0, perRun)
    .map((x) => x.n);
}

/**
 * Read each BidNet source's last run and choose this sync's set. If the run log
 * cannot be read, run none: the safe failure is less traffic, not a burst.
 */
export async function planBidnetSources(
  sql: NeonQueryFunction<false, false>,
  names: readonly string[],
  now = Date.now(),
): Promise<Set<string>> {
  if (!names.length) return new Set();
  try {
    const rows = (await sql.query(
      `SELECT source, max(ran_at) AS last FROM collector_run_log WHERE source = ANY($1::text[]) GROUP BY source`,
      [names],
    )) as { source: string; last: Date | string }[];
    const lastRun = new Map(rows.map((r) => [r.source, new Date(r.last)]));
    return new Set(chooseBidnetSources(names, lastRun, now));
  } catch (e) {
    console.warn(`⚠ BidNet cadence: run log unreadable, skipping BidNet this sync: ${e instanceof Error ? e.message : e}`);
    return new Set();
  }
}

/**
 * A BidNet refusal (owner 2026-10-23): an HTTP 403/429 from one group means the
 * site is refusing us right now, so the rest of BidNet waits until the next
 * day's turn instead of knocking on every remaining group. PURE.
 */
export function isBidnetRefusal(errors: readonly string[]): boolean {
  return errors.some((e) => /\bHTTP (403|429)\b/.test(e));
}
