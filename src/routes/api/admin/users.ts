import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

async function handler({ request }: { request: Request }) {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const cookies: Record<string, string> = {};
    for (const pair of cookieHeader.split("; ")) {
      const eq = pair.indexOf("=");
      if (eq > 0) cookies[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    const token = cookies["contrax_session"];
    if (!token) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const db = sql();
    const sessionRows = await db`
      SELECT user_id FROM sessions WHERE token = ${token} AND expires_at > NOW() LIMIT 1
    `;
    if (sessionRows.length === 0) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userIdFromSession = (sessionRows[0] as { user_id: number }).user_id;
    const adminRows = await db`
      SELECT id, email, is_admin FROM users WHERE id = ${userIdFromSession} LIMIT 1
    `;
    if (adminRows.length === 0 || !(adminRows[0] as { is_admin?: boolean }).is_admin) {
      return Response.json({ error: "Admin access required" }, { status: 403 });
    }

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
