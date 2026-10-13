import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { qaFunnelExclusionSQL, adminFunnelExclusionSQL, qaUserExclusionSQL } from "~/lib/qa-exclusion";
import { ACTIVATION_EVENTS } from "~/lib/tracking-intake";
import { storyQuery, type StoryVisitor } from "~/lib/story-funnel";
import { RECOMPETES_CLICK_EVENTS, RECOMPETES_PATHS, recompetesClicksQuery, recompetesCounts } from "~/lib/recompetes-funnel";

async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });
  const requested = Number.parseInt(new URL(request.url).searchParams.get("days") || "30", 10);
  const days = Number.isFinite(requested) ? Math.min(365, Math.max(1, requested)) : 30;
  const to = new Date().toISOString(); const from = new Date(Date.parse(to) - days * 86400000).toISOString();
  const human = `NOT COALESCE((${BOT_EXCLUSION_SQL}), false) AND ${qaFunnelExclusionSQL()} AND ${adminFunnelExclusionSQL()}`;
  try {
    const tables = await sql()`SELECT to_regclass('public.funnel_events') AS events, to_regclass('public.page_views') AS pages`;
    if (!tables[0]?.events || !tables[0]?.pages) return Response.json({ rangeDays: days, from, to, counts: recompetesCounts([], []) });
    const [rows, clicks] = await Promise.all([
      sql().query(storyQuery(human, qaUserExclusionSQL("u.")), [from, to, RECOMPETES_PATHS, [...ACTIVATION_EVENTS]]),
      sql().query(recompetesClicksQuery(human), [from, to, [...RECOMPETES_CLICK_EVENTS]]),
    ]);
    return Response.json({ rangeDays: days, from, to, counts: recompetesCounts(rows as StoryVisitor[], clicks as { event_name: string; visitors: number }[]) });
  } catch (error) {
    console.error("[recompetes-funnel]", error);
    return Response.json({ error: "Failed to load Contracts Ending Soon funnel" }, { status: 500 });
  }
}
export const Route = createFileRoute("/api/admin/recompetes-funnel")({ server: { handlers: { GET: handler } } });
