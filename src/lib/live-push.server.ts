/**
 * Mission Control live alerts (issue #788): storage and sending.
 *
 * - push_subscriptions: one row per device the owner turned alerts on for,
 *   bound to the admin user; deleted when the push service says 404/410.
 * - visit_alerts: one row per (visitor_id, visit_id); the INSERT is the
 *   atomic idempotency key, so a visit alerts once however many pages it has.
 * - VAPID keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env when set; otherwise
 *   generated once and kept server-side in push_vapid (the private key is never
 *   sent to a browser).
 *
 * Sending never throws into visitor intake: every failure is caught, logged and
 * recorded on the subscription row.
 */
import webpush from "web-push";
import { sql } from "~/db";
import { alertText, chatReplyAlertText, hotAlertText, subscriptionExpired, type PushSubscriptionInput } from "~/lib/live-push";

let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  ready ??= (async () => {
    await sql()`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_ok_at TIMESTAMPTZ,
      last_error TEXT
    )`;
    await sql()`CREATE TABLE IF NOT EXISTS visit_alerts (
      visitor_id TEXT NOT NULL,
      visit_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent INT NOT NULL DEFAULT 0,
      PRIMARY KEY (visitor_id, visit_id)
    )`;
    await sql()`CREATE TABLE IF NOT EXISTS push_vapid (
      id INT PRIMARY KEY,
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL
    )`;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

let vapid: { publicKey: string; privateKey: string } | null = null;
async function getVapid(): Promise<{ publicKey: string; privateKey: string }> {
  if (vapid) return vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    await ensureTables();
    const fresh = webpush.generateVAPIDKeys();
    await sql()`INSERT INTO push_vapid (id, public_key, private_key) VALUES (1, ${fresh.publicKey}, ${fresh.privateKey}) ON CONFLICT (id) DO NOTHING`;
    const [row] = (await sql()`SELECT public_key, private_key FROM push_vapid WHERE id = 1`) as { public_key: string; private_key: string }[];
    vapid = { publicKey: row.public_key, privateKey: row.private_key };
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:minetreen@gmail.com", vapid.publicKey, vapid.privateKey);
  return vapid;
}

export async function vapidPublicKey(): Promise<string> {
  return (await getVapid()).publicKey;
}

export async function saveSubscription(userId: number, s: PushSubscriptionInput): Promise<void> {
  await ensureTables();
  await sql()`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (${userId}, ${s.endpoint}, ${s.p256dh}, ${s.auth})
    ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, enabled = TRUE, last_error = NULL`;
}

export async function removeSubscription(userId: number, endpoint: string): Promise<void> {
  await ensureTables();
  await sql()`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} AND user_id = ${userId}`;
}

export async function setSubscriptionEnabled(userId: number, endpoint: string, enabled: boolean): Promise<void> {
  await ensureTables();
  await sql()`UPDATE push_subscriptions SET enabled = ${enabled} WHERE endpoint = ${endpoint} AND user_id = ${userId}`;
}

export interface DeviceStatus {
  devices: number;
  thisDevice: { enabled: boolean; lastOkAt: string | null; lastError: string | null } | null;
}

export async function deviceStatus(userId: number, endpoint: string | null): Promise<DeviceStatus> {
  await ensureTables();
  const rows = (await sql()`SELECT endpoint, enabled, last_ok_at, last_error FROM push_subscriptions WHERE user_id = ${userId}`) as {
    endpoint: string;
    enabled: boolean;
    last_ok_at: Date | string | null;
    last_error: string | null;
  }[];
  const mine = endpoint ? rows.find((r) => r.endpoint === endpoint) : undefined;
  const iso = (v: Date | string | null) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
  return {
    devices: rows.length,
    thisDevice: mine ? { enabled: mine.enabled, lastOkAt: iso(mine.last_ok_at), lastError: mine.last_error } : null,
  };
}

/** Send one payload to the given subscriptions; returns how many accepted it. */
async function sendTo(
  subs: { id: number; endpoint: string; p256dh: string; auth: string }[],
  payload: { title: string; body: string; tag: string; url?: string },
): Promise<number> {
  await getVapid();
  let ok = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 600, urgency: "high", timeout: 5000 },
        );
        ok++;
        await sql()`UPDATE push_subscriptions SET last_ok_at = NOW(), last_error = NULL WHERE id = ${s.id}`;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (subscriptionExpired(code)) {
          await sql()`DELETE FROM push_subscriptions WHERE id = ${s.id}`;
        } else {
          const msg = `${code ?? ""} ${(err as Error).message ?? err}`.trim().slice(0, 200);
          await sql()`UPDATE push_subscriptions SET last_error = ${msg} WHERE id = ${s.id}`;
        }
      }
    }),
  );
  return ok;
}

