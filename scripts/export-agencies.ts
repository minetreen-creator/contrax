/**
 * Export Agencies — one-off database export tool
 *
 * Extracts the full list of distinct agencies from the production `bids`
 * table and writes it to `agencies.csv` in the repo root (one agency name
 * per line, with a `agency` header). The homepage's "972 agencies" stat is
 * `COUNT(DISTINCT agency) FROM bids` — this export is the source data for
 * the owner's 1-page PDF listing every agency Contrax monitors.
 *
 * Why a workflow job: the production DATABASE_URL only exists as a GitHub
 * Actions secret (no local DB credentials in the sandbox), so the script
 * runs on the Actions runner via .github/workflows/export-agencies.yml
 * (manual `workflow_dispatch` trigger) and uploads agencies.csv as an
 * artifact. Same DB pattern as src/jobs/runner.ts — plain `neon()` from
 * @neondatabase/serverless, no Vercel/TanStack machinery, so it stays
 * runnable under plain `bun run` in CI.
 *
 * Usage:
 *   DATABASE_URL=<conn> bun run scripts/export-agencies.ts
 *
 * Exit codes:
 *   0 — export succeeded, agencies.csv written
 *   1 — DB connection failed or write failed (fails loudly for CI)
 */
import { neon } from "@neondatabase/serverless";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const sql = neon(DATABASE_URL);

  console.log("🏢 Exporting distinct agencies from bids table...");

  const rows = (await sql`
    SELECT DISTINCT agency
    FROM bids
    WHERE agency IS NOT NULL AND agency <> ''
    ORDER BY agency ASC
  `) as { agency: string }[];

  const agencies = rows.map((r) => r.agency);

  // Repo root = one level up from scripts/ (same pattern as check-routes.mjs),
  // so the CSV lands in the repo root regardless of the caller's cwd.
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const outPath = join(repoRoot, "agencies.csv");
  writeFileSync(outPath, ["agency", ...agencies].join("\n") + "\n", "utf8");

  console.log(`Exported ${agencies.length} agencies to ${outPath}`);
}

main().catch((err) => {
  console.error("💥 Agency export failed:", err);
  process.exit(1);
});
