/**
 * Contrax Grants — `bun run sync:state` (owner ROLLOUT order 2026-09-18).
 *
 *   bun run sync:state -- va                    sync one state (registry-gated)
 *   bun run sync:state -- --all-connected       every state with a validated source
 *   bun run sync:state -- --registry            mirror registry + sources tables
 *   bun run sync:state -- va --dry-run          fetch + classify, write NOTHING
 *
 * A state is synced only when the registry reports a VALIDATED source for it
 * (limited | curated | connected). `unavailable` states are refused, and the
 * refusal is recorded as a failed run — that is the fail-closed gate, not a bug.
 *
 * The schedule is NOT wired here: the repo's scheduled syncs live in GitHub
 * Actions on a 4-hour pattern (see .github/workflows/sync-bids.yml), never in
 * Vercel cron, and part 2 of the rollout owns the API/coverage work. When a
 * schedule is added it calls this same entry point — `--all-connected` picks up a
 * newly covered state with no change to the workflow.
 *
 * Exit code is 1 when any state run failed, so a scheduled job fails loudly.
 */
import {
  STATE_GRANT_STATUSES,
  parseGrantOpportunities,
  type StateGrantStatus,
} from "~/lib/state-grants/connector";
import {
  coverageCounts,
  getConnector,
  getStateEntry,
  listStates,
  validatedStates,
} from "~/lib/state-grants/registry";
import { listStateSources } from "~/lib/state-grants/sources";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const wantsRegistry = flags.has("--registry");
const wantsAll = flags.has("--all-connected");
const dryRun = flags.has("--dry-run");

function usage(): never {
  console.error(
    [
      "usage: bun run sync:state -- <state-code> [--dry-run]",
      "       bun run sync:state -- --all-connected [--dry-run]",
      "       bun run sync:state -- --registry",
      "",
      `states with a validated source: ${validatedStates().join(", ") || "(none)"}`,
    ].join("\n"),
  );
  process.exit(2);
}

if (wantsAll && positional.length > 0) usage();
if (!wantsAll && !wantsRegistry && positional.length === 0) usage();

async function main(): Promise<number> {
  const { syncStateRegistry, syncStateSources } = await import("~/lib/state-grants/store.server");
  const { runAllValidatedStateSyncs, runStateGrantSync } = await import(
    "~/lib/state-grants/sync.server"
  );

  if (wantsRegistry) {
    const sourcesCreated = await syncStateSources(listStateSources());
    const written = await syncStateRegistry(listStates());
    const coverage = coverageCounts();
    console.log(
      `registry mirrored: ${written} row(s) changed; sources mirrored: ${sourcesCreated} row(s) created; ` +
        `coverage ${coverage.validated}/${coverage.total} validated ` +
        `(${coverage.connected} connected, ${coverage.curated} curated, ${coverage.limited} limited, ` +
        `${coverage.unavailable} unavailable)`,
    );
    return 0;
  }

  // Dry run: read the source, classify, report — and touch no database at all.
  if (dryRun) {
    const states = wantsAll ? validatedStates() : positional.map((s) => s.toUpperCase());
    let failed = false;
    for (const state of states) {
      const connector = getConnector(state);
      const entry = getStateEntry(state);
      if (!connector) {
        console.error(`[${state}] no validated source: ${entry?.reason ?? "no such state"}`);
        failed = true;
        continue;
      }
      const raw = await connector.fetch(new Date());
      const { opportunities, collisions } = parseGrantOpportunities(connector, raw, new Date());
      const byStatus = Object.fromEntries(
        STATE_GRANT_STATUSES.map((s) => [s, 0]),
      ) as Record<StateGrantStatus, number>;
      for (const o of opportunities) byStatus[o.status] += 1;
      const counts = STATE_GRANT_STATUSES.map((s) => `${s} ${byStatus[s]}`).join(" / ");
      console.log(
        `[${state}] dry run: ${opportunities.length} parsed (${counts}), 0 written`,
      );
      if (collisions.length > 0) console.warn(`[${state}] external-id collisions: ${collisions.join(", ")}`);
      for (const o of opportunities) {
        console.log(
          `  ${o.status.padEnd(10)} ${o.externalId.padEnd(40)} ${o.closeDate ?? o.estimatedCloseDate ?? "-"} ${o.title}`,
        );
      }
    }
    return failed ? 1 : 0;
  }

  const results = wantsAll
    ? await runAllValidatedStateSyncs()
    : [await runStateGrantSync(positional[0])];
  let failed = false;
  for (const r of results) {
    if (r.status === "ok") {
      console.log(
        `[${r.stateCode}] ok in ${r.durationMs}ms — fetched ${r.fetchedCount}, inserted ${r.insertedCount}, ` +
          `updated ${r.updatedCount}, unchanged ${r.unchangedCount} (last_seen refreshed ${r.refreshedCount}), ` +
          `stale→unverified ${r.staledCount} (run ${r.runId})`,
      );
      if (!r.countsAgree) {
        console.warn(
          `[${r.stateCode}] WARNING: the database reported ${r.touchedCount} written rows but the pre-read expected ${r.insertedCount + r.updatedCount}`,
        );
      }
    } else {
      failed = true;
      console.error(
        `[${r.stateCode}] FAILED at ${r.error?.stage}: ${r.error?.message} (run ${r.runId ?? "unrecorded"}) — zero rows written`,
      );
    }
  }
  return failed ? 1 : 0;
}

process.exit(await main());
