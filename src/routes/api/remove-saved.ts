import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { removeMatch } from "~/lib/saved-matches";

/**
 * POST /api/remove-saved
 *
 * Un-saves a bid from the user's pipeline (DELETE semantics via POST, matching
 * the repo's action-route convention). Auth-required: 401 without a session.
 *
 * Body: { bidId: number }
 * Success: { success: true } — idempotent; removing a row that does not exist
 * is still success.
 */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = (await request.json().catch(() => null)) as { bidId?: unknown } | null;
    const bidId = Number(body?.bidId);
    if (!Number.isInteger(bidId) || bidId <= 0) {
      return Response.json({ error: "Invalid bid id" }, { status: 400 });
    }
    await removeMatch(user.id, bidId);
    return Response.json({ success: true });
  } catch (err) {
    console.error("[api/remove-saved] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to remove bid" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/remove-saved")({
  server: { handlers: { POST: handler } },
});
