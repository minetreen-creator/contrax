/**
 * Daily bid outreach: storage, sending and unsubscribe (see outreach.ts).
 *
 * Tables
 *   outreach_contacts     one row per queued email (first or follow-up); an
 *                         address gets at most one of each, ever
 *   outreach_suppressions addresses never to email again (unsubscribed,
 *                         "stop", bounced, contacted by hand)
 *   outreach_settings     the postal address printed in every email, set on
 *                         /admin/outreach (kept out of the public repository)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { sql } from "~/db";
import {
  CONTACTED_BY_HAND,
  FOLLOWUP_AFTER_DAYS,
  FOLLOWUP_MIN_DAYS_TO_DUE,
  MAX_SEND_PER_BATCH,
  outreachEmail,
  validPostalAddress,
  type OutreachKind,
} from "./outreach";

export const OUTREACH_FROM = "Nathaniel Minetree (Contrax) <hello@contrax.company>";
export const OUTREACH_REPLY_TO = "minetreen@gmail.com";

export async function ensureOutreach(): Promise<void> {
  const db = sql();
  await db`CREATE TABLE IF NOT EXISTS outreach_contacts (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'first',
    business TEXT NOT NULL,
    website TEXT,
    bid_id INTEGER NOT NULL,
    bid_title TEXT NOT NULL,
    buyer TEXT,
    due_date DATE NOT NULL,
    trade_label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    error TEXT,
    resend_id TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await db`CREATE UNIQUE INDEX IF NOT EXISTS outreach_contacts_email_kind ON outreach_contacts (LOWER(email), kind)`;
  // Prime emails (owner 2026-10-30): the state the awarded work is in.
  await db`ALTER TABLE outreach_contacts ADD COLUMN IF NOT EXISTS place TEXT`;
  await db`CREATE TABLE IF NOT EXISTS outreach_suppressions (
    email TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await db`CREATE TABLE IF NOT EXISTS outreach_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    postal_address TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await db.query(
    `INSERT INTO outreach_suppressions (email, reason) SELECT UNNEST($1::text[]), 'contacted_by_hand' ON CONFLICT DO NOTHING`,
    [[...CONTACTED_BY_HAND]],
  );
}

// ── Unsubscribe tokens ───────────────────────────────────────────────────────

function tokenKey(env: Record<string, string | undefined> = process.env): Buffer {
  const secret = env.OUTREACH_SECRET || env.CRON_SECRET || env.RESEND_API_KEY;
  if (!secret) throw new Error("No secret available to sign outreach unsubscribe links");
  return createHmac("sha256", "contrax-outreach-unsubscribe").update(secret).digest();
}

export function unsubscribeToken(email: string, env?: Record<string, string | undefined>): string {
  const e = email.trim().toLowerCase();
  const sig = createHmac("sha256", tokenKey(env)).update(e).digest("base64url").slice(0, 32);
  return `${Buffer.from(e).toString("base64url")}.${sig}`;
}

/** The address a valid token names, or null. */
export function verifyUnsubscribeToken(token: string, env?: Record<string, string | undefined>): string | null {
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  let email: string;
  try {
    email = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!email.includes("@")) return null;
  const expected = unsubscribeToken(email, env).split(".")[1]!;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? email : null;
}

export function unsubscribeUrl(email: string): string {
  return `https://www.contrax.company/api/outreach/unsubscribe?t=${encodeURIComponent(unsubscribeToken(email))}`;
}

