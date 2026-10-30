/**
 * Contrax bid data feed — database side (owner 2026-10-06). The feed is sold to
 * businesses; access is granted by the owner from /admin/data-access, which
 * issues the customer an API key. Tables are created lazily (additive, safe on
 * every call) so no separate migration is needed before the page goes live.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import {
  GOVERNMENT_ONLY_EXCLUSIONS,
  parseSourceExclusions,
  refCodeForEmail,
  toFeedRow,
  type FeedQuery,
  type FeedRow,
} from "~/lib/data-feed";

export async function ensureDataFeedTables(): Promise<void> {
  await sql()`CREATE TABLE IF NOT EXISTS data_feed_requests (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT NOT NULL,
    use_case TEXT,
    states TEXT,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql()`CREATE TABLE IF NOT EXISTS data_feed_access (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE
  )`;
  // Self-serve Stripe plans (data-feed-billing.server.ts): tier, Starter's
  // chosen states (comma list; NULL = every state) and the subscription.
  await sql()`ALTER TABLE data_feed_access ADD COLUMN IF NOT EXISTS tier TEXT`;
  await sql()`ALTER TABLE data_feed_access ADD COLUMN IF NOT EXISTS states TEXT`;
  await sql()`ALTER TABLE data_feed_access ADD COLUMN IF NOT EXISTS status TEXT`;
  await sql()`ALTER TABLE data_feed_access ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;
  await sql()`ALTER TABLE data_feed_access ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`;
  await sql()`CREATE TABLE IF NOT EXISTS api_keys (id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),key_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL DEFAULT 'Default key',last_used_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),revoked BOOLEAN NOT NULL DEFAULT FALSE)`;
  // Partner licensing (owner 2026-10-22, Settle): sources the key may not
  // receive (comma list of LIKE patterns, e.g. "%_bidnet"), a daily request cap
  // (NULL = none, as before) and the referral code on each row's Contrax link.
  await sql()`ALTER TABLE data_feed_access ADD COLUMN IF NOT EXISTS source_exclusions TEXT`;
  await sql()`ALTER TABLE data_feed_access ADD COLUMN IF NOT EXISTS daily_request_limit INTEGER`;
  await sql()`ALTER TABLE data_feed_access ADD COLUMN IF NOT EXISTS ref_code TEXT`;
  await sql()`CREATE TABLE IF NOT EXISTS api_usage (
    key_id INTEGER NOT NULL,
    day DATE NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    rows_served INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (key_id, day)
  )`;
}

/** What a key may receive (feedUserFromRequest); RapidAPI and legacy keys get the defaults. */
export interface FeedAccess {
  keyId: number | null;
  sourceExclusions: string[];
  dailyLimit: number | null;
  ref: string | null;
}

/**
 * Count one request for the key today and say whether it is within the daily
 * cap. Keys without a cap are counted but never refused.
 */
export async function countRequest(access: FeedAccess): Promise<{ ok: true; used: number } | { ok: false; used: number }> {
  if (access.keyId == null) return { ok: true, used: 0 };
  const r = (await sql()`
    INSERT INTO api_usage (key_id, day, requests) VALUES (${access.keyId}, CURRENT_DATE, 1)
    ON CONFLICT (key_id, day) DO UPDATE SET requests = api_usage.requests + 1
    RETURNING requests`) as { requests: number }[];
  const used = Number(r[0]?.requests ?? 0);
  return access.dailyLimit != null && used > access.dailyLimit ? { ok: false, used } : { ok: true, used };
}

export async function countRows(access: FeedAccess, rows: number): Promise<void> {
  if (access.keyId == null || rows <= 0) return;
  await sql()`UPDATE api_usage SET rows_served = rows_served + ${rows} WHERE key_id = ${access.keyId} AND day = CURRENT_DATE`;
}

/**
 * RapidAPI marketplace (owner 2026-10-06): RapidAPI bills its buyers and forwards
 * their calls with X-RapidAPI-Proxy-Secret, a value only RapidAPI and this site
 * know (Vercel env RAPIDAPI_PROXY_SECRET). Off when the env var isn't set.
 * RapidAPI plans differ by request quota, which RapidAPI enforces; every state.
 */
