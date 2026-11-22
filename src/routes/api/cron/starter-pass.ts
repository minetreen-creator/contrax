import { createFileRoute } from "@tanstack/react-router";
import { isAuthorizedCron } from "~/lib/cron-dispatch";

/**
 * GET /api/cron/starter-pass — daily from Vercel Cron (build-vercel.sh `crons`,
 * 14:41 UTC). Sends the one "your bid emails stop on …" reminder five days before
 * a $5 Starter pass ends, and returns ended passes to free Basic
 * (src/lib/starter-pass.server.ts). Owner 2026-11-22: it also emails each $9 a month
 * subscriber one reminder three days before every charge. Charges nothing itself. Auth: `Authorization:
 * Bearer $CRON_SECRET` only (fail-closed).
 */
async function handler({ request }: { request: Request }) {
  if (!isAuthorizedCron(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { runStarterPassJobs } = await import("~/lib/starter-pass.server");
    const jobs = await runStarterPassJobs();
    // Owner 2026-11-22 ("You can handle stripe"): once a day, make sure Stripe has what a monthly
    // plan needs (the cancel page, and the webhook events that carry renewals and cancellations),
    // and keep the result where a read-only job can see it. Never fails the pass jobs.
    let stripeSetup: unknown = null;
    try {
      const { fixStripeSetup } = await import("~/lib/stripe-setup.server");
      const { stripeSetupSummary } = await import("~/lib/stripe-setup-summary");
      stripeSetup = stripeSetupSummary(await fixStripeSetup());
      const { sql } = await import("~/db");
      await sql()`CREATE TABLE IF NOT EXISTS ops_status (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
      await sql()`INSERT INTO ops_status (key, value) VALUES ('stripe_setup', ${JSON.stringify(stripeSetup)}::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`;
    } catch (e) {
      console.error("[cron/starter-pass] stripe setup check failed:", (e as Error).message);
    }
    return Response.json({ ...jobs, stripeSetup });
  } catch (err) {
    console.error("[cron/starter-pass] failed:", err);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/cron/starter-pass")({
  server: { handlers: { GET: handler } },
});
