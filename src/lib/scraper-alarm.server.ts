import { sql } from "~/db";
import {
  ALARM_COOLDOWN_MINUTES,
  ALARM_WINDOW_MINUTES,
  isScraperBurst,
  scraperAlarmPush,
  type BurstStats,
} from "~/lib/scraper-alarm";

/**
 * See src/lib/scraper-alarm.ts. Called after each stored bid-page view; checks
 * at most once a minute per function instance, saves a snapshot (counts,
 * countries, browsers — no addresses; the raw page_views rows stay as they are)
 * and pushes the owner at most once an hour. Never throws.
 */
let lastCheckAt = 0;
let ready = false;

async function ensureTable(): Promise<void> {
  if (ready) return;
  await sql()`CREATE TABLE IF NOT EXISTS scraper_alarms (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_minutes INTEGER NOT NULL,
    bid_views INTEGER NOT NULL,
    bid_only_visitors INTEGER NOT NULL,
    single_page_visitors INTEGER NOT NULL,
    addresses INTEGER NOT NULL,
    countries TEXT,
    browsers TEXT
  )`;
  ready = true;
}

export async function checkScraperBurst(now = Date.now()): Promise<void> {
  if (now - lastCheckAt < 60_000) return;
  lastCheckAt = now;
  try {
    const since = new Date(now - ALARM_WINDOW_MINUTES * 60_000);
    const [row] = (await sql()`
      WITH v AS (
        SELECT visitor_id, COUNT(*) AS n, MIN(ip) AS ip
        FROM page_views
        WHERE created_at > ${since} AND visitor_id IS NOT NULL
        GROUP BY visitor_id
        HAVING bool_and(path LIKE '/bid/%')
      )
      SELECT COUNT(*)::int AS bid_only, COUNT(*) FILTER (WHERE n = 1)::int AS single,
             COUNT(DISTINCT ip)::int AS addresses, COALESCE(SUM(n), 0)::int AS bid_views
      FROM v`) as { bid_only: number; single: number; addresses: number; bid_views: number }[];
    const stats: BurstStats = {
      bidOnlyVisitors: Number(row?.bid_only ?? 0),
      singlePageVisitors: Number(row?.single ?? 0),
      addresses: Number(row?.addresses ?? 0),
      bidViews: Number(row?.bid_views ?? 0),
    };
    if (!isScraperBurst(stats)) return;
    await ensureTable();
    const recent = (await sql()`SELECT 1 FROM scraper_alarms WHERE created_at > ${new Date(now - ALARM_COOLDOWN_MINUTES * 60_000)} LIMIT 1`) as unknown[];
    if (recent.length) return;
    const countries = (await sql()`
      SELECT upper(coalesce(v.country, '?')) AS country, COUNT(*)::int AS n
      FROM page_views pv LEFT JOIN visitors v ON v.visitor_id = pv.visitor_id
      WHERE pv.created_at > ${since} AND pv.path LIKE '/bid/%'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 8`) as { country: string; n: number }[];
    const browsers = (await sql()`
      SELECT left(coalesce(user_agent, ''), 160) AS browser, COUNT(*)::int AS n
      FROM page_views WHERE created_at > ${since} AND path LIKE '/bid/%'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 8`) as { browser: string; n: number }[];
    await sql()`INSERT INTO scraper_alarms (window_minutes, bid_views, bid_only_visitors, single_page_visitors, addresses, countries, browsers)
      VALUES (${ALARM_WINDOW_MINUTES}, ${stats.bidViews}, ${stats.bidOnlyVisitors}, ${stats.singlePageVisitors}, ${stats.addresses},
              ${JSON.stringify(countries)}, ${JSON.stringify(browsers)})`;
    const { alertOwner } = await import("~/lib/live-push.server");
    await alertOwner(scraperAlarmPush(stats, countries, browsers));
  } catch (e) {
    console.error("[scraper-alarm] check failed (non-fatal):", (e as Error).message);
  }
}
