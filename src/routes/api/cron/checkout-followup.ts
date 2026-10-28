import { createFileRoute } from "@tanstack/react-router";
import { isAuthorizedCron } from "~/lib/cron-dispatch";

/**
 * GET /api/cron/checkout-followup — hourly from Vercel Cron (build-vercel.sh
 * `crons`). Emails people who left a plan checkout unpaid an hour or more ago
 * (src/lib/checkout-followup.server.ts). Auth: `Authorization: Bearer
 * $CRON_SECRET` only (fail-closed).
 */
async function handler({ request }: { request: Request }) {
  if (!isAuthorizedCron(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { runCheckoutFollowups } = await import("~/lib/checkout-followup.server");
    return Response.json(await runCheckoutFollowups());
  } catch (err) {
    console.error("[cron/checkout-followup] failed:", err);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/cron/checkout-followup")({
  server: { handlers: { GET: handler } },
});
