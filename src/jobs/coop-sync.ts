/**
 * Daily: read Sourcewell's and BuyBoard's open vendor solicitations (src/jobs/sources/coop.ts) into
 * coop_solicitations for /co-op-contracts and Radar. A co-op that cannot be read keeps yesterday's rows.
 *   bun src/jobs/coop-sync.ts
 */
import { fetchCoopSolicitations } from "./sources/coop";
import { ensureCoopTable, openCoopSolicitations, replaceCoopSolicitations } from "~/lib/coop-contracts.server";
import { activeCoopAlerts, markCoopAlertNotified } from "~/lib/coop-alerts.server";
import { coopAlertEmail, newForAlert } from "~/lib/coop-alerts";
import { sendBasicEmail } from "~/lib/email";

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

  // "Tell me when my trade opens" (owner 2026-11-13): one email only when a new category for the
  // subscriber's trade opens, never a daily email. A failed send is retried on the next run.
  try {
    const open = await openCoopSolicitations(null);
    let sent = 0;
    for (const a of await activeCoopAlerts()) {
      const fresh = newForAlert(a.trade, open, a.notified_keys);
      if (!fresh.length) continue;
      const m = coopAlertEmail(a.trade, fresh, a.token);
      if (await sendBasicEmail({ to: a.email, ...m })) {
        await markCoopAlertNotified(a.id, fresh.map((f) => f.key));
        sent++;
      }
    }
    console.log(`co-op trade alerts: ${sent} sent`);
  } catch (e) {
    console.warn(`  ! co-op trade alerts: ${(e as Error).message}`);
  }
  if (!sourcewell && !buyboard) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
