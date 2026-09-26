/**
 * Contrax — GSA PRIME-DIRECTORY SYNC (owner-approved expansion 2026-09-26).
 *
 *   bun run sync-gsa-primes                 one check: resolve, conditional GET, store
 *   bun run sync-gsa-primes -- --dry-run    fetch + parse + report, write NOTHING
 *
 * Schedule: .github/workflows/sync-gsa-primes.yml — WEEKLY, its own job (the daily SUBNet
 * sweep is untouched). The source is an ANNUAL file, so the run is usually two requests
 * and a 304; weekly is enough to catch a new annual file within a week without implying
 * a daily update the source does not publish.
 *
 * FAIL-CLOSED: exit 1 on any failure, and the run is recorded as `error` in
 * `subcontract_sync_runs` so the page's "last checked by Contrax" line stays truthful. A
 * failed run writes NO directory row at all — the previously stored rows keep being served.
 *
 * HONEST LOG LINE: rows seen / inserted / updated / unchanged, rows that vanished from the
 * latest file (counted, never deleted), rows whose NAICS cell is not a valid code (kept,
 * counted, and stored verbatim in `naics_raw`), the rows whose state reads "Non-US"
 * (counted distinctly, kept verbatim in `vendor_state`), the source's own file name + file
 * date, the Last-Modified, the content sha256, which resolution path found the CSV, and the
 * requests spent.
 */
import { runGsaPrimesSync } from "~/lib/subcontracts/gsa-sync.server";

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const dryRun = flags.has("--dry-run");

const result = await runGsaPrimesSync({ dryRun });
const c = result.counts;

if (result.status === "ok") {
  console.log(
    `[gsa-primes] ${dryRun ? "dry run (nothing written)" : "ok"} in ${c.durationMs}ms — ` +
      `file ${c.fileName ?? "(unknown)"} · file date ${c.fileDate ?? "(not stated in the URL)"} · ` +
      `last-modified ${c.lastModified ?? "(none)"} · sha256 ${c.contentSha256?.slice(0, 16) ?? "(none)"} · ` +
      `resolved via ${c.pathResolvedFrom || "(none)"} · requests ${c.requests}`,
  );
  if (c.notModified) {
    console.log(
      `[gsa-primes] the source reported no new file (304, or bytes identical to the stored sha256) — ` +
        `0 rows written; ${c.storedRows} row(s) still stored and served unchanged`,
    );
  } else {
    console.log(
      `[gsa-primes] rows seen ${c.rowsSeen} — inserted ${c.inserted}, updated ${c.updated}, ` +
        `unchanged ${c.unchanged}, missing from the latest file ${c.missingFromLatestFile} (counted, never deleted)`,
    );
    console.log(
      `[gsa-primes] rows without a valid 6-digit NAICS code: ${c.nonNaicsDropped} (the code is dropped, ` +
        `the company is kept and listed, and the raw value is stored in naics_raw — see the section's honesty line) · ` +
        `rows with a valid NAICS ${c.validNaicsRows} · ` +
        `rows whose state reads "Non-US" ${c.nonUsRows} (kept verbatim, counted here, never mapped to a state) · ` +
        `rows stored for this source ${c.storedRows}`,
    );
  }
  if (result.runId) console.log(`[gsa-primes] run row ${result.runId}`);
} else {
  console.error(
    `[gsa-primes] FAILED at ${result.error?.stage}: ${result.error?.message} ` +
      `(run ${result.runId ?? "unrecorded"}) — zero directory rows written`,
  );
  if (result.error?.stage === "fetch") {
    console.error(
      "[gsa-primes] note: the previously stored GSA rows (if any) keep being served; nothing was deleted or emptied.",
    );
  }
}

if (result.status !== "ok" && result.error?.message) {
  // The message above is the whole story; this line keeps the log greppable.
  console.error("[gsa-primes] see the run row in subcontract_sync_runs for the recorded failure.");
}

process.exit(result.status === "ok" ? 0 : 1);
