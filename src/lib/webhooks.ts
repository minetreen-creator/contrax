/**
 * Webhook delivery for Contrax — outbound HTTP webhooks (Zapier-ready).
 *
 * A webhook is a per-user endpoint URL (typically a Zapier "Webhooks →
 * Catch Hook" URL, but any HTTPS endpoint works) that receives a signed POST
 * whenever a matching event fires. The only event today is `bid_match`,
 * delivered from generateBidAlerts() when a new bid matches a user's
 * business profile.
 *
 * Design goals (from the plan): keep it simple — fire-and-log, no queue.
 * Delivery attempts are logged to `webhook_deliveries` with HTTP status.
 * Failures retry ONCE for 5xx/timeouts/network errors; 4xx is never retried.
 *
 * Runtime note: this module must stay free of `node:` imports because it is
 * imported from `src/lib/bid-alerts.ts`, which is reachable from client
 * route files (via alerts.tsx's server functions) — TanStack Start's
 * import-protection blocks node builtins there. The Web Crypto API is
 * available in Node 19+ (Vercel), Bun, and browsers, same approach as
 * `src/lib/password.ts`.
 */
import { sql } from "~/db";

export interface Webhook {
  id: number;
  user_id: number;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Populated by listWebhooks() only. */
  last_delivery?: WebhookDelivery | null;
}

export interface WebhookDelivery {
  id: number;
  webhook_id: number;
  event: string;
  status_code: number | null;
  attempt: number;
  success: boolean;
  error: string | null;
  created_at: string;
}

/** A single bid_match event to deliver (collected by generateBidAlerts). */
export interface BidMatchEvent {
  userId: number;
  bid: {
    title: string | null;
    agency: string | null;
    set_aside: string | null;
    location: string | null;
    due_date: string | null;
    source_url: string | null;
  };
  matchedOn: string[];
}

const DEFAULT_EVENTS = ["bid_match"] as const;
const SIGNATURE_HEADER = "X-Contrax-Signature";
const TIMEOUT_MS = 10_000;

// ── Table helpers ────────────────────────────────────────────────────────────
export async function ensureWebhooksTable() {
  await sql()`CREATE TABLE IF NOT EXISTS webhooks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events JSONB NOT NULL DEFAULT '["bid_match"]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql()`CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id SERIAL PRIMARY KEY,
    webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    payload JSONB NOT NULL,
    status_code INTEGER,
    attempt INTEGER NOT NULL DEFAULT 1,
    success BOOLEAN NOT NULL DEFAULT false,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

// ── Crypto helpers (Web Crypto — no node: imports) ───────────────────────────
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/** 256-bit random hex token, generated once per webhook and shown to the user. */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** HMAC-SHA256 over the raw request body → `sha256=<hex>` header value. */
export async function signPayload(body: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return `sha256=${toHex(new Uint8Array(sig))}`;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
function toWebhook(row: any): Webhook {
  let events: string[] = DEFAULT_EVENTS as unknown as string[];
  try {
    const parsed = typeof row.events === "string" ? JSON.parse(row.events) : row.events;
    if (Array.isArray(parsed)) events = parsed.map(String);
  } catch {
    // fall through to default events
  }
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    name: String(row.name || ""),
    url: String(row.url || ""),
    events,
    is_active: row.is_active === true || row.is_active === "true" || row.is_active === 1 || row.is_active === "1",
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/**
 * Create a webhook. Returns the generated secret ONLY here — it is never
 * stored retrievably again (the DB keeps it for signing; the UI shows it
 * once, right after creation).
 */
export async function createWebhook(input: {
  userId: number;
  name: string;
  url: string;
}): Promise<{ webhook: Webhook; secret: string }> {
  await ensureWebhooksTable();
  const name = String(input.name || "").trim();
  const url = String(input.url || "").trim();
  if (!name) throw new Error("Webhook name is required.");
  if (!url) throw new Error("Webhook URL is required.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Webhook URL must be a valid URL (e.g. https://hooks.zapier.com/...).");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Webhook URL must start with https:// or http://.");
  }
  const secret = generateWebhookSecret();
  const rows = await sql()`INSERT INTO webhooks (user_id, name, url, secret, events)
    VALUES (${input.userId}, ${name}, ${url}, ${secret}, ${JSON.stringify(DEFAULT_EVENTS)}::jsonb)
    RETURNING id, user_id, name, url, events, is_active, created_at, updated_at`;
  if (!rows.length) throw new Error("Failed to create webhook.");
  return { webhook: toWebhook(rows[0]), secret };
}

export async function listWebhooks(userId: number): Promise<Webhook[]> {
  await ensureWebhooksTable();
  const rows = await sql()`SELECT id, user_id, name, url, events, is_active, created_at, updated_at
    FROM webhooks WHERE user_id = ${userId} ORDER BY created_at DESC`;
  const webhooks = (rows as any[]).map(toWebhook);
  if (webhooks.length === 0) return webhooks;
  // Attach the most recent delivery per webhook so the UI can show status.
  const deliveries = await sql()`SELECT DISTINCT ON (webhook_id) webhook_id, id, event, status_code, attempt, success, error, created_at
    FROM webhook_deliveries WHERE webhook_id = ANY(${webhooks.map((w) => w.id)})
    ORDER BY webhook_id, created_at DESC`;
  const byId = new Map<number, WebhookDelivery>();
  for (const d of deliveries as any[]) {
    byId.set(Number(d.webhook_id), {
      id: Number(d.id),
      webhook_id: Number(d.webhook_id),
      event: String(d.event),
      status_code: d.status_code == null ? null : Number(d.status_code),
      attempt: Number(d.attempt),
      success: d.success === true || d.success === "true" || d.success === 1 || d.success === "1",
      error: d.error == null ? null : String(d.error),
      created_at: String(d.created_at),
    });
  }
  for (const w of webhooks) w.last_delivery = byId.get(w.id) ?? null;
  return webhooks;
}

export async function updateWebhook(
  userId: number,
  webhookId: number,
  patch: { name?: string; url?: string; isActive?: boolean },
): Promise<Webhook> {
  await ensureWebhooksTable();
  const existing = await sql()`SELECT * FROM webhooks WHERE id = ${webhookId} AND user_id = ${userId} LIMIT 1`;
  if (!existing.length) throw new Error("Webhook not found.");
  const current = existing[0] as any;
  const name = patch.name !== undefined ? String(patch.name).trim() : String(current.name);
  const url = patch.url !== undefined ? String(patch.url).trim() : String(current.url);
  if (!name) throw new Error("Webhook name is required.");
  if (!url) throw new Error("Webhook URL is required.");
  if (patch.url !== undefined) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("Webhook URL must start with https:// or http://.");
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Webhook URL")) throw e;
      throw new Error("Webhook URL must be a valid URL (e.g. https://hooks.zapier.com/...).");
    }
  }
  const isActive = patch.isActive !== undefined ? patch.isActive : current.is_active;
  const rows = await sql()`UPDATE webhooks SET name = ${name}, url = ${url}, is_active = ${isActive}, updated_at = NOW()
    WHERE id = ${webhookId} AND user_id = ${userId}
    RETURNING id, user_id, name, url, events, is_active, created_at, updated_at`;
  if (!rows.length) throw new Error("Webhook not found.");
  return toWebhook(rows[0]);
}

