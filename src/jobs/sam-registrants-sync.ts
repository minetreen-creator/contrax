/**
 * Monthly: load SAM.gov registered small businesses (Sub Finder item 5) from the PUBLIC entity
 * extract file the workflow downloaded (.github/workflows/sam-registrants-sync.yml).
 *   bun src/jobs/sam-registrants-sync.ts /path/SAM_PUBLIC_UTF-8_MONTHLY_V2_YYYYMMDD_....dat
 * Rules live in src/lib/sam-registrants.ts (active, contracts, US, public display, no D&B data,
 * small in a Sub Finder trade). Old rows are dropped only after a full, plausible load.
 */
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { parseSamLine, type SamRegistrant } from "~/lib/sam-registrants";
import { ensureSamRegistrantsTable, pruneSamRegistrants, samRegistrantCount, upsertSamRegistrants } from "~/lib/sam-registrants.server";

const BATCH = 1000;

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: bun src/jobs/sam-registrants-sync.ts <extract .dat file>");
  const m = basename(file).match(/_(\d{8})(?:_|\.)/);
  if (!m) throw new Error(`Can't read the extract date from ${basename(file)}`);
  const extractDate = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
  await ensureSamRegistrantsTable();
  const before = await samRegistrantCount();

  let lines = 0;
  let kept = 0;
  let batch: SamRegistrant[] = [];
  const byTrade = new Map<string, number>();
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    lines++;
    const r = parseSamLine(line);
    if (!r) continue;
    kept++;
    for (const t of r.trades) byTrade.set(t, (byTrade.get(t) ?? 0) + 1);
    batch.push(r);
    if (batch.length >= BATCH) {
      await upsertSamRegistrants(batch, extractDate);
      batch = [];
    }
  }
  await upsertSamRegistrants(batch, extractDate);
  console.log(`SAM extract ${extractDate}: ${lines} lines read, ${kept} small businesses kept`);
  console.log("by trade:", [...byTrade.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", "));

  // Prune only after a plausible load, so a cut-off download never empties the list.
  if (kept < 1000 || (before > 0 && kept < before * 0.5)) {
    console.warn(`Not pruning: kept ${kept} vs ${before} before looks incomplete`);
    process.exitCode = 1;
    return;
  }
  const dropped = await pruneSamRegistrants(extractDate);
  console.log(`dropped ${dropped} no longer in the extract; ${await samRegistrantCount()} stored`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
