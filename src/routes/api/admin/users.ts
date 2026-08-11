import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

    const db = sql();
    const url = new URL(request.url);
    const email = url.searchParams.get("email");
    const userId = url.searchParams.get("id") ? Number(url.searchParams.get("id")) : null;
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);

    // List mode: no email or id → return recent users
    if (!email && !userId) {
      const rows = await db`
        SELECT id, email, plan_tier, subscription_status, trial_started_at,
               is_admin, created_at
        FROM users
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return Response.json({ users: rows, count: rows.length });
    }

    let rows;
    if (email) {
      rows = await db`
        SELECT id, email, plan_tier, subscription_status, trial_started_at,
               is_admin, created_at
        FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
      `;
    } else if (userId && Number.isInteger(userId)) {
      rows = await db`
        SELECT id, email, plan_tier, subscription_status, trial_started_at,
               is_admin, created_at
        FROM users WHERE id = ${userId} LIMIT 1
      `;
    }

    if (!rows || rows.length === 0) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    return Response.json({ user: rows[0] });
  } catch (err) {
    console.error("[api/admin/users] error:", err);
    return Response.json({ error: "Failed to look up user" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/users")({
  server: { handlers: { GET: handler } },
});
