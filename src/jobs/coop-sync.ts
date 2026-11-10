/**
 * Daily: read Sourcewell's and BuyBoard's open vendor solicitations (src/jobs/sources/coop.ts) into
 * coop_solicitations for /co-op-contracts and Radar. A co-op that cannot be read keeps yesterday's rows.
 *   bun src/jobs/coop-sync.ts
 */
import { fetchCoopSolicitations } from "./sources/coop";
import { ensureCoopTable, replaceCoopSolicitations } from "~/lib/coop-contracts.server";

async function main() {
  await ensureCoopTable();
  const syncedAt = new Date().toISOString();
  const { sourcewell, buyboard, errors } = await fetchCoopSolicitations();
  for (const [coop, rows] of [["sourcewell", sourcewell], ["buyboard", buyboard]] as const) {
    if (!rows) {
      console.warn(`${coop}: not read this run; keeping the stored rows`);
      continue;
    }
    const r = await replaceCoopSolicitations(coop, rows, syncedAt);
    const dated = rows.filter((x) => x.dueAt).length;
    console.log(`${coop}: ${r.stored} stored (${dated} with a due date, ${rows.length - dated} announced), ${r.dropped} no longer listed`);
    for (const x of rows) console.log(`   ${x.number ?? ""} ${x.title} | due ${x.dueAt ?? "not yet"} | trades ${x.trades.join(",") || "-"}`);
  }
  for (const e of errors) console.warn(`  ! ${e}`);
  if (!sourcewell && !buyboard) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
