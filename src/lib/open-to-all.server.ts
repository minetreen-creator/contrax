/** Server-only loader for "Open to all businesses" (see ~/lib/open-to-all). */
import { toOpenToAllData, type OpenToAllData } from "~/lib/open-to-all";

const EMPTY = (trade: string, state: string): OpenToAllData => ({ trade, state, localCount: 0, nationwideCount: 0, bids: [] });

// Ten-minute cache per trade and state: the list only changes when the feeds sync.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: OpenToAllData }>();

export async function loadOpenToAll(trade: string, state: string): Promise<OpenToAllData> {
  if (!trade) return EMPTY(trade, state);
  const key = `${trade.toLowerCase()}|${state}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  try {
    const { sql } = await import("~/db");
    const { openToAllMatches } = await import("~/lib/radar-candidates");
    const data = toOpenToAllData(trade, state, await openToAllMatches(sql, { trade, state }));
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.error("[open-to-all] query failed:", (e as Error).message);
    return EMPTY(trade, state);
  }
}

