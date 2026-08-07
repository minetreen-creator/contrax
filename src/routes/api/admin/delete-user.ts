import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";

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
    const admin = await getCurrentUser();
    if (!admin) return Response.json({ error: "Not authenticated" }, { status: 401 });
    if (!admin.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

    const body = (await request.json()) as { userId?: unknown };
    const userId = Number(body.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return Response.json({ error: "Invalid user id" }, { status: 400 });
    }

    const db = sql();
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
