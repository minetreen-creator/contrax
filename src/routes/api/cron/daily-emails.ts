import { createFileRoute } from "@tanstack/react-router";
import {
  DAILY_EMAILS_REPO,
  DAILY_EMAILS_WORKFLOW,
  dispatchWorkflow,
  isAuthorizedCron,
} from "~/lib/cron-dispatch";

/**
 * GET /api/cron/daily-emails — called by Vercel Cron (see build-vercel.sh
 * `crons`). Starts the Daily Emails workflow on GitHub with `gated=true`, so the
 * workflow's once-a-day, at-or-after-6-AM-Eastern gate still decides whether to
 * send. Auth: `Authorization: Bearer $CRON_SECRET` only (fail-closed).
 * Needs GH_DISPATCH_TOKEN: a fine-grained token limited to this repo with
 * Actions read & write.
 */
async function handler({ request }: { request: Request }) {
  if (!isAuthorizedCron(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    console.error("[cron/daily-emails] GH_DISPATCH_TOKEN is not set — cannot start the workflow");
    return Response.json({ error: "GH_DISPATCH_TOKEN not configured" }, { status: 500 });
  }
  const r = await dispatchWorkflow({
    token,
    repo: DAILY_EMAILS_REPO,
    workflow: DAILY_EMAILS_WORKFLOW,
    inputs: { gated: "true" },
  });
  if (!r.ok) {
    console.error(`[cron/daily-emails] dispatch failed (${r.status}): ${r.detail}`);
    return Response.json({ error: "dispatch failed", status: r.status }, { status: 502 });
  }
  console.log("[cron/daily-emails] Daily Emails workflow started (gated)");
  return Response.json({ started: true });
}

export const Route = createFileRoute("/api/cron/daily-emails")({
  server: { handlers: { GET: handler } },
});
