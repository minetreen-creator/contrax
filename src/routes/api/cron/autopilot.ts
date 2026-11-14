import { createFileRoute } from "@tanstack/react-router";
import { isAuthorizedCron } from "~/lib/cron-dispatch";

/**
 * GET /api/cron/autopilot — Vercel Cron (build-vercel.sh `crons`), every 30 minutes (owner 2026-11-14, database cost: was 10) from 08:00
 * to 10:30 UTC. Scores members' new matching bids for Auto-Pilot and saves the answers, so the
 * 6 AM email only reads them (src/lib/autopilot-prescore.server.ts; owner 2026-11-09: "github
 * isn't reliable"). Sends nothing. Auth: `Authorization: Bearer $CRON_SECRET` only (fail-closed).
 */
async function handler({ request }: { request: Request }) {
  if (!isAuthorizedCron(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { prescoreAutopilot } = await import("~/lib/autopilot-prescore.server");
    const r = await prescoreAutopilot();
    console.log(`[cron/autopilot] ${JSON.stringify(r)}`);
    return Response.json(r);
  } catch (err) {
    console.error("[cron/autopilot] failed:", err);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/cron/autopilot")({
  server: { handlers: { GET: handler } },
});