export function isRapidApiRequest(headers: Headers, secret: string | undefined): boolean {
  const sent = headers.get("x-rapidapi-proxy-secret");
  if (!secret || !sent) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(sent), digest(secret));
}

/** The API key's user id when the key is valid AND that user has active feed access. */
export async function feedUserFromRequest(
  request: Request,
): Promise<
  | { userId: number | null; allowedStates: string[] | null; tier: string | null; rapidApi: boolean; access: FeedAccess }
  | { error: string; status: number }
> {
  if (isRapidApiRequest(request.headers, process.env.RAPIDAPI_PROXY_SECRET)) {
    return { userId: null, allowedStates: null, tier: null, rapidApi: true, access: { keyId: null, sourceExclusions: [], dailyLimit: null, ref: null } };
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "Missing API key. Send Authorization: Bearer <key>.", status: 401 };
  const hash = createHash("sha256").update(token).digest("hex");
  await ensureDataFeedTables();
  const rows = await sql()`
    SELECT k.id, k.user_id, a.active, a.states, a.tier, a.source_exclusions, a.daily_request_limit, a.ref_code
    FROM api_keys k LEFT JOIN data_feed_access a ON a.user_id = k.user_id
    WHERE k.key_hash = ${hash} AND k.revoked = FALSE
    LIMIT 1`;
  if (!rows.length) return { error: "Invalid API key.", status: 401 };
  const row = rows[0] as {
    id: number;
    user_id: number;
    active: boolean | null;
    states: string | null;
    tier: string | null;
    source_exclusions: string | null;
    daily_request_limit: number | null;
    ref_code: string | null;
  };
  if (!row.active) return { error: "This key does not have data feed access. Request access at https://www.contrax.company/data.", status: 403 };
  await sql()`UPDATE api_keys SET last_used_at = NOW() WHERE id = ${row.id}`;
  const allowedStates = row.states ? row.states.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
  return {
    userId: row.user_id,
    allowedStates: allowedStates && allowedStates.length ? allowedStates : null,
    tier: row.tier ?? null,
    rapidApi: false,
    access: {
      keyId: row.id,
      sourceExclusions: parseSourceExclusions(row.source_exclusions),
      dailyLimit: row.daily_request_limit == null ? null : Number(row.daily_request_limit),
      ref: row.ref_code ?? null,
    },
  };
}

/** Open opportunities matching the query, oldest id first (keyset paging on id). */
export async function queryFeed(
  q: FeedQuery,
  access: Pick<FeedAccess, "sourceExclusions" | "ref"> = { sourceExclusions: [], ref: null },
): Promise<{ rows: FeedRow[]; nextAfter: number | null }> {
  const s = sql();
  const sourcePred = access.sourceExclusions.length ? s`AND NOT (source LIKE ANY(${access.sourceExclusions}))` : s``;
  const categoryPred = q.categories.length ? s`AND category = ANY(${q.categories})` : s``;
  const statePred = q.states.length ? s`AND normalized_state = ANY(${q.states})` : s``;
  const updatedPred = q.updatedSince ? s`AND COALESCE(updated_at, created_at) >= ${q.updatedSince}` : s``;
  // NAICS values are validated as 2–6 digits, so the prefix pattern is digits and "|" only.
  const naicsPred = q.naics.length ? s`AND naics_code ~ ${`^(${q.naics.join("|")})`}` : s``;
  const setAsidePred = q.setAside ? s`AND set_aside ILIKE ${"%" + q.setAside.replace(/[%_\\]/g, (c) => "\\" + c) + "%"}` : s``;
  const rows = (await s`
    SELECT id, title, agency, description, normalized_state, location, category, naics_code, psc, set_aside,
           notice_type, solicitation_number, due_date, estimated_value, source_url, source, created_at, updated_at
    FROM bids
    WHERE due_date > NOW()
      AND id > ${q.after}
      AND ${s.unsafe(LOW_CONTENT_SQL)}
      AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
      ${statePred} ${updatedPred} ${naicsPred} ${setAsidePred} ${sourcePred} ${categoryPred}
    ORDER BY id ASC
    LIMIT ${q.limit + 1}`) as Record<string, unknown>[];
  const more = rows.length > q.limit;
  const page = rows.slice(0, q.limit).map((r) => toFeedRow(r, access.ref));
  return { rows: page, nextAfter: more && page.length ? page[page.length - 1].id : null };
}

