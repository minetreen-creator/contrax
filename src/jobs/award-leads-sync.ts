/**
 * Daily award-leads sync (owner 2026-10-06, idea #6): new federal contract
 * winners from USAspending.gov into award_leads. Run by
 * .github/workflows/sync-award-leads.yml; `--dry-run` fetches and parses only.
 */
import { syncAwardLeads } from "~/lib/award-leads.server";

const dryRun = process.argv.includes("--dry-run");
try {
  const r = await syncAwardLeads({ dryRun });
  console.log(`[award-leads] pages=${r.pages} seen=${r.seen} kept=${r.kept} inserted=${r.inserted}${dryRun ? " (dry run)" : ""}`);
  process.exit(0);
} catch (err) {
  console.error("[award-leads] sync failed:", err);
  process.exit(1);
}
