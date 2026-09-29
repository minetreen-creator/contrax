import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";
import { qaExternalUserSQL } from "~/lib/qa-exclusion";
import { grantsOperationsAccess, priceFor } from "~/lib/contractor-operations-billing.server";

async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  try {
    const rows = await sql()`
      SELECT u.email, s.status, s.price_id, s.current_period_end, s.updated_at
      FROM contractor_operations_subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE ${sql().unsafe(qaExternalUserSQL("u."))}
      ORDER BY s.updated_at DESC`;
    const subscriptions = rows.map((row) => ({
      email: String(row.email),
      status: String(row.status),
      interval: row.price_id === priceFor("month") ? "monthly"
        : row.price_id === priceFor("year") ? "annual" : "unknown",
      currentPeriodEnd: row.current_period_end ? String(row.current_period_end) : null,
      updatedAt: String(row.updated_at),
    }));
    return Response.json({
      source: "app-db-webhook",
      active: subscriptions.filter((row) => grantsOperationsAccess(row.status)).length,
      total: subscriptions.length,
      subscriptions,
    });
  } catch (error) {
    console.error("[api/admin/payments] subscription read failed", error);
    return Response.json({ error: "Could not load Contrax Payments subscriptions" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/payments")({
  server: { handlers: { GET: handler } },
});
