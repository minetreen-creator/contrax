import { createFileRoute } from "@tanstack/react-router";
import { syncFarDfars } from "../../lib/far-dfars";

/**
 * GET /api/sync-far
 *
 * Fetches, parses, and indexes the complete FAR and DFARS clause text from
 * acquisition.gov into the `far_clauses` table (idempotent — safe to run
 * repeatedly). The Copilot, Compliance Checker, and scoring engine cite these
 * clauses by exact number (e.g. "per FAR 52.212-1").
 *
 * Query params:
 *   source=far|dfars|all   (default: all)
 *   parts=52,252           (optional — restrict to specific parts for a fast,
 *                           targeted refresh; default: every FAR + DFARS part)
 *
 * Auth: shared token, same contract as /api/sync-bids — `Authorization:
 * Bearer <token>` (how Vercel Cron sends the cron `secret`) or `?token=<token>`
 * (convenient for manual testing / the admin button).
 *
 * NOTE: like sync-bids.ts, keep this module free of node builtins — it only
 * uses global fetch + neon (via src/lib/far-dfars.ts), so it stays compatible
 * with the client-bundle protection.
 */

const FALLBACK_SYNC_TOKEN = "cx-sync-4f8a2c1e9b3d7f5a6e0c4b8d2a1f9e3c";

function extractToken(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  return new URL(request.url).searchParams.get("token") ?? "";
}

async function handler({ request }: { request: Request }) {
  try {
    const expected = process.env.SYNC_TOKEN || FALLBACK_SYNC_TOKEN;
    const provided = extractToken(request);
    if (!provided || provided !== expected) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = new URL(request.url).searchParams;
    const sourceParam = params.get("source") ?? "all";
    const sources = sourceParam === "far" ? ["far"] : sourceParam === "dfars" ? ["dfars"] : ["far", "dfars"];
    const partsParam = params.get("parts");
    const parts = partsParam
      ? partsParam.split(",").map((p) => Number(p.trim())).filter((p) => Number.isInteger(p) && p > 0)
      : undefined;

    const result = await syncFarDfars({ sources, parts });

    console.log(
      `[sync-far] ${result.sources.join("+")} parts=${result.requestedParts} fetched=${result.fetchedParts} failed=${result.failedParts.length} clauses=${result.clausesIndexed} in ${result.duration}s`,
    );

    return Response.json({
      success: true,
      ...result,
      note: "Idempotent — re-running refreshes clause text without duplicates.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sync-far] sync failed:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/sync-far")({
  server: { handlers: { GET: handler } },
});
