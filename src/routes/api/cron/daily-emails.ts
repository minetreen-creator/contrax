import { createFileRoute } from "@tanstack/react-router";
import { isAuthorizedCron } from "~/lib/cron-dispatch";

/**
 * GET /api/cron/daily-emails — Vercel Cron (build-vercel.sh `crons`), every 10 minutes from
 * 10:00 to 15:50 UTC. Sends the morning emails here on Vercel (owner 2026-11-09: "move the email
 * to vercel"); the first call at or after 6 AM New York time sends, later calls find each job
 * already claimed and skip (src/lib/daily-emails.server.ts). The GitHub workflow is a backup that
 * uses the same claims. Auth: `Authorization: Bearer $CRON_SECRET` only (fail-closed).
 */
async function handler({ request }: { request: Request }) {
  if (!isAuthorizedCron(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { runDailyEmails } = await import("~/lib/daily-emails.server");
    const r = await runDailyEmails("vercel");
    console.log(`[cron/daily-emails] ${JSON.stringify({ day: r.day, due: r.due, ran: r.ran.map((j) => `${j.job}:${j.status}`), skipped: r.skipped })}`);
    return Response.json(r, { status: r.ran.some((j) => j.status === "failed") ? 500 : 200 });
  } catch (err) {
    console.error("[cron/daily-emails] failed:", err);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/cron/daily-emails")({
  server: { handlers: { GET: handler } },
});
