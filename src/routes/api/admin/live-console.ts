import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { adminFunnelExclusionSQL, qaExternalUserSQL, qaFunnelExclusionSQL } from "~/lib/qa-exclusion";
import { TRIAL_DAYS } from "~/lib/trial";
import {
  FEED_EVENTS,
  FEED_EVENT_NAMES,
  placeLabel,
  searchFeedText,
  sortFeed,
  sortTrials,
  trialEnds,
  trialHeat,
  type FeedItem,
  type TrialCard,
} from "~/lib/live-console";

/**
 * GET /api/admin/live-console — the owner console's live activity feed and
 * trial countdown board (src/lib/live-console.ts). Admin only.
 *
 * Feed (last 48 hours, newest 60): signups, checkouts and purchases from
 * funnel_events; searches from radar_search_log; trial starts from users.
 * Bots, admins and QA accounts are excluded the same way the other admin
 * boards exclude them.
 *
 * Trials: every external account whose 7-day trial is running and that has not
 * paid, with when we last saw it, its 7-day visit count, its profile trade and
 * its last 3 searches.
 */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  const db = sql();
  const feed: FeedItem[] = [];
  try {
    const events = (await db`
      SELECT id, event_name, created_at, city, region
      FROM funnel_events
      WHERE created_at > NOW() - INTERVAL '48 hours'
        AND event_name = ANY(${FEED_EVENT_NAMES})
        AND NOT ${db.unsafe(BOT_EXCLUSION_SQL)}
        AND ${db.unsafe(qaFunnelExclusionSQL())}
        AND ${db.unsafe(adminFunnelExclusionSQL())}
      ORDER BY created_at DESC
      LIMIT 60
    `) as { id: number; event_name: string; created_at: string; city: string | null; region: string | null }[];
    for (const e of events) {
      const meta = FEED_EVENTS[e.event_name];
      if (!meta) continue;
      feed.push({
        id: `e${e.id}`,
        kind: meta.kind,
        at: new Date(e.created_at).toISOString(),
        place: placeLabel(e.city, e.region),
        title: meta.title,
        detail: null,
        money: meta.kind === "checkout" || meta.kind === "purchase",
      });
    }

    // Searches: the location is the visitor's latest tracked city. A missing
    // radar_search_log table (no search saved yet) just means no search rows.
    try {
      const searches = (await db`
        SELECT s.id, s.created_at, s.trade, s.state, s.matched, loc.city, loc.region
        FROM radar_search_log s
        LEFT JOIN users u ON u.id = s.user_id
        LEFT JOIN LATERAL (
          SELECT f.city, f.region FROM funnel_events f
          WHERE s.visitor_id IS NOT NULL AND f.visitor_id = s.visitor_id
          ORDER BY f.created_at DESC LIMIT 1
        ) loc ON TRUE
        WHERE s.created_at > NOW() - INTERVAL '48 hours'
          AND COALESCE(u.is_admin, FALSE) = FALSE
          AND (s.visitor_id IS NULL OR s.visitor_id NOT IN (
            SELECT DISTINCT visitor_id FROM funnel_events
            WHERE visitor_id IS NOT NULL AND created_at > NOW() - INTERVAL '30 days'
              AND NOT ${db.unsafe(adminFunnelExclusionSQL())}
          ))
        ORDER BY s.created_at DESC
        LIMIT 60
      `) as { id: number; created_at: string; trade: string; state: string; matched: number; city: string | null; region: string | null }[];
      for (const s of searches) {
        const text = searchFeedText(s.trade, s.state, Number(s.matched));
        feed.push({
          id: `s${s.id}`,
          kind: "search",
          at: new Date(s.created_at).toISOString(),
          place: placeLabel(s.city, s.region),
          title: text.title,
          detail: text.detail,
          money: false,
        });
      }
    } catch (e) {
      console.error("[api/admin/live-console] search rows unavailable:", e);
    }

    const trialStarts = (await db`
      SELECT id, trial_started_at FROM users
      WHERE trial_started_at > NOW() - INTERVAL '48 hours'
        AND ${db.unsafe(qaExternalUserSQL())}
      ORDER BY trial_started_at DESC
      LIMIT 30
    `) as { id: number; trial_started_at: string }[];
    for (const t of trialStarts) {
      feed.push({
        id: `t${t.id}`,
        kind: "trial",
        at: new Date(t.trial_started_at).toISOString(),
        place: null,
        title: "Trial started",
        detail: `${TRIAL_DAYS} days of Professional`,
        money: false,
      });
    }

    const now = Date.now();
    const trialRows = (await db`
      SELECT u.id, u.email, u.trial_started_at,
             bp.industry, bp.locations,
             act.last_seen, act.visits7d
      FROM users u
      LEFT JOIN LATERAL (
        SELECT industry, locations FROM business_profiles WHERE user_id = u.id ORDER BY id LIMIT 1
      ) bp ON TRUE
      LEFT JOIN LATERAL (
        SELECT MAX(created_at) AS last_seen,
               COUNT(DISTINCT visit_id) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS visits7d
        FROM page_views
        WHERE user_id = u.id::text OR LOWER(user_email) = LOWER(u.email)
      ) act ON TRUE
      WHERE u.trial_started_at > NOW() - make_interval(days => ${TRIAL_DAYS})
        AND COALESCE(u.subscription_status, '') NOT IN ('active')
        AND ${db.unsafe(qaExternalUserSQL("u."))}
      ORDER BY u.trial_started_at ASC
      LIMIT 100
    `) as {
      id: number;
      email: string;
      trial_started_at: string;
      industry: string | null;
      locations: unknown;
      last_seen: string | null;
      visits7d: number | null;
    }[];

    let searchesByUser = new Map<number, TrialCard["searches"]>();
    if (trialRows.length) {
      try {
        const rows = (await db`
          SELECT user_id, trade, state, matched, created_at FROM (
            SELECT user_id, trade, state, matched, created_at,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS n
            FROM radar_search_log WHERE user_id = ANY(${trialRows.map((r) => r.id)})
          ) t WHERE n <= 3
          ORDER BY created_at DESC
        `) as { user_id: number; trade: string; state: string; matched: number; created_at: string }[];
        searchesByUser = new Map();
        for (const r of rows) {
          const list = searchesByUser.get(r.user_id) ?? [];
          list.push({ trade: r.trade, state: r.state, matched: Number(r.matched), at: new Date(r.created_at).toISOString() });
          searchesByUser.set(r.user_id, list);
        }
      } catch {
        // No searches saved yet.
      }
    }

    const trials: TrialCard[] = trialRows.map((r) => {
      const startedAt = new Date(r.trial_started_at).toISOString();
      const endsAt = trialEnds(startedAt, TRIAL_DAYS);
      const lastSeen = r.last_seen ? new Date(r.last_seen).toISOString() : null;
      const locations = Array.isArray(r.locations) ? r.locations : [];
      return {
        userId: r.id,
        email: r.email,
        startedAt,
        endsAt,
        msLeft: new Date(endsAt).getTime() - now,
        lastSeen,
        heat: trialHeat(lastSeen, now),
        visits7d: Number(r.visits7d ?? 0),
        trade: r.industry?.trim() || null,
        stateCount: locations.length,
        searches: searchesByUser.get(r.id) ?? [],
      };
    });

    return Response.json({
      generatedAt: new Date(now).toISOString(),
      feed: sortFeed(feed).slice(0, 60),
      trials: sortTrials(trials),
    });
  } catch (err) {
    console.error("[api/admin/live-console] error:", err);
    return Response.json({ error: "Failed to load the live console" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/live-console")({
  server: { handlers: { GET: handler } },
});
