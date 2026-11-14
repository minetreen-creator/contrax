/**
 * Managed report data — CLI entrypoint (`bun run managed-report-data`), run by
 * hand from .github/workflows/managed-report-data.yml (owner 2026-11-14). Prints
 * the numbers behind a pipeline report for one trade and state: the federal
 * contracts ending in the window, by agency and by month, the largest ones, the
 * price range and the open bids in that trade. READ-ONLY; writes nothing: the
 * queries live in src/lib/pipeline-report-data.server.ts, shared with the public
 * sample report. The output between the markers is one JSON object.
 */
import { reportData } from "~/lib/pipeline-report-data.server";

async function main() {
  const out = await reportData(process.env.STATE ?? "VA", process.env.TRADE ?? "it-services", Number(process.env.MONTHS) || 12);
  console.log("===MANAGED-REPORT-JSON-START===");
  console.log(JSON.stringify(out));
  console.log("===MANAGED-REPORT-JSON-END===");
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Managed report data crashed:", e);
      process.exit(1);
    });
}
