// Read-only, counts only: why Radar searches fail.
import { sql } from "~/db";
const s = sql();
const out = async (label: string, p: Promise<unknown>) => { try { console.log(label, JSON.stringify(await p)); } catch (e) { console.log(label, "ERR", (e as Error).message.slice(0, 140)); } };
await out("failures by reason and day", s`SELECT created_at::date AS day, label, COUNT(*)::int AS n, COUNT(DISTINCT visitor_id)::int AS visitors FROM funnel_events WHERE event_name = 'radar_scan_failed' AND created_at > NOW() - INTERVAL '10 days' GROUP BY 1, 2 ORDER BY 1, 2`);
await out("scans started/completed by day", s`SELECT created_at::date AS day, COUNT(*) FILTER (WHERE event_name='radar_scan_start')::int AS started, COUNT(*) FILTER (WHERE event_name='radar_scan_complete')::int AS completed, COUNT(*) FILTER (WHERE event_name='radar_scan_failed')::int AS failed FROM funnel_events WHERE created_at > NOW() - INTERVAL '10 days' GROUP BY 1 ORDER BY 1`);
await out("failed by device", s`SELECT device_type, browser_label, COUNT(*)::int AS n FROM funnel_events WHERE event_name = 'radar_scan_failed' AND created_at > NOW() - INTERVAL '10 days' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`);
await out("failed paths", s`SELECT path, COUNT(*)::int AS n FROM funnel_events WHERE event_name = 'radar_scan_failed' AND created_at > NOW() - INTERVAL '10 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
// What the same visitors searched just before failing (trade/state from the scan_start label, if any).
await out("scan_start labels before failures", s`SELECT f2.label, COUNT(*)::int AS n FROM funnel_events f JOIN LATERAL (SELECT label FROM funnel_events x WHERE x.visitor_id = f.visitor_id AND x.event_name = 'radar_scan_start' AND x.created_at <= f.created_at ORDER BY x.created_at DESC LIMIT 1) f2 ON true WHERE f.event_name = 'radar_scan_failed' AND f.created_at > NOW() - INTERVAL '10 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
