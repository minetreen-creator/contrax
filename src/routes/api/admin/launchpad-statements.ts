import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { ADMIN_EMAILS } from "~/lib/admin";
import { maskLeadEmail } from "~/lib/radar-leads-funnel";

/**
 * GET /api/admin/launchpad-statements?days=30 (owner 2026-10-17)
 * Who emailed themselves a Launchpad capability statement: company, trade,
 * state, masked email (first char + domain, like every admin lead table),
 * whether they opted into bid alerts, and whether the email went out.
 * Admin and @test.contrax addresses are left out. Missing table → empty list.
 */
async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

    const days = Math.min(90, Math.max(1, parseInt(new URL(request.url).searchParams.get("days") ?? "30", 10) || 30));
    const from = new Date(Date.now() - days * 86400 * 1000).toISOString();
    const table = (await sql()`SELECT to_regclass('public.launchpad_statements') IS NOT NULL AS ok`) as { ok: boolean }[];
    if (!table[0]?.ok) return Response.json({ rangeDays: days, total: 0, rows: [] });

    const admins = [...ADMIN_EMAILS].map((e) => e.toLowerCase());
    const rows = (await sql()`
      SELECT id, email, company, trade, state, alerts_opt_in, sent, created_at
      FROM launchpad_statements
      WHERE created_at >= ${from}
        AND NOT (LOWER(email) = ANY(${admins}::text[]))
        AND LOWER(email) NOT LIKE '%@test.contrax'
      ORDER BY created_at DESC
      LIMIT 200
    `) as { id: number; email: string; company: string; trade: string | null; state: string | null; alerts_opt_in: boolean; sent: boolean; created_at: string }[];

    return Response.json({
      rangeDays: days,
      total: rows.length,
      rows: rows.map((r) => ({
        id: Number(r.id),
        maskedEmail: maskLeadEmail(r.email),
        company: r.company,
        trade: r.trade,
        state: r.state,
        alerts: r.alerts_opt_in,
        sent: r.sent,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    console.error("[api/admin/launchpad-statements] error:", error);
    return Response.json({ error: "Failed to load Launchpad statements" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/launchpad-statements")({
  server: { handlers: { GET: handler } },
});
