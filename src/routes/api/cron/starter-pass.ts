import { createFileRoute } from "@tanstack/react-router";
import { isAuthorizedCron } from "~/lib/cron-dispatch";

/**
 * GET /api/cron/starter-pass — daily from Vercel Cron (build-vercel.sh `crons`,
 * 14:41 UTC). Sends the one "your bid emails stop on …" reminder five days before
 * a $5 Starter pass ends, and returns ended passes to free Basic
 * (src/lib/starter-pass.server.ts). Charges nothing. Auth: `Authorization:
 * Bearer $CRON_SECRET` only (fail-closed).
 */
async function handler({ request }: { request: Request }) {
  if (!isAuthorizedCron(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { runStarterPassJobs } = await import("~/lib/starter-pass.server");
    return Response.json(await runStarterPassJobs());
  } catch (err) {
    console.error("[cron/starter-pass] failed:", err);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/cron/starter-pass")({
  server: { handlers: { GET: handler } },
});
