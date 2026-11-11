// TEMP read-only, counts only, no PII: Radar leads and their alert emails.
import { sql } from "~/db";
const s = sql();
const out = async (label: string, p: Promise<unknown>) => { try { console.log("LEADS", label, JSON.stringify(await p)); } catch (e) { console.log("LEADS", label, "ERR", (e as Error).message.slice(0, 160)); } };
await out("totals", s`SELECT COUNT(*)::int AS leads, COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL)::int AS confirmed, COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS unsubscribed, COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL AND consent)::int AS sendable, COUNT(*) FILTER (WHERE last_alerted_at IS NOT NULL)::int AS ever_alerted, COUNT(*) FILTER (WHERE last_alerted_at > now() - interval '14 days')::int AS alerted_14d, COUNT(*) FILTER (WHERE COALESCE(click_count,0) > 0)::int AS ever_clicked, COUNT(*) FILTER (WHERE created_at > now() - interval '14 days')::int AS new_14d, COUNT(*) FILTER (WHERE created_at > now() - interval '14 days' AND confirmed_at IS NOT NULL)::int AS new_14d_confirmed FROM radar_leads`);
await out("alert bids sent by week", s`SELECT date_trunc('week', sent_at)::date AS wk, COUNT(*)::int AS bids, COUNT(DISTINCT lead_id)::int AS leads FROM radar_leads_alerts_sent WHERE sent_at > now() - interval '42 days' GROUP BY 1 ORDER BY 1`);
await out("clicks by week", s`SELECT date_trunc('week', clicked_at)::date AS wk, COUNT(*)::int AS clicks FROM radar_lead_opportunity_clicks WHERE clicked_at > now() - interval '42 days' GROUP BY 1 ORDER BY 1`);
await out("alerts_sent columns", s`SELECT column_name FROM information_schema.columns WHERE table_name = 'radar_leads_alerts_sent'`);
process.exit(0);
