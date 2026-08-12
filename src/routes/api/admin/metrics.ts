import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

interface TrafficMetrics {
  totalPageViews: number;
  pageViewsToday: number;
  pageViewsThisWeek: number;
  topPages: { path: string; count: number }[];
  uniqueVisitorsToday: number;
}

interface FunnelMetrics {
  total: number;
  today: number;
  last7: number;
  byName: { name: string; count: number }[];
  recent: { event_name: string; label: string | null; path: string | null; created_at: string }[];
}

/**
 * Page-view stats from the self-hosted `page_views` table. Wrapped in a guard
 * so the admin dashboard degrades to zeros on the very first deploy, before
 * the table exists (it is created lazily by the first /api/page-view call).
 */
async function loadTrafficMetrics(): Promise<TrafficMetrics> {
  try {
    // Purge any admin page views that were recorded before the exclusion filter was added.
    try { await sql()`DELETE FROM page_views WHERE path LIKE '/admin%'`; } catch { /* ok if table doesn't exist yet */ }
    const [total, today, week, top, unique] = await Promise.all([
      sql()`SELECT COUNT(*) as count FROM page_views`,
      sql()`SELECT COUNT(*) as count FROM page_views WHERE created_at >= CURRENT_DATE`,
      sql()`SELECT COUNT(*) as count FROM page_views WHERE created_at >= NOW() - INTERVAL '7 days'`,
      sql()`SELECT path, COUNT(*) as count FROM page_views GROUP BY path ORDER BY count DESC LIMIT 5`,
      sql()`SELECT COUNT(DISTINCT ip) as count FROM page_views WHERE created_at >= CURRENT_DATE`,
    ]);
    return {
      totalPageViews: Number(total[0].count),
      pageViewsToday: Number(today[0].count),
      pageViewsThisWeek: Number(week[0].count),
      topPages: (top as any[]).map((r) => ({ path: r.path, count: Number(r.count) })),
      uniqueVisitorsToday: Number(unique[0].count),
    };
  } catch {
    // page_views may not exist yet — don't fail the whole dashboard.
    return {
      totalPageViews: 0,
      pageViewsToday: 0,
      pageViewsThisWeek: 0,
      topPages: [],
      uniqueVisitorsToday: 0,
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
    const [userCount, planRows, recentUsers, waitlistCount, recentWaitlist, diagCount, billCount, traffic, funnel] = await Promise.all([
      sql()`SELECT COUNT(*) as count FROM users`,
      sql()`SELECT plan_tier, COUNT(*) as count FROM users GROUP BY plan_tier ORDER BY count DESC`,
      sql()`SELECT id, email, plan_tier, trial_started_at, subscription_status, created_at FROM users ORDER BY created_at DESC`,
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