/** Live headline numbers for the public page. */
export async function feedSummary(): Promise<{ open: number; states: number; sources: number }> {
  const s = sql();
  const r = (await s`
    SELECT COUNT(*)::int AS open,
           COUNT(DISTINCT normalized_state)::int AS states,
           COUNT(DISTINCT source)::int AS sources
    FROM bids
    WHERE due_date > NOW() AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}`) as { open: number; states: number; sources: number }[];
  return r[0] ?? { open: 0, states: 0, sources: 0 };
}

export interface DataRequestInput {
  name: string;
  email: string;
  company: string;
  useCase: string | null;
  states: string | null;
  message: string | null;
}

export async function insertDataRequest(d: DataRequestInput): Promise<number> {
  await ensureDataFeedTables();
  const r = (await sql()`
    INSERT INTO data_feed_requests (name, email, company, use_case, states, message)
    VALUES (${d.name}, ${d.email}, ${d.company}, ${d.useCase}, ${d.states}, ${d.message})
    RETURNING id`) as { id: number }[];
  return r[0].id;
}

export async function listDataAccess(): Promise<{
  requests: Record<string, unknown>[];
  grants: Record<string, unknown>[];
}> {
  await ensureDataFeedTables();
  const [requests, grants] = await Promise.all([
    sql()`SELECT id, name, email, company, use_case, states, message, status, created_at FROM data_feed_requests ORDER BY created_at DESC LIMIT 200`,
    sql()`
      SELECT a.user_id, u.email, a.granted_at, a.active, a.note, a.source_exclusions, a.daily_request_limit, a.ref_code,
             (SELECT COALESCE(SUM(g.requests), 0)::int FROM api_usage g JOIN api_keys k2 ON k2.id = g.key_id
               WHERE k2.user_id = a.user_id AND g.day > CURRENT_DATE - 30) AS requests_30d,
             (SELECT COALESCE(SUM(g.rows_served), 0)::int FROM api_usage g JOIN api_keys k2 ON k2.id = g.key_id
               WHERE k2.user_id = a.user_id AND g.day > CURRENT_DATE - 30) AS rows_30d,
             (SELECT MAX(k.last_used_at) FROM api_keys k WHERE k.user_id = a.user_id AND k.revoked = FALSE) AS last_used_at
      FROM data_feed_access a JOIN users u ON u.id = a.user_id
      ORDER BY a.granted_at DESC`,
  ]);
  return { requests: requests as Record<string, unknown>[], grants: grants as Record<string, unknown>[] };
}

/**
 * Turn on feed access for an existing Contrax account and issue it a new API
 * key. The raw key is returned ONCE (only its hash is stored) for the owner to
 * send to the customer.
 */
