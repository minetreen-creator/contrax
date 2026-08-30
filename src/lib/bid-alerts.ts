import { sql } from "../db";
import { fireBidMatchWebhooks, type BidMatchEvent } from "./webhooks";
import { fireSlackBidMatchAlerts } from "./slack";

export interface BidAlert {
  id: number; bid_id: number; title: string; agency: string;
  due_date: string | null; category: string | null; set_aside: string | null;
  source_url: string | null; match_reason: string; is_read: boolean; created_at: string;
  source: string | null;
}

/**
 * Create one alert per user/new bid. Safe to call repeatedly (unique constraint
 * deduplicates). Runs for every newly inserted bid — federal (sam_gov) and
 * city open-data sources alike — because the runner feeds generateBidAlerts()
 * the combined list of new bid ids from all sources.
 *
 * When a NEW alert is created, the matching bid is also pushed through the
 * user's active `bid_match` webhooks (Zapier etc.) — fire-and-log, so webhook
 * failures never break alert creation.
 */
export async function generateBidAlerts(bidIds: number[]): Promise<number> {
  if (!bidIds.length) return 0;
  await sql()`CREATE TABLE IF NOT EXISTS bid_alerts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), bid_id INTEGER NOT NULL REFERENCES bids(id), alert_type TEXT DEFAULT 'new_match', is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id, alert_type))`;
  const profiles = await sql()`SELECT user_id, naics_codes, service_categories, specialties, certifications FROM business_profiles WHERE user_id IS NOT NULL`;
  let created = 0;
  const webhookEvents: BidMatchEvent[] = [];
  for (const bidId of bidIds) {
    const rows = await sql()`SELECT id, title, agency, category, set_aside, description, source, location, due_date, source_url FROM bids WHERE id = ${bidId}`;
    const bid = rows[0] as any; if (!bid) continue;
    const text = `${bid.title || ""} ${bid.agency || ""} ${bid.category || ""} ${bid.description || ""}`.toLowerCase();
    for (const p of profiles as any[]) {
      const naics = Array.isArray(p.naics_codes) ? p.naics_codes.map(String) : [];
      const categories = [...(Array.isArray(p.service_categories) ? p.service_categories : []), ...(Array.isArray(p.specialties) ? p.specialties : [])].map(String).filter(Boolean);
      const certs = Array.isArray(p.certifications) ? p.certifications.map(String) : [];
      const naicsMatch = naics.some((n) => text.includes(n.toLowerCase()));
      const categoryMatch = categories.some((c) => text.includes(c.toLowerCase()));
      const setAsideMatch = Boolean(bid.set_aside) && certs.some((c) => text.includes(c.toLowerCase()) || String(bid.set_aside).toLowerCase().includes(c.toLowerCase()));
      if (!naicsMatch && !categoryMatch && !setAsideMatch) continue;
      const matchedOn = [naicsMatch && "naics", categoryMatch && "category", setAsideMatch && "set_aside"].filter(Boolean) as string[];
      const inserted = await sql()`INSERT INTO bid_alerts (user_id,bid_id,alert_type) VALUES (${p.user_id},${bidId},'new_match') ON CONFLICT (user_id,bid_id,alert_type) DO NOTHING RETURNING id`;
      if (inserted.length) {
        created++;
        // Record an activation funnel event (Visitor Journeys "Activated" =
        // first alert creation). Server-side, so it carries user_id (no
        // visitor_id at sync time); the journeys query still counts it as
        // activation for the linked user. Fire-and-log, deduped indirectly by
        // the ON CONFLICT gate above (only NEW alerts reach this block).
        try {
          await sql()`
            INSERT INTO funnel_events (event_name, label, path, user_agent, user_id)
            VALUES ('alert_created', ${String(bidId)}, 'sync', 'bid-alerts-job', ${String(p.user_id)})
            ON CONFLICT DO NOTHING
          `;
        } catch (alertErr) {
          console.error("💬 Failed to record alert_created funnel event:", (alertErr as Error).message);
        }
        // Fire webhooks for NEW matches only (the alert insert is the dedupe gate).
        webhookEvents.push({
          userId: Number(p.user_id),
          bid: {
            title: bid.title ?? null,
            agency: bid.agency ?? null,
            set_aside: bid.set_aside ?? null,
            location: bid.location ?? null,
            due_date: bid.due_date ? String(bid.due_date) : null,
            source_url: bid.source_url ?? null,
          },
          matchedOn,
        });
      }
    }
  }
  // Deliver webhooks (fire-and-log; never throws, never blocks alert creation).
  if (webhookEvents.length) {
    try {
      const attempted = await fireBidMatchWebhooks(webhookEvents);
      if (attempted > 0) console.log(`🔗 Fired ${attempted} webhook delivery(ies) for ${webhookEvents.length} new match(es)`);
    } catch (err) {
      console.error("🔗 Failed to fire webhooks:", (err as Error).message);
    }
    // Deliver Slack messages alongside (fire-and-log; independent toggle).
    try {
      const slackAttempted = await fireSlackBidMatchAlerts(webhookEvents);
      if (slackAttempted > 0) console.log(`💬 Fired ${slackAttempted} Slack message(s) for ${webhookEvents.length} new match(es)`);
    } catch (err) {
      console.error("💬 Failed to fire Slack alerts:", (err as Error).message);
    }
  }
  return created;
}

export async function ensureBidAlertsTable() {
  await sql()`CREATE TABLE IF NOT EXISTS bid_alerts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), bid_id INTEGER NOT NULL REFERENCES bids(id), alert_type TEXT DEFAULT 'new_match', is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id, alert_type))`;
}
