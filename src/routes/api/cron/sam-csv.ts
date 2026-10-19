import { createFileRoute } from "@tanstack/react-router";
import {
  DAILY_EMAILS_REPO,
  SAM_CSV_WORKFLOW,
  dispatchWorkflow,
  isAuthorizedCron,
} from "~/lib/cron-dispatch";

/**
 * GET /api/cron/sam-csv — called by Vercel Cron (see build-vercel.sh `crons`)
 * at 05:17 UTC daily (owner 2026-10-19: GitHub's own 04:30 schedule for this
 * workflow never fired on its first night). Starts the nightly SAM CSV import;
 * SAM's file is ready by ~03:30 UTC. A late GitHub schedule run on top is
 * harmless: the import skips unchanged rows and the workflow's concurrency
 * group runs one at a time. Auth: `Authorization: Bearer $CRON_SECRET` only
 * (fail-closed). Needs GH_DISPATCH_TOKEN (Actions read & write on this repo).
 */
async function handler({ request }: { request: Request }) {
  if (!isAuthorizedCron(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    console.error("[cron/sam-csv] GH_DISPATCH_TOKEN is not set — cannot start the workflow");
    return Response.json({ error: "GH_DISPATCH_TOKEN not configured" }, { status: 500 });
  }
  const r = await dispatchWorkflow({
    token,
    repo: DAILY_EMAILS_REPO,
    workflow: SAM_CSV_WORKFLOW,
    inputs: { report_only: "false" },
  });
  if (!r.ok) {
    console.error(`[cron/sam-csv] dispatch failed (${r.status}): ${r.detail}`);
    return Response.json({ error: "dispatch failed", status: r.status }, { status: 502 });
  }
  console.log("[cron/sam-csv] Sync SAM CSV workflow started");
  return Response.json({ started: true });
}

export const Route = createFileRoute("/api/cron/sam-csv")({
  server: { handlers: { GET: handler } },
});
