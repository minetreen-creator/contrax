import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { hasPaidBidAccess } from "~/lib/head-start.server";
import {
  buildSavedBidsCalendar,
  calendarFeedUrl,
  isCalendarToken,
  newCalendarToken,
  type CalendarBid,
} from "~/lib/calendar-feed";

/**
 * Saved-bid calendar feed (src/lib/calendar-feed.ts).
 *
 *   POST /api/calendar-feed            signed in; body { reset?: true }
 *     • not signed in      → 401
 *     • not a paid member  → 402 { locked: true, error: "Starter required" }
 *       (an ATTEMPT-only prompt: shown when the member asks for the link)
 *     • paid               → 200 { url } (the existing link, or a new one;
 *                            reset: true replaces it and kills the old URL)
 *
 *   GET /api/calendar-feed?token=…     what calendar apps fetch (no cookie)
 *     • unknown/malformed token → 404
 *     • token of a member who no longer pays → an EMPTY, valid calendar
 *     • otherwise → text/calendar with every saved bid's due date
 */

async function ensureTable(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS calendar_feeds (
      user_id INTEGER PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function issue({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await hasPaidBidAccess(user))) {
    return Response.json(
      {
        locked: true,
        error: "Starter required",
        message: "The calendar feed of your saved bids' deadlines is part of Starter ($19/month).",
      },
      { status: 402 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { reset?: unknown };
  try {
    await ensureTable();
    if (body.reset === true) {
      const token = newCalendarToken();
      await sql()`
        INSERT INTO calendar_feeds (user_id, token) VALUES (${user.id}, ${token})
        ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, created_at = NOW()
      `;
      return Response.json({ url: calendarFeedUrl(token) });
    }
    const existing = (await sql()`SELECT token FROM calendar_feeds WHERE user_id = ${user.id}`) as { token: string }[];
    if (existing[0]?.token) return Response.json({ url: calendarFeedUrl(existing[0].token) });
    const token = newCalendarToken();
    await sql()`
      INSERT INTO calendar_feeds (user_id, token) VALUES (${user.id}, ${token})
      ON CONFLICT (user_id) DO NOTHING
    `;
    const row = (await sql()`SELECT token FROM calendar_feeds WHERE user_id = ${user.id}`) as { token: string }[];
    return Response.json({ url: calendarFeedUrl(row[0]?.token ?? token) });
  } catch (err) {
    console.error("[api/calendar-feed] issue failed:", (err as Error).message);
    return Response.json({ error: "Could not create your calendar link. Please try again." }, { status: 500 });
  }
}

const ICS_HEADERS = {
  "content-type": "text/calendar; charset=utf-8",
  "content-disposition": 'inline; filename="contrax-bid-deadlines.ics"',
  "cache-control": "private, max-age=900",
};

async function feed({ request }: { request: Request }): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!isCalendarToken(token)) return new Response("Not found", { status: 404 });
  try {
    await ensureTable();
    const owners = (await sql()`
      SELECT u.id, COALESCE(u.is_admin, FALSE) AS is_admin
      FROM calendar_feeds f JOIN users u ON u.id = f.user_id
      WHERE f.token = ${token}
    `) as { id: number; is_admin: boolean }[];
    const owner = owners[0];
    if (!owner) return new Response("Not found", { status: 404 });
    let bids: CalendarBid[] = [];
    if (await hasPaidBidAccess(owner)) {
      const rows = (await sql()`
        SELECT b.id, b.title, b.agency, b.due_date, b.solicitation_number
        FROM saved_matches s JOIN bids b ON b.id = s.bid_id
        WHERE s.user_id = ${owner.id}
          AND s.status = 'saved'
          AND b.due_date IS NOT NULL
          AND b.due_date > NOW() - INTERVAL '30 days'
        ORDER BY b.due_date
        LIMIT 500
      `) as { id: number; title: string; agency: string | null; due_date: string; solicitation_number: string | null }[];
      bids = rows.map((r) => ({
        bidId: Number(r.id),
        title: String(r.title ?? "Saved bid"),
        agency: r.agency,
        dueDate: r.due_date,
        solicitationNumber: r.solicitation_number,
      }));
    }
    return new Response(buildSavedBidsCalendar(bids), { status: 200, headers: ICS_HEADERS });
  } catch (err) {
    console.error("[api/calendar-feed] feed failed:", (err as Error).message);
    return new Response("Calendar temporarily unavailable", { status: 503 });
  }
}

export const Route = createFileRoute("/api/calendar-feed")({
  server: { handlers: { GET: feed, POST: issue } },
});
