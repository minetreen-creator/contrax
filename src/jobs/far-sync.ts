/**
 * FAR/DFARS Sync Runner
 *
 * Fetches, parses, and indexes the complete FAR + DFARS clause corpus from
 * acquisition.gov into the `far_clauses` table (idempotent — safe to run
 * repeatedly).
 *
 * Usage:
 *   bun run src/jobs/far-sync.ts     (manual run)
 *   bun run sync-far                  (via package.json script)
 *
 * Scheduling (production):
 *   GitHub Actions workflow .github/workflows/sync-far.yml runs
 *   `bun run sync-far` daily at 06:30 UTC and can be triggered manually via
 *   workflow_dispatch. The Vercel cron entry for /api/sync-far was removed —
 *   Vercel Hobby's 10s serverless cap cannot fit a full 107-part sync, and the
 *   cron's CRON_SECRET bearer token was never accepted by the route, so it
 *   401'd on every run. /api/sync-far remains as an on-demand endpoint for the
 *   admin "Sync core parts" button and manual ?token= refreshes.
 *
 * Exit codes:
 *   0 — sync completed (partial failures — e.g. a few 404s — are acceptable,
 *       reported in failedParts, and visible in the workflow log)
 *   1 — total failure (fetchedParts === 0) so the workflow surfaces the break
 */
import { syncFarDfars } from "~/lib/far-dfars";

async function main() {
  try {
    const result = await syncFarDfars({ concurrency: 6 });

    console.log("\n=== FAR/DFARS sync complete ===");
    console.log(`  requestedParts: ${result.requestedParts}`);
    console.log(`  fetchedParts:   ${result.fetchedParts}`);
    console.log(
      `  failedParts:    ${
        result.failedParts.length > 0 ? result.failedParts.join(", ") : "none"
      }`,
    );
    console.log(`  clausesIndexed: ${result.clausesIndexed}`);
    console.log(`  duration:       ${result.duration}s`);

    if (result.fetchedParts === 0) {
      console.error("\n💥 FAR/DFARS sync failed completely — 0 parts fetched");
      process.exit(1);
    }

    console.log("\n🏁 FAR/DFARS sync finished successfully");
    process.exit(0);
  } catch (err) {
    console.error("\n💥 FAR/DFARS sync crashed:", err);
    process.exit(1);
  }
}

main();
