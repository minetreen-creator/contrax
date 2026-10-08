import { learningQuery } from "~/lib/learn-funnel-query";
import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { qaFunnelExclusionSQL, adminFunnelExclusionSQL, qaUserExclusionSQL } from "~/lib/qa-exclusion";
import { ACTIVATION_EVENTS } from "~/lib/tracking-intake";
import { LEARN_PATHS, learningCounts, type LearnVisitor } from "~/lib/learn-funnel";

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
    if (!tables[0]?.events || !tables[0]?.pages) return Response.json({ rangeDays: days, from, to, counts: learningCounts([]) });
    // Distinct learning visitors, including historical page views. Each later
    // action must occur AFTER that visitor's first learning visit in this window.
    // Course certificates are not visits, and existing accounts aren't new signups.
    const rows = await sql().query(learningQuery(human, qaUserExclusionSQL("u.")), [from, to, LEARN_PATHS, [...ACTIVATION_EVENTS], LEARN_PATHS.slice(1)]);
    return Response.json({ rangeDays: days, from, to, counts: learningCounts(rows as LearnVisitor[]) });
  } catch (error) {
    console.error("[learn-funnel]", error);
    return Response.json({ error: "Failed to load learning funnel" }, { status: 500 });
  }
}
export const Route = createFileRoute("/api/admin/learn-funnel")({ server: { handlers: { GET: handler } } });
