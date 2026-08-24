import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

interface TrafficMetrics {
  totalPageViews: number;
  pageViewsToday: number;
  pageViewsThisWeek: number;
  topPages: { path: string; count: number }[];
  uniqueVisitorsToday: number;
  uniqueHumanVisitorsToday: number;
}

interface FunnelMetrics {
  total: number;
  today: number;
  last7: number;
  byName: { name: string; count: number }[];
  recent: { event_name: string; label: string | null; path: string | null; created_at: string }[];
}

/**
 * Bot/crawler exclusion predicate against the `page_views` columns
 * (ip / user_agent / referrer). Used to compute `uniqueHumanVisitorsToday` so the
 * admin dashboard stops counting search-engine crawlers, social link-preview
 * scrapers, and our own test IPs as real visitors.
 *
 * Inlined via sql().unsafe() into a `WHERE ... AND NOT ( ... )` clause. Tuned to
 * be conservative: it only excludes known crawler IP prefixes, bot user-agents,
 * and explicit test IPs. Null-IP rows are NOT excluded unless their user_agent is
 * bot-like (some real views legitimately lack an IP).
 */
const BOT_EXCLUSION_SQL = `
  (
    -- Our own test / scraper IPs (exclude always).
    ip IN ('34.214.71.218','73.40.36.204')
    -- Search-engine crawler IP prefixes: Googlebot + common Bing ranges.
    OR ip LIKE '66.249.%'
    OR ip LIKE '40.77.%' OR ip LIKE '157.55.%' OR ip LIKE '207.46.%'
    -- Social link-preview / crawler IP prefixes (Facebook/Meta, etc.).
    OR ip LIKE '66.220.%' OR ip LIKE '31.13.%' OR ip LIKE '173.252.%'
    OR ip LIKE '104.189.%' OR ip LIKE '69.171.%' OR ip LIKE '157.240.%'
    -- Meta/AWS link-preview fetchers — BUT only when the referrer is a Facebook
    -- host, so we don't over-exclude real humans on AWS residential IPs.
    OR (
      ( ip LIKE '52.%' OR ip LIKE '54.%' OR ip LIKE '35.%' OR ip LIKE '44.%' OR ip LIKE '34.%' )
      AND LOWER(COALESCE(referrer,'')) LIKE '%facebook%'
    )
    -- Search-engine bot user-agents.
    OR LOWER(COALESCE(user_agent,'')) LIKE '%googlebot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%bingbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%slurp%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%duckduckbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%baiduspider%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%yandexbot%'
    -- Social link-preview / crawler user-agents.
    OR LOWER(COALESCE(user_agent,'')) LIKE '%facebookexternalhit%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%facebot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%twitterbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%linkedinbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%slackbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%discordbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%redditbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%pinterestbot%'
    -- Generic bot / headless-browser / CLI scrapers (case-insensitive).
    OR LOWER(COALESCE(user_agent,'')) LIKE '%bot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%crawler%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%spider%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%headlesschrome%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%python%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%curl%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%wget%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%go-http-client%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%semrushbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%ahrefsbot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%mj12bot%'
    OR LOWER(COALESCE(user_agent,'')) LIKE '%dotbot%'
  )
`;

/**
 * Page-view stats from the self-hosted `page_views` table. Wrapped in a guard
 * so the admin dashboard degrades to zeros on the very first deploy, before
 * the table exists (it is created lazily by the first /api/page-view call).
 */
async function loadTrafficMetrics(): Promise<TrafficMetrics> {
  try {
    // Purge any admin page views that were recorded before the exclusion filter was added.
    try { await sql()`DELETE FROM page_views WHERE path LIKE '/admin%'`; } catch { /* ok if table doesn't exist yet */ }
    const [total, today, week, top, unique, uniqueHuman] = await Promise.all([
      sql()`SELECT COUNT(*) as count FROM page_views`,
      sql()`SELECT COUNT(*) as count FROM page_views WHERE created_at >= CURRENT_DATE`,
      sql()`SELECT COUNT(*) as count FROM page_views WHERE created_at >= NOW() - INTERVAL '7 days'`,
      sql()`SELECT path, COUNT(*) as count FROM page_views GROUP BY path ORDER BY count DESC LIMIT 5`,
      sql()`SELECT COUNT(DISTINCT ip) as count FROM page_views WHERE created_at >= CURRENT_DATE`,
      sql()`SELECT COUNT(DISTINCT ip) as count FROM page_views WHERE created_at >= CURRENT_DATE AND NOT ${sql().unsafe(BOT_EXCLUSION_SQL)}`,
    ]);
    return {
      totalPageViews: Number(total[0].count),
      pageViewsToday: Number(today[0].count),
      pageViewsThisWeek: Number(week[0].count),
      topPages: (top as any[]).map((r) => ({ path: r.path, count: Number(r.count) })),
      uniqueVisitorsToday: Number(unique[0].count),
      uniqueHumanVisitorsToday: Number(uniqueHuman[0].count),
    };
  } catch {
    // page_views may not exist yet — don't fail the whole dashboard.
    return {
      totalPageViews: 0,
      pageViewsToday: 0,
      pageViewsThisWeek: 0,
      topPages: [],
      uniqueVisitorsToday: 0,
      uniqueHumanVisitorsToday: 0,
    };
  }
}

