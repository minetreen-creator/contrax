import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { scoreBidServer } from "~/lib/score-bid";

async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => null)) as {
      bidId?: unknown;
      regenerate?: unknown;
    } | null;
    const bidId = Number(body?.bidId);
    const regenerate = Boolean(body?.regenerate);
    if (!Number.isInteger(bidId) || bidId <= 0) {
      return Response.json({ error: "Invalid bid id" }, { status: 400 });
    }
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    const score = await scoreBidServer({ user, bidId, regenerate });
    return Response.json(score);
  } catch (err) {
    console.error("[api/score] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Win probability analysis failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/score")({
  server: { handlers: { POST: handler } },
});