export async function suppress(email: string, reason: string): Promise<void> {
  await ensureOutreach();
  const e = email.trim().toLowerCase();
  await sql()`INSERT INTO outreach_suppressions (email, reason) VALUES (${e}, ${reason}) ON CONFLICT (email) DO NOTHING`;
  await sql()`UPDATE outreach_contacts SET status = 'skipped', error = ${`suppressed: ${reason}`} WHERE LOWER(email) = ${e} AND status = 'draft'`;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getPostalAddress(): Promise<string | null> {
  await ensureOutreach();
  const rows = (await sql()`SELECT postal_address FROM outreach_settings WHERE id = 1`) as { postal_address: string | null }[];
  return rows[0]?.postal_address ?? null;
}

export async function setPostalAddress(address: string): Promise<void> {
  await ensureOutreach();
  const a = address.trim();
  if (!validPostalAddress(a)) throw new Error("Enter a full mailing address");
  await sql()`INSERT INTO outreach_settings (id, postal_address, updated_at) VALUES (1, ${a}, NOW())
    ON CONFLICT (id) DO UPDATE SET postal_address = EXCLUDED.postal_address, updated_at = NOW()`;
}

// ── Queue ────────────────────────────────────────────────────────────────────

export interface QueuedProspect {
  email: string;
  business: string;
  website: string | null;
  bidId: number;
  bidTitle: string;
  buyer: string | null;
  due: string;
  tradeLabel: string;
}

/** True when this address may get a first email (never contacted, not suppressed). */
export async function isNewAddress(email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const rows = (await sql()`
    SELECT 1 FROM outreach_suppressions WHERE email = ${e}
    UNION ALL SELECT 1 FROM outreach_contacts WHERE LOWER(email) = ${e}
    LIMIT 1`) as unknown[];
  return rows.length === 0;
}

/** Queue a first-email draft; false when the address is already known. */
export async function queueFirst(p: QueuedProspect): Promise<boolean> {
  if (!(await isNewAddress(p.email))) return false;
  const rows = (await sql()`
    INSERT INTO outreach_contacts (email, kind, business, website, bid_id, bid_title, buyer, due_date, trade_label)
    VALUES (${p.email.trim().toLowerCase()}, 'first', ${p.business}, ${p.website}, ${p.bidId}, ${p.bidTitle}, ${p.buyer}, ${p.due}, ${p.tradeLabel})
    ON CONFLICT DO NOTHING RETURNING id`) as unknown[];
  return rows.length > 0;
}

export interface QueuedPrime {
  email: string;
  business: string;
  website: string | null;
  /** award_leads.id (kept in bid_id; prime rows never look up a bid). */
  awardId: number;
  description: string;
  agency: string | null;
  place: string;
  tradeLabel: string;
}

/**
 * Queue a prime-contractor draft (owner 2026-10-30). There is no deadline, so
 * due_date holds the day the draft goes stale (30 days out), which keeps it on
 * the send list until then. False when the address is already known.
 */
export async function queuePrime(p: QueuedPrime): Promise<boolean> {
  if (!(await isNewAddress(p.email))) return false;
  const rows = (await sql()`
    INSERT INTO outreach_contacts (email, kind, business, website, bid_id, bid_title, buyer, due_date, trade_label, place)
    VALUES (${p.email.trim().toLowerCase()}, 'prime', ${p.business}, ${p.website}, ${p.awardId}, ${p.description}, ${p.agency},
            CURRENT_DATE + 30, ${p.tradeLabel}, ${p.place})
    ON CONFLICT DO NOTHING RETURNING id`) as unknown[];
  return rows.length > 0;
}

/** Queue follow-up drafts for first emails sent FOLLOWUP_AFTER_DAYS ago whose bid is still open. */
export async function queueFollowups(): Promise<number> {
  await ensureOutreach();
  const rows = (await sql().query(
    `INSERT INTO outreach_contacts (email, kind, business, website, bid_id, bid_title, buyer, due_date, trade_label)
     SELECT c.email, 'followup', c.business, c.website, c.bid_id, c.bid_title, c.buyer, c.due_date, c.trade_label
     FROM outreach_contacts c
     WHERE c.kind = 'first' AND c.status = 'sent'
       AND c.sent_at <= NOW() - ($1 || ' days')::interval
       AND c.due_date >= CURRENT_DATE + $2::int
       AND NOT EXISTS (SELECT 1 FROM outreach_suppressions s WHERE s.email = LOWER(c.email))
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [String(FOLLOWUP_AFTER_DAYS), FOLLOWUP_MIN_DAYS_TO_DUE],
  )) as unknown[];
  return rows.length;
}

export interface ContactRow {
  id: number;
  email: string;
  kind: OutreachKind;
  business: string;
  website: string | null;
  bid_id: number;
  bid_title: string;
  buyer: string | null;
  due_date: string;
  trade_label: string;
  place?: string | null;
  status: string;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));
const day = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

function normalize(r: Record<string, unknown>): ContactRow {
  return {
    ...(r as unknown as ContactRow),
    due_date: day(r.due_date),
    sent_at: iso(r.sent_at),
    created_at: iso(r.created_at)!,
  };
}

export async function outreachOverview(): Promise<{
  postalAddress: string | null;
  drafts: ContactRow[];
  recent: ContactRow[];
  stats: { sentFirst: number; sentFollowup: number; sentToday: number; suppressed: number; drafts: number };
}> {
  await ensureOutreach();
  const db = sql();
  const drafts = ((await db`
    SELECT * FROM outreach_contacts WHERE status = 'draft' AND due_date >= CURRENT_DATE + 2
    ORDER BY kind DESC, due_date ASC, id ASC LIMIT 200`) as Record<string, unknown>[]).map(normalize);
  const recent = ((await db`
    SELECT * FROM outreach_contacts WHERE status IN ('sent', 'failed') ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 50`) as Record<string, unknown>[]).map(normalize);
  const [s] = (await db`
    SELECT
      COUNT(*) FILTER (WHERE kind = 'first' AND status = 'sent')::int AS sent_first,
      COUNT(*) FILTER (WHERE kind = 'followup' AND status = 'sent')::int AS sent_followup,
      COUNT(*) FILTER (WHERE status = 'sent' AND sent_at >= CURRENT_DATE)::int AS sent_today,
      COUNT(*) FILTER (WHERE status = 'draft')::int AS drafts
    FROM outreach_contacts`) as { sent_first: number; sent_followup: number; sent_today: number; drafts: number }[];
  const [sup] = (await db`SELECT COUNT(*)::int AS n FROM outreach_suppressions WHERE reason <> 'contacted_by_hand'`) as { n: number }[];
  return {
    postalAddress: await getPostalAddress(),
    drafts,
    recent,
    stats: {
      sentFirst: s?.sent_first ?? 0,
      sentFollowup: s?.sent_followup ?? 0,
      sentToday: s?.sent_today ?? 0,
      suppressed: sup?.n ?? 0,
      drafts: s?.drafts ?? 0,
    },
  };
}

/** Skip every waiting draft (they can be re-queued later; skipped rows never send). */
export async function skipAllDrafts(reason: string): Promise<number> {
  await ensureOutreach();
  const rows = (await sql()`UPDATE outreach_contacts SET status = 'skipped', error = ${reason} WHERE status = 'draft' RETURNING id`) as unknown[];
  return rows.length;
}

export async function skipDraft(id: number): Promise<void> {
  await ensureOutreach();
  await sql()`UPDATE outreach_contacts SET status = 'skipped' WHERE id = ${id} AND status = 'draft'`;
}

/** The email a draft row would send (for the admin preview and for sending). */
export function renderContact(row: ContactRow, postalAddress: string, sourceUrl: string | null = null) {
  return outreachEmail({
    sourceUrl,
    kind: row.kind,
    business: row.business,
    bidId: row.bid_id,
    bidTitle: row.bid_title,
    buyer: row.buyer,
    due: row.due_date,
    tradeLabel: row.trade_label,
    place: row.place ?? null,
    postalAddress,
    unsubscribeUrl: unsubscribeUrl(row.email),
    contactId: row.id,
  });
}

/** Each bid's official posting link, for the drafts that point at it. Fail-open: empty map. */
export async function postingUrls(bidIds: number[]): Promise<Map<number, string>> {
  const ids = [...new Set(bidIds.filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (!ids.length) return new Map();
  try {
    const rows = (await sql()`SELECT id, source_url FROM bids WHERE id = ANY(${ids}) AND source_url IS NOT NULL`) as { id: number; source_url: string }[];
    return new Map(rows.map((r) => [Number(r.id), String(r.source_url)]));
  } catch (err) {
    console.error("[outreach] posting links lookup failed (emails link the Contrax summary):", (err as Error)?.message);
    return new Map();
  }
}

/**
 * Send the given drafts (at most MAX_SEND_PER_BATCH). Refuses to send without
 * a postal address. Each row is claimed (draft → sending) before it is sent,
 * so a double click cannot send twice.
 */
export async function sendDrafts(ids: number[]): Promise<{ sent: number; failed: number; skipped: number }> {
  await ensureOutreach();
  const postal = await getPostalAddress();
  if (!validPostalAddress(postal)) throw new Error("Set the mailing address first");
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const resend = new Resend(key);
  const want = [...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, MAX_SEND_PER_BATCH);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const id of want) {
    const claimed = (await sql()`
      UPDATE outreach_contacts c SET status = 'sending'
      WHERE c.id = ${id} AND c.status = 'draft'
        AND NOT EXISTS (SELECT 1 FROM outreach_suppressions s WHERE s.email = LOWER(c.email))
      RETURNING *`) as Record<string, unknown>[];
    if (!claimed.length) {
      skipped++;
      continue;
    }
    const row = normalize(claimed[0]!);
    // A prime row's bid_id is an award id, never a bid: no posting lookup.
    const posting = row.kind === "prime" ? null : (await postingUrls([row.bid_id])).get(row.bid_id) ?? null;
    const mail = renderContact(row, postal!, posting);
    const unsub = unsubscribeUrl(row.email);
    try {
      const { data, error } = await resend.emails.send({
        from: OUTREACH_FROM,
        to: row.email,
        replyTo: OUTREACH_REPLY_TO,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      if (error) throw new Error(error.message);
      await sql()`UPDATE outreach_contacts SET status = 'sent', sent_at = NOW(), resend_id = ${data?.id ?? null}, error = NULL WHERE id = ${id}`;
      sent++;
    } catch (e) {
      await sql()`UPDATE outreach_contacts SET status = 'failed', error = ${(e instanceof Error ? e.message : String(e)).slice(0, 400)} WHERE id = ${id}`;
      failed++;
    }
  }
  return { sent, failed, skipped };
}
