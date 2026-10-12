import { createFileRoute } from "@tanstack/react-router";
import {
  DAILY_EMAILS_REPO,
  SYNC_BIDS_WORKFLOW,
  dispatchWorkflow,
  isAuthorizedCron,
} from "~/lib/cron-dispatch";

/**
 * GET /api/cron/sync-bids — called by Vercel Cron (see build-vercel.sh
 * `crons`): weekdays every 4 hours, weekends at 15:00 UTC. Starts the Sync Bids
 * workflow on GitHub with `gated=true`, so it is skipped when another sync
 * started in the last 3.5 hours (e.g. a late GitHub schedule run). Auth: `Authorization: Bearer $CRON_SECRET` only (fail-closed).
 * Needs GH_DISPATCH_TOKEN: a fine-grained token limited to this repo with
 * Actions read & write.
 */
async function handler({ request }: { request: Request }) {
  if (!isAuthorizedCron(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    console.error("[cron/sync-bids] GH_DISPATCH_TOKEN is not set — cannot start the workflow");
    return Response.json({ error: "GH_DISPATCH_TOKEN not configured" }, { status: 500 });
  }
  const r = await dispatchWorkflow({
    token,
    repo: DAILY_EMAILS_REPO,
    workflow: SYNC_BIDS_WORKFLOW,
    inputs: { gated: "true" },
  });
  if (!r.ok) {
    console.error(`[cron/sync-bids] dispatch failed (${r.status}): ${r.detail}`);
    return Response.json({ error: "dispatch failed", status: r.status }, { status: 502 });
  }
  console.log("[cron/sync-bids] Sync Bids workflow started (gated)");
  return Response.json({ started: true });
}

export const Route = createFileRoute("/api/cron/sync-bids")({
  server: { handlers: { GET: handler } },
});