export async function grantDataAccess(
  email: string,
  note: string | null,
  opts: { governmentOnly?: boolean; dailyLimit?: number | null } = {},
): Promise<{ ok: true; key: string; userEmail: string } | { ok: false; error: string }> {
  await ensureDataFeedTables();
  const users = (await sql()`SELECT id, email FROM users WHERE LOWER(email) = ${email.trim().toLowerCase()} LIMIT 1`) as { id: number; email: string }[];
  if (!users.length) return { ok: false, error: "No Contrax account uses that email. Ask the customer to sign up first (any plan), then grant access." };
  const u = users[0];
  await sql()`
    INSERT INTO data_feed_access (user_id, note, active) VALUES (${u.id}, ${note}, TRUE)
    ON CONFLICT (user_id) DO UPDATE SET active = TRUE, note = COALESCE(EXCLUDED.note, data_feed_access.note), granted_at = NOW()`;
  // Partner terms (owner 2026-10-22): government sources only, a daily cap and
  // a referral code from the partner's email domain for attribution links.
  const exclusions = opts.governmentOnly ? GOVERNMENT_ONLY_EXCLUSIONS.join(",") : null;
  const limit = opts.dailyLimit != null && Number.isInteger(opts.dailyLimit) && opts.dailyLimit > 0 ? opts.dailyLimit : null;
  await sql()`
    UPDATE data_feed_access
    SET source_exclusions = ${exclusions}, daily_request_limit = ${limit}, ref_code = COALESCE(ref_code, ${refCodeForEmail(u.email)})
    WHERE user_id = ${u.id}`;
  const key = `cx_live_${randomBytes(24).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  await sql()`INSERT INTO api_keys (user_id, key_hash, name) VALUES (${u.id}, ${hash}, 'Data feed key')`;
  await sql()`UPDATE data_feed_requests SET status = 'granted' WHERE LOWER(email) = ${u.email.toLowerCase()} AND status = 'new'`;
  return { ok: true, key, userEmail: u.email };
}

/** Remove a data feed request from the admin list (owner 2026-10-30: dead leads). */
export async function deleteDataFeedRequest(id: number): Promise<boolean> {
  await ensureDataFeedTables();
  const rows = (await sql()`DELETE FROM data_feed_requests WHERE id = ${id} RETURNING id`) as unknown[];
  return rows.length > 0;
}

export async function revokeDataAccess(userId: number): Promise<void> {
  await ensureDataFeedTables();
  await sql()`UPDATE data_feed_access SET active = FALSE WHERE user_id = ${userId}`;
}

/** A signed-in account's data plan (for the /leads CSV download), or null without one. */
export async function dataPlanForUser(userId: number): Promise<{ tier: string | null } | null> {
  await ensureDataFeedTables();
  const rows = (await sql()`SELECT tier FROM data_feed_access WHERE user_id = ${userId} AND active = TRUE`) as { tier: string | null }[];
  return rows.length ? { tier: rows[0].tier ?? null } : null;
}

/**
 * Listing changes (bid_amendments, recorded by the sync since 2026-10-22) on
 * open bids the key may see, oldest first, keyset-paged by amendment id.
 */
export interface AmendmentRow {
  id: number;
  bid_id: number;
  change_type: string;
  old_value: string | null;
  new_value: string | null;
  detected_at: string | null;
  contrax_url: string;
}

export async function queryAmendments(
  q: { since: string | null; after: number; limit: number; states: string[] },
  access: Pick<FeedAccess, "sourceExclusions" | "ref">,
): Promise<{ rows: AmendmentRow[]; nextAfter: number | null }> {
  const s = sql();
  const sincePred = q.since ? s`AND a.detected_at >= ${q.since}` : s``;
  const statePred = q.states.length ? s`AND b.normalized_state = ANY(${q.states})` : s``;
  const sourcePred = access.sourceExclusions.length ? s`AND NOT (b.source LIKE ANY(${access.sourceExclusions}))` : s``;
  const rows = (await s`
    SELECT a.id, b.id AS bid_id, a.change_type, a.old_value, a.new_value, a.detected_at
    FROM bid_amendments a JOIN bids b ON a.bid_id = b.id::text
    WHERE a.id > ${q.after}
      AND b.due_date > NOW()
      AND ${s.unsafe(AWARD_EXCLUSION_SQL.replace(/\bsource\b/g, "b.source").replace(/\bnotice_type\b/g, "b.notice_type"))}
      ${sincePred} ${statePred} ${sourcePred}
    ORDER BY a.id ASC
    LIMIT ${q.limit + 1}`) as Record<string, unknown>[];
  const more = rows.length > q.limit;
  const { contraxBidUrl } = await import("~/lib/data-feed");
  const page = rows.slice(0, q.limit).map((r) => ({
    id: Number(r.id),
    bid_id: Number(r.bid_id),
    change_type: String(r.change_type),
    old_value: r.old_value == null ? null : String(r.old_value),
    new_value: r.new_value == null ? null : String(r.new_value),
    detected_at: r.detected_at == null ? null : new Date(String(r.detected_at)).toISOString(),
    contrax_url: contraxBidUrl(Number(r.bid_id), access.ref),
  }));
  return { rows: page, nextAfter: more && page.length ? page[page.length - 1]!.id : null };
}
