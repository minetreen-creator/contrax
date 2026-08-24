import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

// Tables with a user_id FK referencing users(id) WITHOUT ON DELETE CASCADE.
// These must be purged before the final `DELETE FROM users`, otherwise the FK
// constraint throws and the user cannot be removed. Kept alphabetically.
const USER_DEPENDENT_TABLES = [
  "ai_feedback",
  "api_keys",
  "bid_alerts",
  "business_profiles",
  "google_accounts",
  "integrations",
  "knowledge_documents",
  "notifications",
  "pending_drafts",
  "proposal_drafts",
  "saved_matches",
  "savings_bills",
  "savings_diagnoses",
  "sessions",
  "slack_config",
  "slack_deliveries",
  "user_searches",
  "webhooks",
];

// Surface the real failure (e.g. an FK violation / constraint name) so an admin
// sees a meaningful message instead of a bare "Failed to delete user". Strips
// credential-bearing URIs and caps length to avoid leaking secrets.
function describeError(err: unknown): string {
  const e = err as { code?: unknown; constraint?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : null;
  const constraint = typeof e.constraint === "string" ? e.constraint : null;
  let detail = "";
  if (code === "23503") {
    detail = `Foreign-key violation (constraint ${constraint ? `"${constraint}"` : "unknown"}); a dependent table may be missing from the whitelist`;
  } else if (code && constraint) {
    detail = `DB error (${code}, constraint "${constraint}")`;
  } else if (code) {
    detail = `DB error (${code})`;
  }
  const raw = e.message ? String(e.message) : String(err ?? "unknown error");
  const sanitized = raw.replace(/[a-z0-9+._-]+:\/\/[^\s]+/gi, "[redacted]");
  return (detail ? `${detail} — ` : "") + sanitized.slice(0, 400);
}

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
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/admin/delete-user")({
  server: { handlers: { POST: handler } },
});
