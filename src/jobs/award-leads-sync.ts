/**
 * Daily award-leads sync (owner 2026-10-06, idea #6): new federal contract
 * winners from USAspending.gov into award_leads. Run by
 * .github/workflows/sync-award-leads.yml; `--dry-run` fetches and parses only.
 *
 * History (owner 2026-11-11): `--end=2026-08-31 --days=10` loads one past slice.
 * A slice that reaches the page limit exits 1, because the job takes the largest
 * awards first and a cut-off slice would be missing its small ones.
 */
import { parseAwardSyncArgs } from "~/lib/award-leads";
import { syncAwardLeads } from "~/lib/award-leads.server";

const args = parseAwardSyncArgs(process.argv.slice(2));
try {
  const r = await syncAwardLeads(args);
  console.log(
    `[award-leads] ${r.start} to ${r.end} pages=${r.pages} seen=${r.seen} kept=${r.kept} inserted=${r.inserted}${args.dryRun ? " (dry run)" : ""}`,
  );
  if (r.truncated) {
    console.error("[award-leads] the search was cut off before the small awards (our page limit, or USAspending's 10,000-record limit): this slice is incomplete. Use fewer days.");
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error("[award-leads] sync failed:", err);
  process.exit(1);
}
