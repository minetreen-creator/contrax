/**
 * Jarvis Autonomous Upgrade — Phase 5 SCHEDULED WORKER — CLI entrypoint.
 *
 * Headless (no browser, no server) invocation of the scheduled supervised worker
 * so a GitHub Actions scheduled job (or any Bun CLI / cron) can run it safely.
 *
 * Usage:
 *   KIND=four-hour bun run scripts/run-worker.ts
 *   bun run scripts/run-worker.ts daily-am
 *
 * Reads DATABASE_URL from the process env (the same value the bid-sync runner
 * and the site use). Exits non-zero if the run failed, so CI can rely on it.
 */
import { runScheduledWork, WORK_KINDS, type WorkKind } from "~/lib/jarvis/worker";

const arg = (process.argv[2] ?? process.env.KIND ?? "").trim() as WorkKind;
const kind = arg as WorkKind;

if (!WORK_KINDS.includes(kind)) {
  console.error(`Invalid KIND '${arg}'. Expected one of: ${WORK_KINDS.join(", ")}`);
  process.exit(2);
}

(async () => {
  const run = await runScheduledWork(kind, { requestedBy: "gh-actions" });
  console.log(
    `KIND=${kind} run#${run.id} status=${run.status} refused=${run.refused}` +
      `${run.refused ? ` (${run.refusedReason})` : ""}` +
      ` findings=${run.findingsCount} problems=${run.problemsDetected}` +
      ` safe=${run.safeActions.length} enqueued=${run.enqueuedActions}` +
      ` recordsModified=${run.recordsModified}`,
  );
  if (run.status === "failed") {
    for (const e of run.errors) console.error("  err:", e);
    process.exit(1);
  }
  if (run.errors.length) {
    for (const e of run.errors) console.error("  err:", e);
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error("❌ Worker failed:", e);
  process.exit(1);
});
