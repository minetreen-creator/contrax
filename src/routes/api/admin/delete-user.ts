import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

const USER_DEPENDENT_TABLES = [
  "google_accounts",
  "business_profiles",
  "api_keys",
  "bid_alerts",
  "saved_matches",
  "sessions",
  "proposal_drafts",
  "ai_feedback",
  "savings_diagnoses",
  "savings_bills",
  "integrations",
  "notifications",
  "knowledge_documents",
];

async function handler({ request }: { request: Request }) {
  try {
    // API route handlers lack createServerFn's RPC context, so parse the
    // session cookie directly from the request headers.
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
      SELECT user_id FROM sessions
      WHERE token = ${token} AND expires_at > NOW()
      LIMIT 1
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

    const body = (await request.json()) as { userId?: unknown };
    const userId = Number(body.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return Response.json({ error: "Invalid user id" }, { status: 400 });
    }

    const found = await db`SELECT id, email FROM users WHERE id = ${userId} LIMIT 1`;
    if (found.length === 0) return Response.json({ error: "User not found" }, { status: 404 });
    const email = String((found[0] as { email?: unknown }).email ?? "").toLowerCase();
    if (email === "minetreen@gmail.com") {
      return Response.json({ error: "The owner account cannot be deleted" }, { status: 403 });
    }

    const existing = await db`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${USER_DEPENDENT_TABLES}::text[])
    `;
    await db.transaction(async (tx) => {
      for (const row of existing as { table_name: string }[]) {
        await tx`DELETE FROM ${tx.unsafe(row.table_name)} WHERE user_id = ${userId}`;
      }
      await tx`DELETE FROM users WHERE id = ${userId}`;
    });

    return Response.json({ success: true });
  } catch (err) {
    console.error("[api/admin/delete-user] error:", err);
    return Response.json({ error: "Failed to delete user" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/delete-user")({
  server: { handlers: { POST: handler } },
});
