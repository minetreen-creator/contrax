/** Storage for co-op trade alerts (src/lib/coop-alerts.ts). */
import { randomUUID } from "node:crypto";
import { sql } from "~/db";
import type { CoopSolicitation } from "~/lib/coop-contracts";

export async function ensureCoopAlertTable(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS coop_alerts (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      trade TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      notified_keys TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      unsubscribed_at TIMESTAMPTZ,
      UNIQUE (email, trade)
    )`;
}

/**
 * Save an alert. Categories already open when someone signs up count as "told" (they are on the page they
 * just saw), so the first email is for a category that opens later. Never resurrects an unsubscribed alert.
 */
export async function addCoopAlert(email: string, trade: string, openNow: CoopSolicitation[]): Promise<"saved" | "unsubscribed"> {
  await ensureCoopAlertTable();
  const seen = openNow.filter((s) => s.trades.includes(trade)).map((s) => s.key);
  const rows = (await sql()`
    INSERT INTO coop_alerts (email, trade, token, notified_keys)
    VALUES (${email}, ${trade}, ${randomUUID()}, ${seen})
    ON CONFLICT (email, trade) DO UPDATE SET email = EXCLUDED.email
    RETURNING unsubscribed_at
  `) as { unsubscribed_at: string | null }[];
  return rows[0]?.unsubscribed_at ? "unsubscribed" : "saved";
}

export async function unsubscribeCoopAlert(token: string): Promise<"done" | "already" | "missing"> {
  const rows = (await sql()`SELECT unsubscribed_at FROM coop_alerts WHERE token = ${token}`) as { unsubscribed_at: string | null }[];
  if (!rows[0]) return "missing";
  if (rows[0].unsubscribed_at) return "already";
  await sql()`UPDATE coop_alerts SET unsubscribed_at = NOW() WHERE token = ${token}`;
  return "done";
}

export async function activeCoopAlerts(): Promise<{ id: number; email: string; trade: string; token: string; notified_keys: string[] }[]> {
  await ensureCoopAlertTable();
  return (await sql()`SELECT id, email, trade, token, notified_keys FROM coop_alerts WHERE unsubscribed_at IS NULL`) as {
    id: number; email: string; trade: string; token: string; notified_keys: string[];
  }[];
}

export async function markCoopAlertNotified(id: number, keys: string[]): Promise<void> {
  await sql()`UPDATE coop_alerts SET notified_keys = (SELECT ARRAY(SELECT DISTINCT unnest(notified_keys || ${keys}::text[]))) WHERE id = ${id}`;
}
