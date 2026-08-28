import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { qaExternalUserSQL, qaUserExclusionSQL } from "~/lib/qa-exclusion";

/**
 * GET /api/admin/user-activity
 *
 * Admin-only research surface: shows how EXTERNAL (non-admin) users are using
 * the product — last login, and search / score / save counts with their most
 * recent timestamps — WITHOUT exposing any private content. This endpoint
 * returns ONLY counts + timestamps + email + plan_tier + created_at. No bid
 * titles, no proposal/draft text, no saved-match notes, no business-profile
 * data.
 *
 * Data sources (heterogeneous tables joined in JS by NUMERIC user id):
 *   - last_login : MAX(sessions.created_at) per user (inserted on every
 *     login/signup)
 *   - search_count / last_search : `user_searches` (created lazily by the
 *     dashboard data route; going-forward only, so it starts at 0)
 *   - score_count / last_score  : `bid_scores` (user_id is TEXT — cast to int)
 *   - save_count / last_save    : `saved_matches`
 *
 * External users = users where is_admin = false AND plan_tier <> 'demo' AND
 * email domain is NOT @test.contrax (QA/test accounts — owner rule 2026-08-28).
 * Mirrors the metrics.ts "real signups" filter. Ordered by most recent
 * activity (last login / last search / last score / last save / created_at).
 *
 * Returns 401/403 on auth/admin failure, 500 on any query failure (clean JSON
 * like the sibling admin endpoints).
 */

interface UserActivityRow {
  user_id: number;
  email: string;
  plan_tier: string | null;
  created_at: string | null;
  last_login: string | null;
  search_count: number;
  last_search: string | null;
  score_count: number;
  last_score: string | null;
  save_count: number;
  last_save: string | null;
}

async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  try {
    // External users only — never admins, never the demo account, never QA/test.
    const userRows = await sql()`
      SELECT id, email, plan_tier, created_at
      FROM users
      WHERE ${sql().unsafe(qaExternalUserSQL())}
      ORDER BY created_at DESC`;
    const users = (userRows as any[]).map((r) => ({
      user_id: Number(r.id),
      email: r.email,
      plan_tier: r.plan_tier ?? null,
      created_at: r.created_at ? String(r.created_at) : null,
    }));

    if (users.length === 0) {
      // Pre-revenue / no external users yet — return an empty array cleanly.
      return Response.json([]);
    }

    // Aggregate per-user activity, joined to the external-user filter in SQL,
    // then merged onto the user rows in JS by numeric user id. The
    // user_searches table is created lazily by the dashboard-data route, so it
    // may not exist yet on the very first deploy — guard it and treat it as
    // zero searches rather than failing the whole endpoint.
    const [loginRows, scoreRows, saveRows] = await Promise.all([
      sql()`
        SELECT s.user_id AS user_id, MAX(s.created_at) AS last_login
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE u.is_admin = false AND u.plan_tier <> 'demo'
          AND ${sql().unsafe(qaUserExclusionSQL("u."))}
        GROUP BY s.user_id`,
      sql()`
        SELECT s.user_id AS user_id, COUNT(*)::int AS count, MAX(s.generated_at) AS last_score
        FROM bid_scores s
        JOIN users u ON u.id = s.user_id::int
        WHERE s.user_id ~ '^[0-9]+$'
          AND u.is_admin = false AND u.plan_tier <> 'demo'
          AND ${sql().unsafe(qaUserExclusionSQL("u."))}
        GROUP BY s.user_id`,
      sql()`
        SELECT s.user_id AS user_id, COUNT(*)::int AS count, MAX(s.created_at) AS last_save
        FROM saved_matches s
        JOIN users u ON u.id = s.user_id
        WHERE u.is_admin = false AND u.plan_tier <> 'demo'
          AND ${sql().unsafe(qaUserExclusionSQL("u."))}
        GROUP BY s.user_id`,
    ]);
    let searchRows: any[] = [];
    try {
      searchRows = (await sql()`
        SELECT s.user_id AS user_id, COUNT(*)::int AS count, MAX(s.created_at) AS last_search
        FROM user_searches s
        JOIN users u ON u.id = s.user_id
        WHERE u.is_admin = false AND u.plan_tier <> 'demo'
          AND ${sql().unsafe(qaUserExclusionSQL("u."))}
        GROUP BY s.user_id`) as any[];
    } catch {
      // user_searches table may not exist yet — zero searches.
    }

    const byUser = (rows: any[]) =>
      new Map<number, { count: number; last: string | null }>(
        rows.map((r) => [
          Number(r.user_id),
          { count: Number(r.count ?? 0), last: r.last_search ?? r.last_score ?? r.last_save ?? null },
        ]),
      );

    const logins = new Map<number, string | null>();
    (loginRows as any[]).forEach((r) => logins.set(Number(r.user_id), r.last_login ? String(r.last_login) : null));
    const searches = byUser(searchRows as any[]);
    const scores = byUser(scoreRows as any[]);
    const saves = byUser(saveRows as any[]);

    const result: UserActivityRow[] = users.map((u) => {
      const s = searches.get(u.user_id);
      const sc = scores.get(u.user_id);
      const sv = saves.get(u.user_id);
      return {
        user_id: u.user_id,
        email: u.email,
        plan_tier: u.plan_tier,
        created_at: u.created_at,
        last_login: logins.get(u.user_id) ?? null,
        search_count: s?.count ?? 0,
        last_search: s?.last ?? null,
        score_count: sc?.count ?? 0,
        last_score: sc?.last ?? null,
        save_count: sv?.count ?? 0,
        last_save: sv?.last ?? null,
      };
    });

    // Order by most recent activity: latest of last_login / last_search /
    // last_score / last_save, falling back to created_at.
    result.sort((a, b) => {
      const ta = Math.max(
        ...[a.last_login, a.last_search, a.last_score, a.last_save, a.created_at]
          .map((t) => (t ? new Date(t).getTime() : 0)),
      );
      const tb = Math.max(
        ...[b.last_login, b.last_search, b.last_score, b.last_save, b.created_at]
          .map((t) => (t ? new Date(t).getTime() : 0)),
      );
      return tb - ta;
    });

    return Response.json(result);
  } catch (err) {
    console.error("[api/admin/user-activity] error:", err);
    return Response.json({ error: "Failed to load external user activity" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/user-activity")({
  server: { handlers: { GET: handler } },
});
