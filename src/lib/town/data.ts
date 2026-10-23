import { createServerFn } from "@tanstack/react-start";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { lookupZip, nearbyTowns, normalizeZip, RADIUS_MILES, townRegex, type ZipTable } from "./town";

/** Server side of "What's Your Town Buying?" (town.ts). */

export interface TownBid {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  category: string | null;
  due: string;
}

export interface TownData {
  zip: string;
  town: string;
  state: string;
  /** Not a known US ZIP. */
  notFound: boolean;
  radiusMiles: number;
  townsSearched: number;
  nearbyOpen: number;
  bids: TownBid[];
  categories: { category: string; count: number }[];
  stateOpen: number;
}

let zipTable: ZipTable | null = null;
async function zips(): Promise<ZipTable> {
  if (!zipTable) zipTable = (await import("./zips.json")).default as unknown as ZipTable;
  return zipTable;
}

export const getTownData = createServerFn({ method: "GET" })
  .validator((zip: string) => zip)
  .handler(async ({ data }): Promise<TownData> => {
    const empty = (zip: string): TownData => ({
      zip,
      town: "",
      state: "",
      notFound: true,
      radiusMiles: RADIUS_MILES,
      townsSearched: 0,
      nearbyOpen: 0,
      bids: [],
      categories: [],
      stateOpen: 0,
    });
    const zip = normalizeZip(data);
    if (!zip) return empty(String(data ?? "").slice(0, 10));
    const table = await zips();
    const place = lookupZip(table, zip);
    if (!place) return empty(zip);
    const towns = nearbyTowns(table, zip);
    const regex = townRegex(towns);
    const states = [...new Set(towns.map((t) => t.state))];
    const result: TownData = { ...place, notFound: false, radiusMiles: RADIUS_MILES, townsSearched: towns.length, nearbyOpen: 0, bids: [], categories: [], stateOpen: 0 };
    try {
      const { sql } = await import("~/db");
      const s = sql();
      const [st] = (await s`
        SELECT COUNT(*)::int AS n FROM bids
        WHERE normalized_state = ${place.state} AND due_date > NOW()
          AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}`) as { n: number }[];
      result.stateOpen = Number(st?.n ?? 0);
      if (regex) {
        const rows = (await s.query(
          `SELECT id, title, agency, location, category, due_date
           FROM bids
           WHERE normalized_state = ANY($1::text[]) AND due_date > NOW()
             AND (COALESCE(agency, '') || ' ' || COALESCE(location, '')) ~* $2
             AND ${LOW_CONTENT_SQL} AND ${AWARD_EXCLUSION_SQL}
           ORDER BY due_date ASC
           LIMIT 200`,
          [states, regex],
        )) as { id: number; title: string; agency: string | null; location: string | null; category: string | null; due_date: Date | string }[];
        result.nearbyOpen = rows.length;
        result.bids = rows.slice(0, 60).map((r) => ({
          id: r.id,
          title: r.title,
          agency: r.agency,
          location: r.location,
          category: r.category,
          due: new Date(r.due_date).toISOString().slice(0, 10),
        }));
        const counts = new Map<string, number>();
        for (const r of rows) {
          const c = (r.category ?? "").trim() || "Other";
          counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        result.categories = [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count).slice(0, 8);
      }
    } catch (err) {
      console.error("[town] query failed:", err);
    }
    return result;
  });
