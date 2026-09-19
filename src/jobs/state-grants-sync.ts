/**
 * State Grants sync job (owner ROLLOUT order 2026-09-18, part 1).
 *
 *   bun run sync:state -- va                  one state (registry-gated)
 *   bun run sync:state -- --all-connected     every connected state
 *   bun run sync:state -- --registry          mirror the registry table only
 *   bun run sync:state -- va --dry-run        fetch+parse+classify, WRITE NOTHING
 *
 * A schedule is deliberately NOT wired here: the repo's scheduled syncs run in
 * GitHub Actions on a 4-hour pattern (see .github/workflows/), never in Vercel
 * cron, and part 2 of the rollout owns the API/coverage work. When a schedule is
 * added it calls this same entry point — `--all-connected` picks up a newly
 * connected state with no change to the workflow.
 *
 * Exit code is 1 when any state run failed, so a scheduled job fails loudly.
 */
import { parseGrantOpportunities } from "~/lib/state-grants/connector";
import {
  coverageCounts,
  connectedStates,
  getConnector,
  getStateEntry,
  listStates,
} from "~/lib/state-grants/registry";

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
      `connected states: ${connectedStates().join(", ") || "(none)"}`,
    ].join("\n"),
  );
  process.exit(2);
}

if (wantsAll && positional.length > 0) usage();
if (!wantsAll && !wantsRegistry && positional.length === 0) usage();

async function main(): Promise<number> {
  const { syncStateRegistry } = await import("~/lib/state-grants/store.server");
  const { runAllConnectedStateSyncs, runStateGrantSync } = await import(
    "~/lib/state-grants/sync.server"
  );

  if (wantsRegistry) {
    const written = await syncStateRegistry(listStates());
    const coverage = coverageCounts();
    console.log(
      `registry mirrored: ${written} row(s) changed; coverage ${coverage.connected}/${coverage.total} connected (${coverage.unavailable} unavailable)`,
    );
    return 0;
  }

  // Dry run: read the source, classify, report — and touch no database at all.
  if (dryRun) {
    const states = wantsAll ? connectedStates() : positional.map((s) => s.toUpperCase());
    let failed = false;
    for (const state of states) {
      const connector = getConnector(state);
      const entry = getStateEntry(state);
      if (!connector) {
        console.error(`[${state}] not connected: ${entry?.reason ?? "no such state"}`);
        failed = true;
        continue;
      }
      const raw = await connector.fetch(new Date());
      const { opportunities, collisions } = parseGrantOpportunities(connector, raw, new Date());
      const byStatus = { open: 0, forecast: 0, closed: 0 } as Record<string, number>;
      for (const o of opportunities) byStatus[o.status] += 1;
      console.log(
        `[${state}] dry run: ${opportunities.length} parsed (open ${byStatus.open} / forecast ${byStatus.forecast} / closed ${byStatus.closed}), 0 written`,
      );
      if (collisions.length > 0) console.warn(`[${state}] external-id collisions: ${collisions.join(", ")}`);
      for (const o of opportunities) {
        console.log(
          `  ${o.status.padEnd(8)} ${o.externalId.padEnd(40)} ${o.closeDate ?? o.estimatedCloseDate ?? "-"} ${o.title}`,
        );
      }
    }
    return failed ? 1 : 0;
  }

  const results = wantsAll
    ? await runAllConnectedStateSyncs()
    : [await runStateGrantSync(positional[0])];

  let failed = false;
  for (const r of results) {
    if (r.status === "ok") {
      console.log(
        `[${r.stateCode}] ok in ${r.durationMs}ms — fetched ${r.fetchedCount}, inserted ${r.insertedCount}, updated ${r.updatedCount}, unchanged ${r.unchangedCount} (run ${r.runId})`,
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
