// Read-only probe: Radar searches that did not finish, last 7 days, by reason and day. Counts only.
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
const s = sql();
const NOT_BOT = s.unsafe(`NOT (${BOT_EXCLUSION_SQL})`);
const rows = (await s`
  SELECT to_char(date_trunc('day', created_at), 'MM-DD') AS d, event_name, COALESCE(label,'') AS label, COUNT(*)::int AS n
  FROM funnel_events WHERE created_at > NOW() - INTERVAL '7 days' AND event_name IN ('radar_scan_start','radar_scan_complete','radar_scan_failed') AND ${NOT_BOT}
  GROUP BY 1,2,3 ORDER BY 1,2,3`) as { d: string; event_name: string; label: string; n: number }[];
for (const r of rows) console.log(`SCAN7 ${r.d} ${r.event_name} ${r.label} ${r.n}`);
process.exit(0);
