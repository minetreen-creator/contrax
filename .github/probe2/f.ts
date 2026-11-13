// Read-only: plan/label and time of the last 24h purchase and checkouts (no PII). Removed after.
import { neon } from "@neondatabase/serverless";
const s = neon(process.env.DATABASE_URL!);
console.log(JSON.stringify(await s.query(`SELECT event_name, label, path, source, created_at FROM funnel_events WHERE event_name IN ('purchase_completed','checkout_session_created','bid_lock_starter_click','bid_top_starter_click') AND created_at > NOW()-INTERVAL '24 hours' ORDER BY created_at`)));
