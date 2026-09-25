/**
 * Contrax — SUBNET SUBCONTRACTING SWEEP (owner directive 2026-09-25,
 * BUILD-PLAN.md §6.2). The ONLY production driver of the subcontracting data layer.
 *
 *   bun run sync-subcontracts                 one sweep: crawl, classify, store
 *   bun run sync-subcontracts -- --dry-run    fetch + classify + report, write NOTHING
 *
 * The schedule lives in .github/workflows/sync-subcontracts.yml (daily, 14:00 UTC) —
 * never in Vercel cron, the same rule the repo's other syncs follow (sync-bids,
 * sync-far). Exit code 1 when the sweep failed, so a scheduled job fails loudly; a
 * failed sweep writes nothing but its `error` run row (fail-closed).
 *
 * HONEST LOG LINE: rows seen / new / updated / unchanged (timestamps refreshed) /
 * closed-hidden / unverified-hidden, the requests actually spent (index pages +
 * detail pages), and how the pager ended the sweep.
 */
import { runSubcontractSync } from "~/lib/subcontracts/sync.server";

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const dryRun = flags.has("--dry-run");

const result = await runSubcontractSync({ dryRun });
const c = result.counts;

if (result.status === "ok") {
  console.log(
    `[subcontracts] ${dryRun ? "dry run (nothing written)" : "ok"} in ${c.durationMs}ms — ` +
      `seen ${c.seen}, new ${c.inserted}, updated ${c.updated}, ` +
      `unchanged ${c.unchanged} (timestamps refreshed), ` +
      `open ${c.open}, closed-hidden ${c.closed}, unverified-hidden ${c.unverified} — ` +
      `requests ${c.requests} (index pages ${c.pagesFetched}, detail pages ${c.detailsFetched}, ` +
      `detail pages skipped ${c.detailsSkipped}), duplicate slugs collapsed ${c.collisions}, ` +
      `pager stop: ${c.stoppedBecause}${result.runId ? ` (run ${result.runId})` : ""}`,
  );
  if (c.unverified > 0) {
    console.log(
      `[subcontracts] note: ${c.unverified} notice(s) are in the unverified bucket — no published closing date, or the source no longer publishes them. They are stored but excluded from the open set.`,
    );
  }
} else {
  console.error(
    `[subcontracts] FAILED at ${result.error?.stage}: ${result.error?.message} ` +
      `(run ${result.runId ?? "unrecorded"}) — zero notice rows written`,
  );
}
process.exit(result.status === "ok" ? 0 : 1);
