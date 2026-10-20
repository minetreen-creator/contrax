/**
 * Radar search-usage report — CLI entrypoint (`bun run radar-search-usage`),
 * run by hand from .github/workflows/radar-search-usage.yml (owner 2026-10-19:
 * "do that search usage"). Read-only: prints counts, never a visitor, IP or email.
 *
 * Question: of the visitors who opened /radar in the last N days, how many ran
 * a search (radar_scan_start) and how many got results (radar_scan_complete)?
 * Split by paid ads (medium cpc/paid) vs everything else, and phone vs desktop.
 */
import { sql } from "~/db";

export async function radarSearchUsage(days: number): Promise<void> {
  const rows = (await sql()`
    WITH radar_visitors AS (
      SELECT pv.visitor_id,
             BOOL_OR(LOWER(COALESCE(pv.medium, '')) IN ('cpc', 'ppc', 'paid', 'paidsocial', 'display')) AS paid,
             BOOL_OR(LOWER(COALESCE(pv.device_type, '')) = 'mobile') AS mobile
      FROM page_views pv
      WHERE pv.created_at > NOW() - make_interval(days => ${days})
        AND pv.visitor_id IS NOT NULL
        AND (pv.path = '/radar' OR pv.path LIKE '/radar?%' OR pv.path LIKE '/radar/%')
      GROUP BY pv.visitor_id
    ),
    searched AS (
      SELECT visitor_id,
             BOOL_OR(event_name = 'radar_scan_start') AS started,
             BOOL_OR(event_name = 'radar_scan_complete') AS completed
      FROM funnel_events
      WHERE created_at > NOW() - make_interval(days => ${days})
        AND visitor_id IN (SELECT visitor_id FROM radar_visitors)
      GROUP BY visitor_id
    )
    SELECT CASE WHEN rv.paid THEN 'paid ads' ELSE 'other' END AS channel,
           CASE WHEN rv.mobile THEN 'phone' ELSE 'desktop/tablet' END AS device,
           COUNT(*)::int AS visitors,
           COUNT(*) FILTER (WHERE s.started)::int AS searched,
           COUNT(*) FILTER (WHERE s.completed)::int AS got_results
    FROM radar_visitors rv LEFT JOIN searched s ON s.visitor_id = rv.visitor_id
    GROUP BY 1, 2
    ORDER BY 1, 2
  `) as { channel: string; device: string; visitors: number; searched: number; got_results: number }[];

  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
  console.log(`🔎 Visitors who opened /radar in the last ${days} days`);
  console.log("channel | device | visitors | ran a search | got results");
  let v = 0, s = 0, c = 0;
  for (const r of rows) {
    v += r.visitors; s += r.searched; c += r.got_results;
    console.log(`${r.channel} | ${r.device} | ${r.visitors} | ${r.searched} (${pct(r.searched, r.visitors)}) | ${r.got_results} (${pct(r.got_results, r.visitors)})`);
  }
  console.log(`all | all | ${v} | ${s} (${pct(s, v)}) | ${c} (${pct(c, v)})`);

  // Searches that found nothing, by trade + state (radar_search_log, saved
  // from 2026-10-19 on). Search words only, never who searched.
  try {
    const empty = (await sql()`
      SELECT LOWER(trade) AS trade, state, COUNT(*)::int AS searches
      FROM radar_search_log
      WHERE created_at > NOW() - make_interval(days => ${days}) AND matched = 0
      GROUP BY 1, 2
      ORDER BY searches DESC, trade
      LIMIT 25
    `) as { trade: string; state: string; searches: number }[];
    console.log("");
    console.log(`🕳️ Searches with zero matches, top ${empty.length}`);
    console.log("trade | state | searches");
    for (const r of empty) console.log(`${r.trade} | ${r.state || "any"} | ${r.searches}`);
  } catch {
    console.log("🕳️ Zero-match searches: none saved yet");
  }
}

if (import.meta.main) {
  try {
    const days = Math.min(90, Math.max(1, Number(process.env.DAYS ?? 7) || 7));
    await radarSearchUsage(days);
    process.exit(0);
  } catch (e) {
    console.error("💥 Radar search-usage report crashed:", e);
    process.exit(1);
  }
}
