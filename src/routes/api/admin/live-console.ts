import { scoreLead } from "~/lib/hot-leads";
import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { adminFunnelExclusionSQL, qaExternalUserSQL, qaFunnelExclusionSQL } from "~/lib/qa-exclusion";
import { TRIAL_DAYS } from "~/lib/trial";
import { dataCenterLocation, sameMinuteClusters } from "~/lib/visitor-intel";
import { getStripe } from "~/lib/stripe";
import { isAdminEmail } from "~/lib/admin";
import { ensureTrackedVisitorsTable } from "~/lib/scraper-watch.server";
import type { TrackedVisitor } from "~/lib/scraper-watch";
import {
  paidCheckoutCount,
  mapPoint,
  FEED_EVENTS,
  FEED_EVENT_NAMES,
  placeLabel,
  searchFeedText,
  sortFeed,
  sortTrials,
  trialEnds,
  trialHeat,
  visitorState,
  type FeedItem,
  type MoneyStats,
  type OnlineVisitor,
  type StateSearchStat,
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
 *
 * Map: searches per searched state (48 hours). Online: visitors seen in the
 * last 5 minutes and the page each is on. The visitor id itself never leaves
 * the server.
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

    // Live search map: searches per searched state over the same 48 hours.
    let map: StateSearchStat[] = [];
    try {
      const rows = (await db`
        SELECT s.state, COUNT(*)::int AS searches,
               COUNT(*) FILTER (WHERE s.matched = 0)::int AS zero,
               MAX(s.created_at) AS last_at
        FROM radar_search_log s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.created_at > NOW() - INTERVAL '48 hours'
          AND s.state <> ''
          AND COALESCE(u.is_admin, FALSE) = FALSE
        GROUP BY s.state
      `) as { state: string; searches: number; zero: number; last_at: string }[];
      map = rows.map((r) => ({ state: r.state, searches: Number(r.searches), zero: Number(r.zero), lastAt: new Date(r.last_at).toISOString() }));
    } catch {
      // No searches saved yet.
    }

    // On the site now: each visitor's latest page in the last 5 minutes.
    // Admin pages and admin, QA and bot traffic are left out. The map's lat/lon
    // columns are added by page-view intake; make sure they exist before
    // reading them so a fresh deploy can't fail this whole console.
    await db`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS lat REAL`;
    await db`ALTER TABLE page_views ADD COLUMN IF NOT EXISTS lon REAL`;
    const onlineRows = (await db`
      SELECT t.*, v.country FROM (
        SELECT DISTINCT ON (visitor_id) visitor_id, path, city, region, lat, lon, created_at
        FROM page_views
        WHERE created_at > NOW() - INTERVAL '5 minutes'
          AND visitor_id IS NOT NULL
          AND path NOT LIKE '/admin%'
          AND NOT ${db.unsafe(BOT_EXCLUSION_SQL)}
          AND ${db.unsafe(qaFunnelExclusionSQL())}
          AND ${db.unsafe(adminFunnelExclusionSQL())}
        ORDER BY visitor_id, created_at DESC
      ) t
      LEFT JOIN visitors v ON v.visitor_id = t.visitor_id
      ORDER BY t.created_at DESC
    `) as { visitor_id: string; path: string; city: string | null; region: string | null; lat: number | null; lon: number | null; country: string | null; created_at: string }[];
    // Email link scanners (owner 2026-10-19: ten "visitors" from San Jose,
    // Phoenix and San Antonio all on /launchpad minutes after partner emails
    // went out): the Visitors board's same-minute cluster rule and data-center
    // town rule, applied here too. Signed-in visitors are never hidden.
    let scanners = new Set<string>();
    if (onlineRows.length) {
      const ids = onlineRows.map((r) => r.visitor_id);
      const spans = (await db`
        SELECT DISTINCT ON (visitor_id) visitor_id, path AS landing,
               MIN(created_at) OVER (PARTITION BY visitor_id) AS first_at,
               MAX(created_at) OVER (PARTITION BY visitor_id) AS last_at,
               BOOL_OR(user_id IS NOT NULL) OVER (PARTITION BY visitor_id) AS signed_in
        FROM page_views
        WHERE visitor_id = ANY(${ids}) AND created_at > NOW() - INTERVAL '60 minutes'
        ORDER BY visitor_id, created_at ASC
      `) as { visitor_id: string; landing: string | null; first_at: string; last_at: string; signed_in: boolean }[];
      const clustered = sameMinuteClusters(
        spans.map((r) => {
          const first = Date.parse(r.first_at);
          return {
            id: r.visitor_id,
            firstSeenMs: Number.isFinite(first) ? first : null,
            visitSeconds: Number.isFinite(first) ? Math.max(0, (Date.parse(r.last_at) - first) / 1000) : null,
            landing: r.landing ? String(r.landing).split("?")[0] : null,
            exempt: !!r.signed_in,
          };
        }),
      );
      const signedIn = new Set(spans.filter((r) => r.signed_in).map((r) => r.visitor_id));
      scanners = new Set([
        ...clustered.keys(),
        ...onlineRows.filter((r) => !signedIn.has(r.visitor_id) && dataCenterLocation(r.city, r.region)).map((r) => r.visitor_id),
      ]);
    }
    const people = onlineRows.filter((r) => !scanners.has(r.visitor_id));

    // Hot Lead Radar (owner 2026-10-23): what each visitor did this hour and
    // how many days they've visited, scored in src/lib/hot-leads.ts.
    const leadSignals = new Map<string, { paths: string[]; views: number; days: number; signedIn: boolean }>();
    if (people.length) {
      try {
        const sig = (await db`
          SELECT visitor_id,
                 ARRAY_AGG(DISTINCT split_part(path, '?', 1)) FILTER (WHERE created_at > NOW() - INTERVAL '60 minutes') AS paths,
                 COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '60 minutes')::int AS views,
                 COUNT(DISTINCT (created_at AT TIME ZONE 'America/New_York')::date)::int AS days,
                 BOOL_OR(user_id IS NOT NULL) AS signed_in
          FROM page_views
          WHERE visitor_id = ANY(${people.slice(0, 100).map((r) => r.visitor_id)}) AND created_at > NOW() - INTERVAL '30 days'
          GROUP BY visitor_id
        `) as { visitor_id: string; paths: string[] | null; views: number; days: number; signed_in: boolean }[];
        for (const r of sig) leadSignals.set(r.visitor_id, { paths: r.paths ?? [], views: r.views, days: r.days, signedIn: !!r.signed_in });
      } catch (err) {
        console.error("[live-console] lead signals failed:", err);
      }
    }

    // Up to 100 for the map dots; the list under the count shows the first 12.
    const online: OnlineVisitor[] = people.slice(0, 100).map((r, i) => ({
      visitorKey: `v${i}-${new Date(r.created_at).getTime()}`,
      vid: r.visitor_id,
      place: placeLabel(r.city, r.region),
      state: visitorState(r.region, r.country),
      point: visitorState(r.region, r.country) ? mapPoint(r.lat == null ? null : Number(r.lat), r.lon == null ? null : Number(r.lon)) : null,
      path: String(r.path).split("?")[0].slice(0, 80),
      at: new Date(r.created_at).toISOString(),
      lead: (() => {
        const g = leadSignals.get(r.visitor_id);
        return scoreLead({
          currentPath: String(r.path).split("?")[0],
          pathsHour: g?.paths ?? [String(r.path).split("?")[0]],
          viewsHour: g?.views ?? 1,
          visitDays: g?.days ?? 1,
          signedIn: g?.signedIn ?? false,
        });
      })(),
    }));

    // Scraper tracker (owner 2026-10-26): visitors pinned with Track, whether
    // they're on now and whether they came back after being tracked. Shown
    // even when the scanner rules hide them from "On the site now".
    let tracked: TrackedVisitor[] = [];
    try {
      await ensureTrackedVisitorsTable();
      const rows = (await db`
        SELECT t.visitor_id, t.tracked_at, t.note, v.city, v.region, v.country,
               act.last_seen, act.views24h
        FROM tracked_visitors t
        LEFT JOIN visitors v ON v.visitor_id = t.visitor_id
        LEFT JOIN LATERAL (
          SELECT MAX(created_at) AS last_seen,
                 COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS views24h
          FROM page_views WHERE visitor_id = t.visitor_id
        ) act ON TRUE
        ORDER BY act.last_seen DESC NULLS LAST
        LIMIT 50
      `) as { visitor_id: string; tracked_at: string; note: string | null; city: string | null; region: string | null; country: string | null; last_seen: string | null; views24h: number | null }[];
      tracked = rows.map((r) => {
        const last = r.last_seen ? new Date(r.last_seen).getTime() : null;
        const at = new Date(r.tracked_at).getTime();
        return {
          vid: r.visitor_id,
          place: placeLabel(r.city, r.region),
          country: r.country,
          note: r.note,
          trackedAt: new Date(at).toISOString(),
          lastSeen: last ? new Date(last).toISOString() : null,
          views24h: Number(r.views24h ?? 0),
          online: !!last && now - last <= 5 * 60_000,
          returned: !!last && last > at + 30 * 60_000,
        };
      });
    } catch (e) {
      console.error("[api/admin/live-console] tracked visitors unavailable:", e);
    }
    const trackedIds = new Set(tracked.map((t) => t.vid));
    for (const v of online) if (trackedIds.has(v.vid)) v.tracked = true;

    // Money panel: the last 7 days from the plans to checkout, unique
    // visitors, same bot/QA/admin exclusions as the feed; paying = active
    // subscriptions among real accounts.
    let money: MoneyStats | null = null;
    try {
      const human = `NOT ${BOT_EXCLUSION_SQL} AND ${qaFunnelExclusionSQL()} AND ${adminFunnelExclusionSQL()}`;
      const [pv] = (await db`
        SELECT COUNT(DISTINCT visitor_id)::int AS saw
        FROM page_views
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND visitor_id IS NOT NULL
          AND (path = '/pricing' OR path LIKE '/pricing?%' OR path = '/upgrade' OR path LIKE '/upgrade?%')
          AND ${db.unsafe(human)}
      `) as { saw: number }[];
      const [ev] = (await db`
        SELECT COUNT(DISTINCT visitor_id) FILTER (WHERE event_name LIKE '%checkout_started')::int AS clicked,
               COUNT(DISTINCT visitor_id) FILTER (WHERE event_name = 'plan_checkout_redirected')::int AS opened,
               COUNT(DISTINCT visitor_id) FILTER (WHERE event_name = 'plan_checkout_signin_required')::int AS signin,
               COUNT(DISTINCT visitor_id) FILTER (WHERE event_name = 'plan_checkout_failed')::int AS failed
        FROM funnel_events
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND visitor_id IS NOT NULL
          AND event_name LIKE '%checkout%'
          AND ${db.unsafe(human)}
      `) as { clicked: number; opened: number; signin: number; failed: number }[];
      const [paying] = (await db`
        SELECT COUNT(*)::int AS n FROM users
        WHERE subscription_status = 'active' AND ${db.unsafe(qaExternalUserSQL())}
      `) as { n: number }[];
      money = {
        payingNow: Number(paying?.n ?? 0),
        sawPlans: Number(pv?.saw ?? 0),
        clickedBuy: Number(ev?.clicked ?? 0),
        openedCheckout: Number(ev?.opened ?? 0),
        signinRequired: Number(ev?.signin ?? 0),
        failed: Number(ev?.failed ?? 0),
        starterPass: await loadStarterPassStats(),
      };
    } catch (e) {
      console.error("[api/admin/live-console] money panel unavailable:", e);
    }

    return Response.json({
      generatedAt: new Date(now).toISOString(),
      money,
      paid48h: await loadPaid48h(now),
      map,
      onlineCount: people.length,
      scannersHidden: scanners.size,
      online,
      tracked,
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

/** $5 30-day Starter passes, from the accounts table (owner and test accounts left out); null on any error. */
async function loadStarterPassStats() {
  try {
    const { ensureStarterPassColumns } = await import("~/lib/starter-pass.server");
    await ensureStarterPassColumns();
    const db = sql();
    const [r] = (await db`
      SELECT COUNT(*)::int AS bought,
             COUNT(*) FILTER (WHERE starter_pass_ends_at > NOW())::int AS active_now,
             COUNT(*) FILTER (WHERE subscription_status = 'active' AND stripe_subscription_id IS NOT NULL)::int AS continued,
             COUNT(*) FILTER (WHERE subscription_status = 'pass_ended')::int AS ended
      FROM users
      WHERE starter_pass_bought_at IS NOT NULL AND ${db.unsafe(qaExternalUserSQL())}
    `) as { bought: number; active_now: number; continued: number; ended: number }[];
    return { bought: r?.bought ?? 0, activeNow: r?.active_now ?? 0, continued: r?.continued ?? 0, ended: r?.ended ?? 0 };
  } catch (e) {
    console.error("[api/admin/live-console] starter pass stats unavailable:", e);
    return null;
  }
}

/** $5 first-month Starter subscriptions, read live from Stripe; null on any error. */
/** Paid Stripe checkouts in the last 48 hours, or null when Stripe could not be read. */
async function loadPaid48h(now: number): Promise<number | null> {
  try {
    const since = Math.floor(now / 1000) - 48 * 60 * 60;
    const sessions: { payment_status?: string | null; customer_details?: { email?: string | null } | null }[] = [];
    let after: string | undefined;
    for (let i = 0; i < 5; i++) {
      const res = await getStripe().checkout.sessions.list({
        created: { gte: since },
        limit: 100,
        ...(after ? { starting_after: after } : {}),
      });
      sessions.push(...res.data);
      if (!res.has_more || !res.data.length) break;
      after = res.data[res.data.length - 1].id;
    }
    return paidCheckoutCount(sessions, isAdminEmail);
  } catch (e) {
    console.error("[api/admin/live-console] paid checkouts unavailable:", e);
    return null;
  }
}

