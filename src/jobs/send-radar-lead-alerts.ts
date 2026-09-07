/**
 * Send radar match alerts to CONFIRMED leads — CLI entrypoint.
 *
 *   bun run src/jobs/send-radar-lead-alerts.ts
 *   # or: bun run radar-alerts   (package.json script)
 *
 * Runs once against the live DB, emails every confirmed, not-unsubscribed
 * lead whose Radar profile matches NEW open bids (deduped per lead), then
 * exits. The GitHub Actions workflow (sync-bids.yml) calls this right after
 * each 4-hour bid sync, so leads only ever hear about matches the sync just
 * discovered. Fail-open per lead: the run never aborts on one lead's failure.
 */
import { sendRadarLeadMatchAlerts } from "../lib/radar-lead-alerts";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — cannot run radar lead alerts");
    process.exit(1);
  }
  const started = Date.now();
  const result = await sendRadarLeadMatchAlerts();
  console.log(
    `\n🏁 Radar lead alerts finished in ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
      `leads=${result.leadsChecked} emails=${result.emailsSent} matches=${result.matchesEmailed}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("💥 Radar lead alerts crashed:", e);
    process.exit(1);
  });