/**
 * Funnel-event stats from the self-hosted `funnel_events` table. Wrapped in a
 * guard so the admin dashboard degrades to zeros on the very first deploy,
 * before the table exists (it is created lazily by the first /api/event call).
 */
async function loadFunnelMetrics(): Promise<FunnelMetrics> {
  try {
    const [total, today, week, byName, recent] = await Promise.all([
      sql()`SELECT COUNT(*) as count FROM funnel_events`,
      sql()`SELECT COUNT(*) as count FROM funnel_events WHERE created_at >= CURRENT_DATE`,
      sql()`SELECT COUNT(*) as count FROM funnel_events WHERE created_at >= NOW() - INTERVAL '7 days'`,
      sql()`SELECT event_name, COUNT(*) as count FROM funnel_events WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY event_name ORDER BY count DESC`,
      sql()`SELECT event_name, label, path, created_at FROM funnel_events ORDER BY created_at DESC LIMIT 20`,
    ]);
    return {
      total: Number(total[0].count),
      today: Number(today[0].count),
      last7: Number(week[0].count),
      byName: (byName as any[]).map((r) => ({ name: r.event_name, count: Number(r.count) })),
      recent: (recent as any[]).map((r) => ({
        event_name: r.event_name,
        label: r.label ?? null,
        path: r.path ?? null,
        created_at: String(r.created_at),
      })),
    };
  } catch {
    // funnel_events may not exist yet — don't fail the whole dashboard.
    return { total: 0, today: 0, last7: 0, byName: [], recent: [] };
  }
}

async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  try {
    const [userCount, planRows, recentUsers, signupCount, signupRows, waitlistCount, recentWaitlist, diagCount, billCount, traffic, funnel] = await Promise.all([
      sql()`SELECT COUNT(*) as count FROM users`,
      sql()`SELECT plan_tier, COUNT(*) as count FROM users GROUP BY plan_tier ORDER BY count DESC`,
      sql()`SELECT id, email, plan_tier, trial_started_at, subscription_status, created_at FROM users ORDER BY created_at DESC`,
      // Real signups = users excluding the owner (is_admin) and the demo account.
      sql()`SELECT COUNT(*) as count FROM users WHERE is_admin = false AND plan_tier <> 'demo'`,
      sql()`SELECT id, email, created_at FROM users WHERE is_admin = false AND plan_tier <> 'demo' ORDER BY created_at DESC`,
      sql()`SELECT COUNT(*) as count FROM waitlist`,
      sql()`SELECT email, source, created_at FROM waitlist ORDER BY created_at DESC LIMIT 10`,
      sql()`SELECT COUNT(*) as count FROM savings_diagnoses`,
      sql()`SELECT COUNT(*) as count FROM savings_bills`,
      loadTrafficMetrics(),
      loadFunnelMetrics(),
    ]);

    return Response.json({
      totalUsers: Number(userCount[0].count),
      usersByPlan: (planRows as any[]).map((r) => ({
        plan_tier: r.plan_tier,
        count: Number(r.count),
      })),
      recentUsers: (recentUsers as any[]).map((r) => ({
        id: Number(r.id),
        email: r.email,
        plan_tier: r.plan_tier,
        trial_started_at: r.trial_started_at ? String(r.trial_started_at) : null,
        subscription_status: r.subscription_status,
        created_at: String(r.created_at),
      })),
      totalSignups: Number(signupCount[0].count),
      recentSignups: (signupRows as any[]).map((r) => ({
        id: Number(r.id),
        email: r.email,
        created_at: String(r.created_at),
      })),
      totalWaitlist: Number(waitlistCount[0].count),
      recentWaitlist: (recentWaitlist as any[]).map((r) => ({
        email: r.email,
        source: r.source || "landing_page",
        created_at: String(r.created_at),
      })),
      totalDiagnoses: Number(diagCount[0].count),
      totalBills: Number(billCount[0].count),
      ...traffic,
      funnel,
    });
  } catch (err) {
    console.error("[api/admin/metrics] error:", err);
    return Response.json({ error: "Failed to load metrics" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/metrics")({
  server: { handlers: { GET: handler } },
});
