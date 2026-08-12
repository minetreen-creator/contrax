import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { syncFarDfars, type FarDfarsSyncResult } from "~/lib/far-dfars";

/**
 * Admin-triggered FAR/DFARS sync. Defaults to the two clause parts that matter
 * most to proposal work (FAR 52, DFARS 252) so the button completes inside a
 * serverless function; pass `parts` to target others. The daily cron
 * (/api/sync-far) refreshes the full corpus.
 *
 * Sources are restricted per part so every fetch job is a valid source/part
 * combination: FAR parts live in the 1–53 range, DFARS parts in 201–253 plus
 * 270. Cross-multiplying the requested parts against both default sources used
 * to create impossible jobs (FAR part 252, DFARS part 52) that 404'd and made
 * the button report "(2 part(s) failed)" even when the sync succeeded.
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

    // Split the requested parts by the regulation that defines them, then sync
    // each side with its source pinned — no impossible cross-product jobs, so
    // the combined result reports 0 failures on a clean run.
    const farParts = parts.filter((p) => p >= 1 && p <= 53);
    const dfarsParts = parts.filter((p) => (p >= 201 && p <= 253) || p === 270);

    const runs: FarDfarsSyncResult[] = [];
    if (farParts.length > 0) {
      runs.push(await syncFarDfars({ sources: ["far"], parts: farParts, concurrency: 4 }));
    }
    if (dfarsParts.length > 0) {
      runs.push(await syncFarDfars({ sources: ["dfars"], parts: dfarsParts, concurrency: 4 }));
    }

    // Combine into one result with the same shape the admin UI already renders.
    return Response.json({
      sources: runs.flatMap((r) => r.sources),
      requestedParts: runs.reduce((sum, r) => sum + r.requestedParts, 0),
      fetchedParts: runs.reduce((sum, r) => sum + r.fetchedParts, 0),
      failedParts: runs.flatMap((r) => r.failedParts),
      clausesIndexed: runs.reduce((sum, r) => sum + r.clausesIndexed, 0),
      seeded: runs.some((r) => r.seeded),
      duration: runs
        .reduce((sum, r) => sum + (Number(r.duration) || 0), 0)
        .toFixed(1),
    } satisfies FarDfarsSyncResult);
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