export async function deleteWebhook(userId: number, webhookId: number): Promise<boolean> {
  await ensureWebhooksTable();
  const rows = await sql()`DELETE FROM webhooks WHERE id = ${webhookId} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

/** A webhook with its signing secret loaded (server-side delivery only — the
 * secret must never be serialized to the client; the UI shows it once at
 * creation time). */
type SecretWebhook = Webhook & { secret: string };

/** Load active webhooks that subscribe to the given event for a set of users. */
async function activeWebhooksForUsers(userIds: number[]): Promise<SecretWebhook[]> {
  await ensureWebhooksTable();
  const rows = await sql()`SELECT id, user_id, name, url, events, is_active, created_at, updated_at, secret
    FROM webhooks WHERE is_active = true AND user_id = ANY(${userIds})`;
  return (rows as any[])
    .map((r) => ({ ...toWebhook(r), secret: String(r.secret || "") }))
    .filter((w: SecretWebhook) => w.events.includes("bid_match"));
}

// ── Delivery ─────────────────────────────────────────────────────────────────
function logDelivery(input: {
  webhookId: number;
  event: string;
  payload: unknown;
  statusCode: number | null;
  attempt: number;
  success: boolean;
  error: string | null;
}) {
  return sql()`INSERT INTO webhook_deliveries (webhook_id, event, payload, status_code, attempt, success, error)
    VALUES (${input.webhookId}, ${input.event}, ${JSON.stringify(input.payload)}::jsonb,
            ${input.statusCode}, ${input.attempt}, ${input.success}, ${input.error})`;
}

/** One POST attempt to a webhook URL. Resolves { statusCode, error }. */
async function postOnce(
  url: string,
  secret: string,
  event: string,
  payload: unknown,
): Promise<{ statusCode: number | null; error: string | null }> {
  const body = JSON.stringify(payload);
  const signature = await signPayload(body, secret);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Contrax-Webhook/1.0",
        "X-Contrax-Event": event,
        [SIGNATURE_HEADER]: signature,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { statusCode: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { statusCode: null, error: `Request failed: ${msg}` };
  }
}

/**
 * Deliver a single webhook event to one webhook. Retries ONCE on
 * 5xx/timeout/network failure; 4xx and 2xx are never retried. Every attempt
 * is logged to webhook_deliveries. Never throws — delivery failures are
 * recorded, not propagated (bid sync must not fail because a webhook URL
 * is down).
 */
export async function deliverWebhook(
  webhook: SecretWebhook,
  event: string,
  payload: unknown,
): Promise<{ delivered: boolean; attempts: number; statusCode: number | null }> {
  try {
    let result = await postOnce(webhook.url, webhook.secret, event, payload);
    const status = result.statusCode ?? 0;
    // 2xx → success. 4xx → client error, no retry. 5xx/timeout/network → retry once.
    if (status >= 200 && status < 300) {
      await logDelivery({ webhookId: webhook.id, event, payload, statusCode: status, attempt: 1, success: true, error: null });
      return { delivered: true, attempts: 1, statusCode: status };
    }
    if (status >= 400 && status < 500) {
      await logDelivery({ webhookId: webhook.id, event, payload, statusCode: status, attempt: 1, success: false, error: result.error });
      return { delivered: false, attempts: 1, statusCode: status };
    }
    // 5xx, 0 (network error/timeout) → log attempt 1, retry once.
    await logDelivery({ webhookId: webhook.id, event, payload, statusCode: status, attempt: 1, success: false, error: result.error });
    result = await postOnce(webhook.url, webhook.secret, event, payload);
    const status2 = result.statusCode ?? 0;
    const success2 = status2 >= 200 && status2 < 300;
    await logDelivery({
      webhookId: webhook.id, event, payload,
      statusCode: status2, attempt: 2, success: success2, error: result.error,
    });
    return { delivered: success2, attempts: 2, statusCode: status2 };
  } catch (e) {
    // Logging itself failed — nothing else to do; don't throw into the sync loop.
    console.error(`[webhooks] deliver ${webhook.id} crashed:`, e instanceof Error ? e.message : e);
    return { delivered: false, attempts: 0, statusCode: null };
  }
}

function buildBidMatchPayload(event: BidMatchEvent) {
  return {
    event: "bid_match",
    bid: {
      title: event.bid.title ?? null,
      agency: event.bid.agency ?? null,
      set_aside: event.bid.set_aside ?? null,
      location: event.bid.location ?? null,
      due_date: event.bid.due_date ?? null,
      source_url: event.bid.source_url ?? null,
    },
    matched_on: event.matchedOn,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Fire `bid_match` webhooks for every user who received a new bid alert.
 * Loads active webhooks once, then delivers (fire-and-log, sequential).
 * Returns the number of webhook deliveries that were attempted. Never throws.
 */
export async function fireBidMatchWebhooks(events: BidMatchEvent[]): Promise<number> {
  if (!events.length) return 0;
  const userIds = [...new Set(events.map((e) => e.userId))];
  let webhooks: SecretWebhook[] = [];
  try {
    webhooks = await activeWebhooksForUsers(userIds);
  } catch (e) {
    console.error("[webhooks] failed to load active webhooks:", e instanceof Error ? e.message : e);
    return 0;
  }
  if (!webhooks.length) return 0;
  let attempted = 0;
  for (const event of events) {
    const payload = buildBidMatchPayload(event);
    for (const webhook of webhooks) {
      if (webhook.user_id !== event.userId) continue;
      attempted++;
      await deliverWebhook(webhook, "bid_match", payload);
    }
  }
  return attempted;
}

// ── Test event (Zapier setup) ────────────────────────────────────────────────
/**
 * Send a sample `bid_match` event to a webhook so the user can verify their
 * Zap/CRM mapping in Zapier immediately after setup. Returns the delivery
 * outcome (or null when the webhook can't be loaded).
 */
export async function sendTestEvent(
  userId: number,
  webhookId: number,
): Promise<{ webhook: Webhook; delivered: boolean; attempts: number; statusCode: number | null } | null> {
  await ensureWebhooksTable();
  const rows = await sql()`SELECT * FROM webhooks WHERE id = ${webhookId} AND user_id = ${userId} LIMIT 1`;
  if (!rows.length) return null;
  const raw = rows[0] as any;
  const webhook: SecretWebhook = { ...toWebhook(raw), secret: String(raw.secret || "") };
  const payload = {
    event: "bid_match",
    bid: {
      title: "TEST — Janitorial Services for Federal Building (Sample Match)",
      agency: "General Services Administration",
      set_aside: "8(a) Set-Aside (Competitive)",
      location: "Washington, DC",
      due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      source_url: "https://sam.gov/opp/sample-test",
    },
    matched_on: ["set_aside", "naics"],
    timestamp: new Date().toISOString(),
  };
  const outcome = await deliverWebhook(webhook, "bid_match", payload);
  // Return the public shape (no secret) so the API response never leaks it.
  return { webhook: toWebhook(raw), ...outcome };
}
