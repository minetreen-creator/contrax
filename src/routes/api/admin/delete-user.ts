import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

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
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

    const db = sql();

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

    // Delete dependent rows, then the user — some tables have FK refs without cascade.
    // db.unsafe(raw) wraps a raw SQL fragment so it can be inlined inside a tagged
    // template (identifiers can't be bound parameters). USER_DEPENDENT_TABLES is a
    // hardcoded whitelist, so inlining `table` is safe; userId stays a bound param.
    for (const table of USER_DEPENDENT_TABLES) {
      try {
        await db`DELETE FROM ${db.unsafe(table)} WHERE user_id = ${userId}`;
      } catch {
        // table might not exist or lack user_id — skip silently
      }
    }
    await db`DELETE FROM users WHERE id = ${userId}`;

    return Response.json({ success: true });
  } catch (err) {
    console.error("[api/admin/delete-user] error:", err);
    return Response.json({ error: "Failed to delete user" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/delete-user")({
  server: { handlers: { POST: handler } },
});
