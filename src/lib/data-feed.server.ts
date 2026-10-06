/**
 * Contrax bid data feed — database side (owner 2026-10-06). The feed is sold to
 * businesses; access is granted by the owner from /admin/data-access, which
 * issues the customer an API key. Tables are created lazily (additive, safe on
 * every call) so no separate migration is needed before the page goes live.
 */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { toFeedRow, type FeedQuery, type FeedRow } from "~/lib/data-feed";

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
}

/** The API key's user id when the key is valid AND that user has active feed access. */
export async function feedUserFromRequest(
  request: Request,
): Promise<{ userId: number; allowedStates: string[] | null } | { error: string; status: number }> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "Missing API key. Send Authorization: Bearer <key>.", status: 401 };
  const hash = createHash("sha256").update(token).digest("hex");
  await ensureDataFeedTables();
  const rows = await sql()`
    SELECT k.id, k.user_id, a.active, a.states
    FROM api_keys k LEFT JOIN data_feed_access a ON a.user_id = k.user_id
    WHERE k.key_hash = ${hash} AND k.revoked = FALSE
    LIMIT 1`;
  if (!rows.length) return { error: "Invalid API key.", status: 401 };
  const row = rows[0] as { id: number; user_id: number; active: boolean | null; states: string | null };
  if (!row.active) return { error: "This key does not have data feed access. Request access at https://www.contrax.company/data.", status: 403 };
  await sql()`UPDATE api_keys SET last_used_at = NOW() WHERE id = ${row.id}`;
  const allowedStates = row.states ? row.states.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : null;
  return { userId: row.user_id, allowedStates: allowedStates && allowedStates.length ? allowedStates : null };
}

/** Open opportunities matching the query, oldest id first (keyset paging on id). */
export async function queryFeed(q: FeedQuery): Promise<{ rows: FeedRow[]; nextAfter: number | null }> {
  const s = sql();
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
      ${statePred} ${updatedPred} ${naicsPred} ${setAsidePred}
    ORDER BY id ASC
    LIMIT ${q.limit + 1}`) as Record<string, unknown>[];
  const more = rows.length > q.limit;
  const page = rows.slice(0, q.limit).map(toFeedRow);
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
      SELECT a.user_id, u.email, a.granted_at, a.active, a.note,
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
export async function grantDataAccess(email: string, note: string | null): Promise<{ ok: true; key: string; userEmail: string } | { ok: false; error: string }> {
  await ensureDataFeedTables();
  const users = (await sql()`SELECT id, email FROM users WHERE LOWER(email) = ${email.trim().toLowerCase()} LIMIT 1`) as { id: number; email: string }[];
  if (!users.length) return { ok: false, error: "No Contrax account uses that email. Ask the customer to sign up first (any plan), then grant access." };
  const u = users[0];
  await sql()`
    INSERT INTO data_feed_access (user_id, note, active) VALUES (${u.id}, ${note}, TRUE)
    ON CONFLICT (user_id) DO UPDATE SET active = TRUE, note = COALESCE(EXCLUDED.note, data_feed_access.note), granted_at = NOW()`;
  const key = `cx_live_${randomBytes(24).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  await sql()`INSERT INTO api_keys (user_id, key_hash, name) VALUES (${u.id}, ${hash}, 'Data feed key')`;
  await sql()`UPDATE data_feed_requests SET status = 'granted' WHERE LOWER(email) = ${u.email.toLowerCase()} AND status = 'new'`;
  return { ok: true, key, userEmail: u.email };
}

export async function revokeDataAccess(userId: number): Promise<void> {
  await ensureDataFeedTables();
  await sql()`UPDATE data_feed_access SET active = FALSE WHERE user_id = ${userId}`;
}
