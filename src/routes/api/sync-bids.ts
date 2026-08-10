import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/sync-bids
 *
 * Admin diagnostic endpoint (previously the Vercel Cron entry point).
 *
 * The scheduled bid sync now runs on GitHub Actions (see
 * .github/workflows/sync-bids.yml) — Vercel Hobby's 10s serverless cap cannot
 * fit a 6–15 minute sync across 59 sources, so the cron was silently failing
 * and has been removed from vercel.json. This endpoint authenticates the
 * caller and returns 202 Accepted with a pointer to the workflow.
 *
 * To trigger a sync:
 *   - GitHub Actions UI → "Sync Bids" → "Run workflow"
 *   - `gh workflow run sync-bids.yml`
 *   - locally: `DATABASE_URL=... bun run sync-bids`
 *
 * Auth: shared token. The caller must present it either as
 * `Authorization: Bearer <token>` or as `?token=<token>`. The expected token
 * is `process.env.SYNC_TOKEN`, falling back to the hardcoded value below
 * (which was also the old cron secret, so the cron stayed authorized). When
 * rotating, set SYNC_TOKEN in the Vercel project env.
 *
 * NOTE: do not import node builtins at the top level of this file — TanStack
 * Start API routes are bundled for the server, but keep the module free of
 * server-only imports to stay compatible with the client-bundle protection.
 */

const FALLBACK_SYNC_TOKEN = "cx-sync-4f8a2c1e9b3d7f5a6e0c4b8d2a1f9e3c";

const WORKFLOW_URL =
  "https://github.com/minetreen-creator/contrax/actions/workflows/sync-bids.yml";

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

    // The full sync no longer runs here — Vercel's 10s serverless cap cannot
    // fit it. Trigger the GitHub Actions workflow instead.
    return Response.json(
      {
        success: true,
        status: "accepted",
        message:
          "Bid sync now runs on GitHub Actions (cron: every 4h on weekdays, Mon–Fri UTC). " +
          "Trigger it from the Actions UI ('Run workflow'), with `gh workflow run sync-bids.yml`, " +
          "or run `bun run sync-bids` locally with DATABASE_URL set.",
        workflow: WORKFLOW_URL,
      },
      { status: 202 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sync-bids] handler error:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/sync-bids")({
  server: { handlers: { GET: handler } },
});
