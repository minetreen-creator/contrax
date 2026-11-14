/** DB step for ./profile-seed (owner 2026-11-04). Never throws. */
import { profileFromAnswer, profileFromSearches, type SearchRow } from "./profile-seed";

type SqlFactory = () => any;

/** Give an account with no business profile one from its visitor's latest real search. */
export async function seedProfileFromSearches(db: SqlFactory, userId: number | string, visitorId: string | null | undefined): Promise<boolean> {
  if (!visitorId || !/^[A-Za-z0-9-]{8,64}$/.test(visitorId)) return false;
  try {
    const uid = Number(userId);
    if (!Number.isFinite(uid)) return false;
    const existing = (await db()`SELECT 1 FROM business_profiles WHERE user_id = ${uid} LIMIT 1`) as unknown[];
    if (existing.length) return false;
    const searches = (await db()`SELECT trade, state, matched FROM radar_search_log
      WHERE visitor_id = ${visitorId} AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC LIMIT 20`) as SearchRow[];
    const p = profileFromSearches(searches);
    if (!p) return false;
    await db()`INSERT INTO business_profiles (user_id, business_name, industry, locations, service_categories, naics_codes)
      VALUES (${uid}, '', ${p.industry}, ${JSON.stringify(p.locations)}::jsonb, '[]'::jsonb, ${JSON.stringify(p.naicsCodes)}::jsonb)`;
    console.log(`[profile-seed] account ${uid}: trade from search "${p.industry}" ${p.locations.join(",") || "(no state)"}`);
    return true;
  } catch (e) {
    console.error("[profile-seed] failed (non-fatal):", (e as Error).message);
    return false;
  }
}

/** Give a new account its profile from the trade and state it typed at signup. Never throws. */
export async function seedProfileFromAnswer(db: SqlFactory, userId: number | string, trade: string | null | undefined, state: string | null | undefined): Promise<boolean> {
  try {
    const uid = Number(userId);
    if (!Number.isFinite(uid)) return false;
    const p = profileFromAnswer(trade, state);
    if (!p) return false;
    const existing = (await db()`SELECT 1 FROM business_profiles WHERE user_id = ${uid} LIMIT 1`) as unknown[];
    if (existing.length) return false;
    await db()`INSERT INTO business_profiles (user_id, business_name, industry, locations, service_categories, naics_codes)
      VALUES (${uid}, '', ${p.industry}, ${JSON.stringify(p.locations)}::jsonb, '[]'::jsonb, ${JSON.stringify(p.naicsCodes)}::jsonb)`;
    console.log(`[profile-seed] account ${uid}: trade from signup form "${p.industry}" ${p.locations.join(",") || "(no state)"}`);
    return true;
  } catch (e) {
    console.error("[profile-seed] signup answer failed (non-fatal):", (e as Error).message);
    return false;
  }
}