export async function sendTest(userId: number): Promise<number> {
  await ensureTables();
  const subs = (await sql()`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${userId}`) as {
    id: number;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[];
  return sendTo(subs, { title: "✅ Contrax live alerts are on", body: "You'll get one alert per new visitor session.", tag: "contrax-test" });
}

/**
 * Alert the owner about a visit, once. Called from visitor intake after the
 * page view is stored and exclusions passed; never throws.
 */
/**
 * One "🔥 Hot lead" push per visit when a real visitor reaches a hot page.
 * Same idempotency table as visit alerts, keyed `<visit_id>#hot`, so it never
 * repeats however many hot pages the visit opens. Never throws.
 */
export async function alertHotLead(v: {
  visitorId: string;
  visitId: string;
  path: string;
  city: string | null;
  region: string | null;
  device: string | null;
}): Promise<void> {
  try {
    await ensureTables();
    const subs = (await sql()`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE enabled`) as {
      id: number;
      endpoint: string;
      p256dh: string;
      auth: string;
    }[];
    if (!subs.length) return;
    const key = `${v.visitId}#hot`;
    const claimed = (await sql()`
      INSERT INTO visit_alerts (visitor_id, visit_id) VALUES (${v.visitorId}, ${key})
      ON CONFLICT DO NOTHING RETURNING visitor_id
    `) as unknown[];
    if (!claimed.length) return;
    const sent = await sendTo(subs, hotAlertText(v));
    await sql()`UPDATE visit_alerts SET sent = ${sent} WHERE visitor_id = ${v.visitorId} AND visit_id = ${key}`;
  } catch (err) {
    console.error("[live-push] hot-lead alert failed (non-fatal):", err);
  }
}

/** Push the owner a visitor's live-chat reply. No dedupe: replies are already capped per hour. Never throws. */
export async function alertChatReply(v: { visitorId: string; body: string }): Promise<void> {
  try {
    await ensureTables();
    const subs = (await sql()`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE enabled`) as {
      id: number;
      endpoint: string;
      p256dh: string;
      auth: string;
    }[];
    if (!subs.length) return;
    await sendTo(subs, chatReplyAlertText(v));
  } catch (err) {
    console.error("[live-push] chat reply alert failed (non-fatal):", err);
  }
}

export async function alertNewVisit(v: {
  visitorId: string;
  visitId: string;
  path: string;
  city: string | null;
  region: string | null;
  device: string | null;
}): Promise<void> {
  try {
    await ensureTables();
    const subs = (await sql()`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE enabled`) as {
      id: number;
      endpoint: string;
      p256dh: string;
      auth: string;
    }[];
    if (!subs.length) return;
    const claimed = (await sql()`
      INSERT INTO visit_alerts (visitor_id, visit_id) VALUES (${v.visitorId}, ${v.visitId})
      ON CONFLICT DO NOTHING RETURNING visitor_id
    `) as unknown[];
    if (!claimed.length) return;
    const [prior] = (await sql()`
      SELECT 1 AS seen FROM page_views
      WHERE visitor_id = ${v.visitorId} AND visit_id IS DISTINCT FROM ${v.visitId}
      LIMIT 1
    `) as { seen: number }[];
    const text = alertText({ ...v, returning: !!prior });
    const sent = await sendTo(subs, text);
    await sql()`UPDATE visit_alerts SET sent = ${sent} WHERE visitor_id = ${v.visitorId} AND visit_id = ${v.visitId}`;
  } catch (err) {
    console.error("[live-push] alert failed (non-fatal):", err);
  }
}

/** Push the owner a one-off alert (e.g. a payment) on every enabled device. Never throws. */
export async function alertOwner(payload: { title: string; body: string; tag: string; url?: string }): Promise<void> {
  try {
    await ensureTables();
    const subs = (await sql()`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE enabled`) as {
      id: number;
      endpoint: string;
      p256dh: string;
      auth: string;
    }[];
    if (!subs.length) return;
    await sendTo(subs, payload);
  } catch (err) {
    console.error("[live-push] owner alert failed (non-fatal):", err);
  }
}
