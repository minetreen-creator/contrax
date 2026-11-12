/** Database side of the company pages (src/lib/company-pages.ts). */
import { sql } from "~/db";
import { STATE_NAMES } from "~/lib/contract-map";
import {
  certLabels,
  COMPANY_CACHE_MINUTES,
  COMPANY_NEIGHBOURS,
  COMPANY_PAGE_BIDS,
  COMPANY_SEARCH_RESULTS,
  COMPANY_SITEMAP_PER_STATE,
  companyPath,
  EMPTY_COMPANY_PAGE,
  naicsWithNames,
  pageTrades,
  tradeSection,
  type CompanyBid,
  type CompanyPageData,
  type CompanySearchHit,
} from "~/lib/company-pages";

let ensured: Promise<void> | null = null;

/** Mirror of src/db/schema.sql (trade_state_bid_cache, company_page_optouts). Once per cold start. */
export function ensureCompanyPageTables(): Promise<void> {
  ensured ??= (async () => {
    await sql()`
      CREATE TABLE IF NOT EXISTS trade_state_bid_cache (
        trade TEXT NOT NULL,
        state TEXT NOT NULL,
        local_count INT NOT NULL DEFAULT 0,
        nationwide_count INT NOT NULL DEFAULT 0,
        bids JSONB NOT NULL DEFAULT '[]'::jsonb,
        computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (trade, state)
      )`;
    await sql()`
      CREATE TABLE IF NOT EXISTS company_page_optouts (
        uei TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
  })().catch((e) => {
    ensured = null;
    throw e;
  });
  return ensured;
}

export interface TradeStateMatches {
  count: number;
  nationwideCount: number;
  bids: CompanyBid[];
}

const slim = (b: { id: number; title: string; agency: string | null; description: string | null; due_date: string | null; estimated_value: string | null; naics_code: string | null; location: string | null; set_aside: string | null; source: string | null }): CompanyBid => ({
  id: b.id,
  title: b.title,
  agency: b.agency,
  description: b.description ? b.description.slice(0, 600) : null,
  due_date: b.due_date,
  estimated_value: b.estimated_value,
  naics_code: b.naics_code,
  location: b.location,
  set_aside: b.set_aside,
  source: b.source,
});

/**
 * Radar's open matches for a trade in a state: the same query, duplicate rule and state test as
 * the /contracts-in/{state}/{trade} page, so the count agrees everywhere. Kept for
 * COMPANY_CACHE_MINUTES, because thousands of company pages share a few hundred trade + state
 * pairs and a crawler must not run Radar's query once per page.
 */
export async function tradeStateMatches(trade: { slug: string; radarTerm: string }, state: string): Promise<TradeStateMatches> {
  await ensureCompanyPageTables();
  const cached = (await sql()`
    SELECT local_count, nationwide_count, bids FROM trade_state_bid_cache
    WHERE trade = ${trade.slug} AND state = ${state}
      AND computed_at > NOW() - (${COMPANY_CACHE_MINUTES} * INTERVAL '1 minute')
  `) as { local_count: number; nationwide_count: number; bids: CompanyBid[] }[];
  if (cached[0]) {
    return { count: Number(cached[0].local_count), nationwideCount: Number(cached[0].nationwide_count), bids: Array.isArray(cached[0].bids) ? cached[0].bids : [] };
  }
  return computeTradeStateMatches(trade, state);
}

/** Run Radar's query for a trade + state now and store the result (pages and the warm job). */
export async function computeTradeStateMatches(trade: { slug: string; radarTerm: string }, state: string): Promise<TradeStateMatches> {
  await ensureCompanyPageTables();
  const { stateRadarMatches } = await import("~/lib/radar-candidates");
  const { filterBidsToState, mapSeoBid } = await import("~/lib/seo-landing");
  const split = await stateRadarMatches(sql, { trade: trade.radarTerm, state });
  const local = filterBidsToState(split.local.map((r: unknown) => mapSeoBid(r)), state);
  const out: TradeStateMatches = {
    count: local.length,
    nationwideCount: split.nationwide.length,
    bids: local.slice(0, COMPANY_PAGE_BIDS).map(slim),
  };
  await sql()`
    INSERT INTO trade_state_bid_cache (trade, state, local_count, nationwide_count, bids, computed_at)
    VALUES (${trade.slug}, ${state}, ${out.count}, ${out.nationwideCount}, ${JSON.stringify(out.bids)}::jsonb, NOW())
    ON CONFLICT (trade, state) DO UPDATE SET
      local_count = EXCLUDED.local_count, nationwide_count = EXCLUDED.nationwide_count,
      bids = EXCLUDED.bids, computed_at = NOW()
  `;
  return out;
}

/** Every state + trade pair that has at least one registered business with a page. */
export async function companyTradeStatePairs(): Promise<{ state: string; trade: string }[]> {
  const rows = (await sql()`SELECT DISTINCT state, unnest(trades) AS trade FROM sam_registrants ORDER BY 1, 2`) as { state: string; trade: string }[];
  return rows.filter((r) => /^[A-Z]{2}$/.test(r.state) && !!STATE_NAMES[r.state]);
}

/** Everything one company page shows. Never throws: a missing or removed business is `found: false`. */
export async function loadCompanyPage(uei: string): Promise<CompanyPageData> {
  if (!/^[A-Z0-9]{12}$/.test(uei)) return EMPTY_COMPANY_PAGE;
  try {
    await ensureCompanyPageTables();
    const rows = (await sql()`
      SELECT r.uei, r.name, r.city, r.state, r.certs, r.trades, r.naics, r.extract_date::text AS extract_date
      FROM sam_registrants r
      WHERE r.uei = ${uei} AND NOT EXISTS (SELECT 1 FROM company_page_optouts o WHERE o.uei = r.uei)
    `) as { uei: string; name: string; city: string | null; state: string; certs: string[]; trades: string[]; naics: string[]; extract_date: string | null }[];
    const r = rows[0];
    if (!r) return EMPTY_COMPANY_PAGE;
    const stateName = STATE_NAMES[r.state] ?? null;
    if (!stateName) return EMPTY_COMPANY_PAGE;
    const trades = pageTrades(r.trades ?? []);
    const sections = await Promise.all(
      trades.map(async (t) => {
        try {
          return tradeSection(t, r.state, stateName, await tradeStateMatches(t, r.state));
        } catch (e) {
          console.error("[company-pages] matches failed:", (e as Error).message);
          return tradeSection(t, r.state, stateName, { count: 0, nationwideCount: 0, bids: [] });
        }
      }),
    );
    let neighbours: { name: string; path: string }[] = [];
    if (r.city) {
      try {
        const near = (await sql()`
          SELECT n.uei, n.name FROM sam_registrants n
          WHERE n.state = ${r.state} AND LOWER(n.city) = LOWER(${r.city}) AND n.trades && ${r.trades} AND n.uei <> ${r.uei}
            AND NOT EXISTS (SELECT 1 FROM company_page_optouts o WHERE o.uei = n.uei)
          ORDER BY md5(n.uei || ${r.uei})
          LIMIT ${COMPANY_NEIGHBOURS}
        `) as { uei: string; name: string }[];
        neighbours = near.map((n) => ({ name: n.name, path: companyPath(n.name, n.uei) }));
      } catch (e) {
        console.error("[company-pages] neighbours failed:", (e as Error).message);
      }
    }
    return {
      found: true,
      uei: r.uei,
      name: r.name,
      city: r.city,
      state: r.state,
      stateName,
      path: companyPath(r.name, r.uei),
      certs: certLabels(r.certs ?? []),
      naics: naicsWithNames(r.naics ?? []),
      trades: sections,
      neighbours,
      extractDate: r.extract_date,
    };
  } catch (e) {
    console.error("[company-pages] load failed:", (e as Error).message);
    return EMPTY_COMPANY_PAGE;
  }
}

/** States that have registered businesses, for the sitemap index. */
export async function companySitemapStates(): Promise<string[]> {
  const rows = (await sql()`SELECT DISTINCT state FROM sam_registrants ORDER BY state`) as { state: string }[];
  return rows.map((r) => r.state).filter((s) => /^[A-Z]{2}$/.test(s) && !!STATE_NAMES[s]);
}

/** The businesses listed in one state's sitemap: certified ones first, then by name. */
export async function companySitemapRows(state: string): Promise<{ name: string; uei: string }[]> {
  if (!/^[A-Z]{2}$/.test(state)) return [];
  await ensureCompanyPageTables();
  return (await sql()`
    SELECT r.name, r.uei FROM sam_registrants r
    WHERE r.state = ${state} AND NOT EXISTS (SELECT 1 FROM company_page_optouts o WHERE o.uei = r.uei)
    ORDER BY cardinality(r.certs) DESC, (r.url IS NOT NULL) DESC, r.name ASC
    LIMIT ${COMPANY_SITEMAP_PER_STATE}
  `) as { name: string; uei: string }[];
}

/** Find company pages by business name (and state). Public registration facts only; removed businesses are left out. */
export async function searchCompanyPages(name: string, state: string | null, limit = COMPANY_SEARCH_RESULTS): Promise<CompanySearchHit[]> {
  const q = name.trim().replace(/[%_]/g, "").slice(0, 80);
  if (q.length < 3) return [];
  try {
    await ensureCompanyPageTables();
    const st = state && /^[A-Z]{2}$/.test(state) ? state : null;
    const statePred = st ? sql()`AND r.state = ${st}` : sql()``;
    const rows = (await sql()`
      SELECT r.uei, r.name, r.city, r.state FROM sam_registrants r
      WHERE r.name ILIKE ${`%${q}%`} ${statePred}
        AND NOT EXISTS (SELECT 1 FROM company_page_optouts o WHERE o.uei = r.uei)
      ORDER BY (LOWER(r.name) = LOWER(${q})) DESC, (LOWER(r.name) LIKE LOWER(${`${q}%`})) DESC, r.name ASC
      LIMIT ${limit}
    `) as { uei: string; name: string; city: string | null; state: string }[];
    return rows.map((r) => ({ name: r.name, city: r.city, state: r.state, path: companyPath(r.name, r.uei) }));
  } catch (e) {
    console.error("[company-pages] search failed:", (e as Error).message);
    return [];
  }
}
