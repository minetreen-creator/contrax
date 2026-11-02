/**
 * Outreach trim (`bun run outreach-trim`), the last step of the weekday
 * outreach-prepare workflow and its own "Outreach Trim" workflow (owner
 * 2026-11-02: "always keep outreach to less than 100 due to resend daily
 * limits"). Sends nothing.
 *
 *  1. Waiting drafts are checked against today's rules and suppressions.
 *  2. The rest are cut to DAILY_OUTREACH_CAP minus what already went out today.
 */
import { DAILY_OUTREACH_CAP } from "~/lib/outreach";
import { recheckWaitingDrafts, trimDraftsToCap } from "~/lib/outreach.server";
import { sql } from "~/db";

async function main() {
  const dropped = await recheckWaitingDrafts(console.log);
  console.log(`Waiting drafts skipped by today's rules: ${dropped}`);
  const removed = await trimDraftsToCap();
  console.log(`Drafts removed to stay under ${DAILY_OUTREACH_CAP} a day: ${removed}`);
  const rows = (await sql()`
    SELECT kind, COUNT(*)::int AS n FROM outreach_contacts WHERE status = 'draft' GROUP BY kind ORDER BY kind`) as { kind: string; n: number }[];
  const total = rows.reduce((a, r) => a + r.n, 0);
  console.log(`Waiting for approval now: ${total} (${rows.map((r) => `${r.kind} ${r.n}`).join(", ") || "none"})`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Outreach trim crashed:", e);
      process.exit(1);
    });
}
