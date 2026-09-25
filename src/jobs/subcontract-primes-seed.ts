/**
 * Contrax — SUBCONTRACTING preview: the FY24 PRIME-DIRECTORY SEED job
 * (owner directive 2026-09-25, BUILD-PLAN §6.1 S2 / §6.2).
 *
 *   bun run seed-subcontract-primes --file <path/to/fy24.xlsx>
 *   bun run seed-subcontract-primes --file <…> --dry-run     map + report, write NOTHING
 *
 * ANNUAL, HAND-RUN, OPERATOR-LOADED — never scheduled. The SBA publishes one XLSX per
 * fiscal year under a `/sites/default/files/*` path that legacy.sba.gov/robots.txt
 * disallows, so the file is saved by hand and loaded by hand (BUILD-PLAN §6.1 S2). There
 * is deliberately NO default path in the library: the job says what to pass, and exits 1
 * rather than importing nothing.
 *
 * INPUT: the annual SBA "Directory of Federal Government Prime Contractors with
 * Subcontracting Plans" for FY24 (Sheet1, 18,940 award rows × 18 columns). Output: one
 * `subcontract_primes` row per company (UEI), idempotent on re-run.
 *
 * HONEST LOG LINE: rows read, rows skipped (no UEI / no name), companies, awards collapsed,
 * inserts vs updates actually written, and the plan-type split read back FROM THE TABLE.
 */
import { PrimeSeedError, seedSubcontractPrimes } from "~/lib/subcontracts/prime-seed.server";
import { PrimeDirectoryError } from "~/lib/subcontracts/prime-directory";
import { XlsxReadError } from "~/lib/subcontracts/xlsx";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const fileFlagIndex = args.indexOf("--file");
const file = fileFlagIndex >= 0 ? args[fileFlagIndex + 1] : process.env.SUBCONTRACT_PRIMES_FILE;
const dryRun = flags.has("--dry-run");
if (fileFlagIndex >= 0 && !file) {
  console.error("[primes-seed] --file needs a path");
  process.exit(1);
}

try {
  const result = await seedSubcontractPrimes({ file, dryRun });
  const c = result.aggregation;
  console.log(
    `[primes-seed] ${dryRun ? "dry run (nothing written)" : "ok"} in ${result.durationMs}ms — ` +
      `${result.awards} award rows read (skipped: ${result.rowAccounting.rowsWithoutUei} without a UEI, ` +
      `${result.rowAccounting.rowsWithoutName} without a name, ${result.rowAccounting.rowsWithOddUeiShape} with an odd UEI shape) ` +
      `→ ${result.companies} companies · awards collapsed ${c.awardsRead} · ${result.fy} · ` +
      `source ${result.sourceKey}${result.sourceId ? ` (${result.sourceId})` : ""}`,
  );
  console.log(
    `[primes-seed] distinct: legal names ${c.distinctLegalNames}, NAICS ${c.distinctNaics}, ` +
      `agencies ${c.distinctAgencies}, vendor states ${c.distinctVendorStates}, PoP states ${c.distinctPopStates} — ` +
      `companies with name variants ${c.companiesWithNameVariants}, multi-HQ-state ${c.companiesWithMultipleVendorStates}, ` +
      `no HQ state ${c.companiesWithoutVendorState}, ambiguous ultimate parent ${c.companiesWithAmbiguousParent}, ` +
      `mixed plan ${c.companiesWithMixedPlan}`,
  );
  console.log(
    `[primes-seed] plan split (company grain): ${JSON.stringify(c.planTypeCounts)} — ` +
      `${c.awardsWithoutValue} award rows published no value, ${c.awardsWithoutPopStart} no PoP start`,
  );
  if (!dryRun) {
    console.log(
      `[primes-seed] stored: inserted ${result.inserted}, updated ${result.updated} (rows touched ${result.touched}); ` +
        `plan split read back from subcontract_primes: ${JSON.stringify(result.storedPlanTypes)}`,
    );
  }
  process.exit(0);
} catch (e) {
  const known =
    e instanceof PrimeSeedError || e instanceof PrimeDirectoryError || e instanceof XlsxReadError;
  console.error(
    `[primes-seed] FAILED${known ? "" : " (unexpected)"} — ${e instanceof Error ? e.message : String(e)}`,
  );
  if (!known && e instanceof Error && e.stack) console.error(e.stack.split("\n").slice(1, 4).join("\n"));
  process.exit(1);
}
