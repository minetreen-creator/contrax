/** Live data for a Contractor Support Network market page (src/lib/markets.ts): open bids and registered subs. */
import { inMarket, type Market } from "~/lib/markets";
import { isBuildWork } from "~/lib/tampa";

export interface MarketBid {
  id: number;
  title: string;
  agency: string;
  due: string | null;
}

export interface MarketSubs {
  total: number;
  certs: Record<string, number>;
  rows: { uei: string; name: string; city: string | null; url: string | null; certs: string[]; trades: string[] }[];
}

export interface MarketData {
  open: number;
  build: number;
  bids: MarketBid[];
  subs: MarketSubs;
  /** Texas HUB-certified firms for the market's trades in its cities (Texas markets only). */
  txHub: number;
}

const EMPTY: MarketData = { open: 0, build: 0, bids: [], subs: { total: 0, certs: {}, rows: [] }, txHub: 0 };
const cache = new Map<string, { at: number; data: MarketData }>();
const TTL = 30 * 60 * 1000;

export async function loadMarketData(m: Market): Promise<MarketData> {
  const hit = cache.get(m.slug);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  try {
    const { sql } = await import("~/db");
    const { LOW_CONTENT_SQL } = await import("~/lib/low-content");
    const { AWARD_EXCLUSION_SQL } = await import("~/lib/source-class");
    const s = sql();
    const like = m.places.map((p) => `%${p}%`);
    const rows = (await s`
      SELECT id, title, agency, location, due_date FROM bids
      WHERE due_date > NOW()
        AND ${s.unsafe(LOW_CONTENT_SQL)}
        AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
        AND (LOWER(COALESCE(location,'')) LIKE ANY(${like}) OR LOWER(COALESCE(agency,'')) LIKE ANY(${like}))
      ORDER BY due_date ASC
      LIMIT 2000
    `) as { id: number; title: string; agency: string | null; location: string | null; due_date: string | Date | null }[];
    const { registeredSubsInCities } = await import("~/lib/sam-registrants.server");
    const subs = await registeredSubsInCities({ state: m.stateCode, cities: m.subCities, trades: m.subTrades, limit: 12 });
    const txHub = m.stateCode === "TX" ? await (await import("~/lib/tx-hub.server")).txHubCountIn({ cities: m.subCities, trades: m.subTrades }) : 0;
    const here = rows.filter((r) => inMarket(m, r.location, r.agency));
    const build = here.filter((r) => isBuildWork(r.title));
    const data: MarketData = {
      subs,
      txHub,
      open: here.length,
      build: build.length,
      bids: build.slice(0, 10).map((r) => ({
        id: Number(r.id),
        title: r.title,
        agency: r.agency ?? "",
        due: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : null,
      })),
    };
    cache.set(m.slug, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.error(`[markets] ${m.slug} load failed:`, e);
    return EMPTY;
  }
}

/** Clicks to a market partner since the partnership started, by label (website, phone, homepage). */
export async function partnerClicks(m: Market): Promise<{ total: number; visitors: number; byLabel: Record<string, number>; byDay: { day: string; n: number }[] }> {
  if (!m.partner) return { total: 0, visitors: 0, byLabel: {}, byDay: [] };
  try {
    const { sql } = await import("~/db");
    const s = sql();
    const [tot, labels, days] = await Promise.all([
      s`SELECT COUNT(*)::int AS n, COUNT(DISTINCT visitor_id)::int AS v FROM funnel_events WHERE event_name = ${m.partner.clickEvent} AND created_at >= ${m.partner.since}::date`,
      s`SELECT COALESCE(label, '') AS label, COUNT(*)::int AS n FROM funnel_events WHERE event_name = ${m.partner.clickEvent} AND created_at >= ${m.partner.since}::date GROUP BY 1`,
      s`SELECT created_at::date::text AS day, COUNT(*)::int AS n FROM funnel_events WHERE event_name = ${m.partner.clickEvent} AND created_at >= ${m.partner.since}::date GROUP BY 1 ORDER BY 1`,
    ]);
    const t = (tot as { n: number; v: number }[])[0] ?? { n: 0, v: 0 };
    return {
      total: Number(t.n),
      visitors: Number(t.v),
      byLabel: Object.fromEntries((labels as { label: string; n: number }[]).map((r) => [r.label, Number(r.n)])),
      byDay: (days as { day: string; n: number }[]).map((r) => ({ day: String(r.day), n: Number(r.n) })),
    };
  } catch {
    return { total: 0, visitors: 0, byLabel: {}, byDay: [] };
  }
}
