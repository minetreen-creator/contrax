/**
 * In-app notifications system.
 *
 * Server functions for fetching, marking-read, and generating notifications.
 * Also exports `createDeadlineAlertsForUser` as a regular async function so it
 * can be called from other server-function handlers (e.g. the dashboard loader).
 */

import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";

export interface Notification {
  id: number;
  type: "deadline_alert" | "new_bid_match" | "team_activity";
  title: string;
  message: string;
  bid_id: number | null;
  read: boolean;
  created_at: string;
}

export interface NotificationsResponse {
  count: number;
  notifications: Notification[];
}

// ── Table helper ──────────────────────────────────────────────────────────────

async function ensureNotificationsTable() {
  await sql()`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, bid_id INTEGER REFERENCES bids(id), read BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`;
}

/** Insert a notification for a user. Safe for event handlers and server functions. */
export async function createNotification(input: {
  userId: number;
  type: Notification["type"];
  title: string;
  message: string;
  bidId?: number | null;
}): Promise<void> {
  await ensureNotificationsTable();
  // Event handlers may be retried; suppress an identical alert created recently.
  const duplicate = await sql()`SELECT id FROM notifications WHERE user_id=${input.userId} AND type=${input.type} AND title=${input.title} AND COALESCE(bid_id,0)=COALESCE(${input.bidId ?? null},0) AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`;
  if ((duplicate as any[]).length) return;
  await sql()`INSERT INTO notifications (user_id,type,title,message,bid_id) VALUES (${input.userId},${input.type},${input.title},${input.message},${input.bidId ?? null})`;
}

// ── Fetch ────────────────────────────────────────────────────────────────────

export const getNotifications = createServerFn({ method: "GET" }).handler(
  async (): Promise<NotificationsResponse> => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    await ensureNotificationsTable();

    const countRow = await sql()`
      SELECT COUNT(*)::int AS cnt FROM notifications
      WHERE user_id = ${user.id} AND read = false
    `;
    const count = (countRow[0] as any).cnt as number;

    const rows = await sql()`
      SELECT id, type, title, message, bid_id, read, created_at
      FROM notifications
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 50
    `;

    const notifications: Notification[] = (rows as any[]).map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      message: r.message,
      bid_id: r.bid_id ?? null,
      read: r.read,
      created_at: String(r.created_at),
    }));

    return { count, notifications };
  },
);

// ── Deadline alert generation (regular function — callable from other SFNs) ──

/**
 * Creates deadline_alert notifications for a specific user's tracked bids.
 * Safe to call every time the dashboard loads — dedup prevents duplicate alerts
 * for the same bid+threshold within 24 hours.
 *
 * Returns the number of new notifications created.
 */
export async function createDeadlineAlertsForUser(
  userId: number,
  userEmail: string,
): Promise<number> {
  await ensureNotificationsTable();
  await sql()`CREATE TABLE IF NOT EXISTS tracked_bids (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, agency TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'tracked', last_checked TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;

  const trackedRows = await sql()`
    SELECT bid_id, bid_title, agency, due_date
    FROM tracked_bids
    WHERE user_email = ${userEmail} AND due_date IS NOT NULL
  `;

  let created = 0;
  const now = Date.now();

  for (const row of trackedRows as any[]) {
    const bidId = row.bid_id as string;
    const bidTitle = row.bid_title as string;
    const agency = row.agency as string;
    const dueDate = new Date(row.due_date);
    const hoursUntilDue = (dueDate.getTime() - now) / (1000 * 60 * 60);

    let title = "";
    let message = "";

    if (hoursUntilDue < 0) {
      title = "Bid deadline passed";
      message = `"${bidTitle}" (${agency}) was due ${formatRelative(dueDate)}.`;
    } else if (hoursUntilDue <= 24) {
      title = "Bid due within 24 hours";
      message = `"${bidTitle}" (${agency}) is due in less than 24 hours. Act now!`;
    } else if (hoursUntilDue <= 48) {
      title = "Bid due within 48 hours";
      message = `"${bidTitle}" (${agency}) is due in 2 days. Time to finalize your proposal.`;
    } else {
      continue; // Not within any alert threshold
    }

    // Dedup: check if a deadline_alert with same title was created in the last 24h
    const recentDup = await sql()`
      SELECT id FROM notifications
      WHERE user_id = ${userId}
        AND type = 'deadline_alert'
        AND title = ${title}
        AND created_at > NOW() - INTERVAL '24 hours'
      LIMIT 1
    `;

    if ((recentDup as any[]).length > 0) continue;

    // Resolve bid_id for the actual bids table (best-effort)
    let actualBidId: number | null = null;
    try {
      const bidRows = await sql()`SELECT id FROM bids WHERE title = ${bidTitle} LIMIT 1`;
      if ((bidRows as any[]).length > 0) {
        actualBidId = (bidRows[0] as any).id;
      }
    } catch {
      // bid lookup is best-effort
    }

    await sql()`INSERT INTO notifications (user_id, type, title, message, bid_id) VALUES (${userId}, 'deadline_alert', ${title}, ${message}, ${actualBidId ?? null})`;
    created++;
  }

  return created;
}

// ── Deadline alert generation (server function — for all users) ──────────────

/**
 * Server function that checks all users' tracked_bids and creates deadline alerts.
 * Call this from the sync cron to run across the entire user base.
 */
export const generateDeadlineAlerts = createServerFn({ method: "POST" }).handler(async () => {
  await ensureNotificationsTable();
  await sql()`CREATE TABLE IF NOT EXISTS tracked_bids (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, agency TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'tracked', last_checked TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;

  const userRows = await sql()`SELECT id, email FROM users`;
  let total = 0;
  for (const u of userRows as any[]) {
    total += await createDeadlineAlertsForUser(u.id as number, u.email as string);
  }
  return { created: total };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
