/**
 * Hauling-leads sync (trucking queue item #4, owner-endorsed 2026-10-16): newly made
 * federal contract awards whose scope plausibly involves hauling, from USAspending.gov,
 * into hauling_leads for the /subcontracts section. Run by
 * .github/workflows/sync-hauling-leads.yml (Monday 13:30 UTC). `--dry-run` fetches,
 * filters and REPORTS only — it writes nothing.
 *
 * `kept` is definition R (the measured set); `placeholder_skipped` counts the R rows
 * whose recipient name is a USAspending placeholder ("MISCELLANEOUS FOREIGN AWARDEES"
 * & co), which the write gate withholds; `stored` is what this run keeps/saves.
 */
import { syncHaulingLeads } from "~/lib/hauling-leads.server";

const dryRun = process.argv.includes("--dry-run");
try {
  const r = await syncHaulingLeads({ dryRun });
  console.log(
    `[hauling-leads] window=${r.windowStart}..${r.windowEnd} pages=${r.pages} seen=${r.seen} kept=${r.kept} placeholder_skipped=${r.placeholderSkipped} stored=${r.leads.length} inserted=${r.inserted}${dryRun ? " (dry run)" : ""}`,
  );
  console.log(`[hauling-leads] scope_kind=${JSON.stringify(r.byScopeKind)} prime_kind=${JSON.stringify(r.byPrimeKind)}`);
  for (const lead of r.leads) {
    console.log(
      `[hauling-leads]   ${lead.award_date} | ${lead.pop_state ?? "--"}${lead.pop_city ? ` ${lead.pop_city}` : ""} | ${lead.prime_name} | $${lead.amount} | ${lead.scope_kind} | ${lead.prime_kind} | ${lead.award_id}`,
    );
  }
  process.exit(0);
} catch (err) {
  console.error("[hauling-leads] sync failed:", err);
  process.exit(1);
}
