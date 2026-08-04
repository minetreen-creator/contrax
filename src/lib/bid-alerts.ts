import { sql } from "../db";

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
 */
export async function generateBidAlerts(bidIds: number[]): Promise<number> {
  if (!bidIds.length) return 0;
  await sql()`CREATE TABLE IF NOT EXISTS bid_alerts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), bid_id INTEGER NOT NULL REFERENCES bids(id), alert_type TEXT DEFAULT 'new_match', is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id, alert_type))`;
  const profiles = await sql()`SELECT user_id, naics_codes, service_categories, specialties, certifications FROM business_profiles WHERE user_id IS NOT NULL`;
  let created = 0;
  for (const bidId of bidIds) {
    const rows = await sql()`SELECT id, title, agency, category, set_aside, description, source FROM bids WHERE id = ${bidId}`;
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
      const reasons = [naicsMatch && "NAICS code", categoryMatch && "tracked category", setAsideMatch && "set-aside certification"].filter(Boolean).join(" + ");
      const inserted = await sql()`INSERT INTO bid_alerts (user_id,bid_id,alert_type) VALUES (${p.user_id},${bidId},'new_match') ON CONFLICT (user_id,bid_id,alert_type) DO NOTHING RETURNING id`;
      if (inserted.length) created++;
      // Keep reason available without changing the requested schema via alert_type metadata is avoided;
      // the page derives the same reason from the profile and bid.
      void reasons;
    }
  }
  return created;
}

export async function ensureBidAlertsTable() {
  await sql()`CREATE TABLE IF NOT EXISTS bid_alerts (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), bid_id INTEGER NOT NULL REFERENCES bids(id), alert_type TEXT DEFAULT 'new_match', is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id, alert_type))`;
}
