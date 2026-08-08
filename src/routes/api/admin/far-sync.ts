import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { syncFarDfars } from "~/lib/far-dfars";

/**
 * Admin-triggered FAR/DFARS sync. Defaults to the two clause parts that matter
 * most to proposal work (FAR 52, DFARS 252) so the button completes inside a
 * serverless function; pass `parts` to target others. The daily cron
 * (/api/sync-far) refreshes the full corpus.
 */
async function handler({ request }: { request: Request }) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  if (!user.is_admin) return Response.json({ error: "Admin access required" }, { status: 403 });

  try {
    let body: { parts?: unknown } = {};
    try {
      body = (await request.json()) as { parts?: unknown };
    } catch {
      // No body / not JSON — fall through to the default parts.
    }
    const parts = Array.isArray(body.parts)
      ? body.parts.map((p) => Number(p)).filter((p) => Number.isInteger(p) && p > 0)
      : [52, 252];
    return Response.json(await syncFarDfars({ parts, concurrency: 4 }));
  } catch (err) {
    console.error("[api/admin/far-sync] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "FAR/DFARS sync failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/admin/far-sync")({
  server: { handlers: { POST: handler } },
});
