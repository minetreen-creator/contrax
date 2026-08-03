import { createFileRoute } from "@tanstack/react-router";
import { runSync } from "../../jobs/runner";

/**
 * GET /api/sync-bids
 *
 * Endpoint invoked by the Vercel Cron Job (see vercel.json) daily at 6 AM to
 * sync government bids from all procurement sources into the database.
 *
 * Auth: protected by a shared token. The caller must present it either as
 * `Authorization: Bearer <token>` (how Vercel Cron sends the cron `secret`)
 * or as `?token=<token>` (convenient for manual testing / the admin button).
 * The expected token is `process.env.SYNC_TOKEN`, falling back to the
 * hardcoded value below — which is also the `secret` configured for the cron
 * in vercel.json, so the cron is authorized out of the box. When rotating,
 * set SYNC_TOKEN in the Vercel project env and update the cron secret in
 * vercel.json to match.
 *
 * NOTE: do not import node builtins at the top level of this file — TanStack
 * Start API routes are bundled for the server, but keep the module free of
 * server-only imports to stay compatible with the client-bundle protection.
 * The runner chain (src/jobs/*) uses only global fetch + neon, so it is safe.
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

    const result = await runSync();

    return Response.json({
      success: true,
      count: result.totalNew,
      fetched: result.totalFetched,
      errors: result.totalErrors,
      duration: result.duration,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sync-bids] sync failed:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/sync-bids")({
  server: { handlers: { GET: handler } },
});
