/**
 * Contrax Grants — STATE SYNC RUNNER (owner ROLLOUT order 2026-09-18, part 1).
 *
 * What one state run does, in order:
 *   1. Resolve the connector through the REGISTRY, not by name — a state that is
 *      not `connected` (no connector, or no passing source-validation test)
 *      CANNOT be synced, and the attempt is recorded as a failed run.
 *   2. fetch() → parse() → classify() → dedupe() — all in memory, no writes.
 *   3. Pre-read the state's existing fingerprints (for inserted vs updated).
 *   4. Commit ONE statement: the changed/new opportunities AND the `ok` run row
 *      together. Unchanged rows are untouched by that statement.
 *   5. Any failure anywhere → the commit statement is NEVER issued, and the run
 *      is recorded as `error` with the counts zeroed and the reason attached.
 *      A failed run therefore writes NOTHING to the opportunity table.
 *
 * So the failure mode is: no partial corpus, ever, and always a visible run row.
 *
 * WHERE A CRON HOOKS IN (not wired in this PR — the owner's rollout order puts
 * the API/coverage work in a separate step, and the repo's scheduled syncs live
 * in GitHub Actions, never in Vercel cron — see .github/workflows/sync-bids.yml):
 * add a `sync-state-grants.yml` workflow on the same pattern, calling
 *   bun run sync:state -- <state>        (one state)
 *   bun run sync:state -- --all-connected (every connected state)
 * with the same `DATABASE_URL` secret the other sync workflows use. The runner
 * below is already the executable that workflow would call, and every connected
 * state is driven by the registry, so adding a state to the workflow needs no
 * change here. Nothing schedules itself in this PR.
 */
import {
  parseGrantOpportunities,
  type GrantOpportunity,
  type StateGrantConnector,
} from "~/lib/state-grants/connector";
import { connectedStates, getConnector, getStateEntry } from "~/lib/state-grants/registry";
import type { StateSyncWrite, StateSyncWriteResult } from "~/lib/state-grants/store.server";

/** The store surface the runner needs, injectable for tests. */
export interface StateGrantSyncStore {
  readFingerprints(stateCode: string): Promise<Map<string, string>>;
  commitStateSync(entry: StateSyncWrite): Promise<StateSyncWriteResult>;
  recordFailedStateSync(opts: {
    stateCode: string;
    startedAt: string;
    finishedAt: string;
    stage: string;
    message: string;
  }): Promise<string>;
}

export interface StateSyncOptions {
  /** Injected for tests; defaults to the real Postgres store. */
  store?: StateGrantSyncStore;
  /** Injected for tests; defaults to the registry's connector for the state. */
  connector?: StateGrantConnector<never> | null;
  /** One clock for the whole run (classification + timestamps). */
  now?: Date;
  /** How long a run may take before it is abandoned (fair-use guard). */
  timeoutMs?: number;
}

export interface StateSyncRunResult {
  stateCode: string;
  status: "ok" | "error";
  runId: string | null;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  /** Rows the database statement itself reported writing. */
  touchedCount: number;
  /** True when the run's own pre-read and the database's answer agree. */
  countsAgree: boolean;
  durationMs: number;
  collisions: string[];
  error: { stage: string; message: string } | null;
}

export const DEFAULT_RUN_TIMEOUT_MS = 90_000;

/**
 * The real store. Imported lazily so the pure runner module can be used (and
 * unit-tested) with an injected fake and no database present at all.
 */
async function defaultStore(): Promise<StateGrantSyncStore> {
  const mod = await import("~/lib/state-grants/store.server");
  return {
    readFingerprints: mod.readFingerprints,
    commitStateSync: mod.commitStateSync,
    recordFailedStateSync: mod.recordFailedStateSync,
  };
}

/** Runs one state's sync and always returns a result — never throws. */
export async function runStateGrantSync(
  stateCodeRaw: string,
  options: StateSyncOptions = {},
): Promise<StateSyncRunResult> {
  const stateCode = (stateCodeRaw ?? "").trim().toUpperCase();
  const now = options.now ?? new Date();
  const startedAt = now.toISOString();
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const store = options.store ?? (await defaultStore());

  const empty = (status: "ok" | "error"): StateSyncRunResult => ({
    stateCode,
    status,
    runId: null,
    fetchedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    touchedCount: 0,
    countsAgree: true,
    durationMs: Date.now() - started,
    collisions: [],
    error: null,
  });

  const fail = async (stage: string, error: unknown): Promise<StateSyncRunResult> => {
    const message = error instanceof Error ? error.message : String(error);
    const result = empty("error");
    result.error = { stage, message };
    result.durationMs = Date.now() - started;
    try {
      result.runId = await store.recordFailedStateSync({
        stateCode,
        startedAt,
        finishedAt: new Date().toISOString(),
        stage,
        message,
      });
    } catch (e) {
      // A failed run whose error row ALSO failed is the loudest possible state:
      // surface it in the message rather than pretending the run was recorded.
      result.error = {
        stage,
        message: `${message} (and recording the failed run itself failed: ${
          e instanceof Error ? e.message : String(e)
        })`,
      };
    }
    return result;
  };

  // 1. The registry gate.
  const connector =
    options.connector !== undefined ? options.connector : getConnector(stateCode);
  if (!connector) {
    const entry = getStateEntry(stateCode);
    return fail(
      "registry",
      new Error(
        entry
          ? `state ${stateCode} is not connected (${entry.reason}) — refusing to sync an unvalidated source`
          : `state ${stateCode} is not a recognised US state code (or has no connector)`,
      ),
    );
  }
  if (connector.stateCode !== stateCode) {
    return fail(
      "registry",
      new Error(
        `connector ${connector.id} handles ${connector.stateCode}, not ${stateCode}`,
      ),
    );
  }

  // 2. Pull and normalise. Anything thrown here aborts with zero writes.
  let opportunities: GrantOpportunity[];
  let collisions: string[];
  try {
    const raw = await connector.fetch(now);
    const parsed = parseGrantOpportunities(connector, raw, now);
    opportunities = parsed.opportunities;
    collisions = parsed.collisions;
  } catch (e) {
    const stage = (e as { stage?: string }).stage === "fetch" ? "fetch" : "parse";
    return fail(stage, e);
  }

  if (Date.now() - started > timeoutMs) {
    return fail("timeout", new Error(`state sync exceeded ${timeoutMs}ms before any write`));
  }

  // 3. Inserted vs updated comes from a pre-read of the stored fingerprints.
  let existing: Map<string, string>;
  try {
    existing = await store.readFingerprints(stateCode);
  } catch (e) {
    return fail("read", e);
  }

  const changed: GrantOpportunity[] = [];
  let unchangedCount = 0;
  for (const opportunity of opportunities) {
    const previous = existing.get(opportunity.externalId);
    if (previous === opportunity.fingerprint) {
      unchangedCount += 1;
      continue;
    }
    changed.push(opportunity);
  }
  const insertedCount = changed.filter((o) => !existing.has(o.externalId)).length;
  const updatedCount = changed.length - insertedCount;

  // 4. One statement: the changed rows AND the ok run row, or neither.
  try {
    const written = await store.commitStateSync({
      stateCode,
      startedAt,
      finishedAt: new Date().toISOString(),
      fetchedCount: opportunities.length,
      insertedCount,
      updatedCount,
      opportunities: changed,
    });
    return {
      stateCode,
      status: "ok",
      runId: written.runId,
      fetchedCount: opportunities.length,
      insertedCount: written.insertedCount,
      updatedCount: written.updatedCount,
      unchangedCount,
      touchedCount: written.touched,
      countsAgree: written.touched === insertedCount + updatedCount,
      durationMs: Date.now() - started,
      collisions,
      error: null,
    };
  } catch (e) {
    return fail("write", e);
  }
}

/** Runs every state the registry reports as connected. */
export async function runAllConnectedStateSyncs(
  options: StateSyncOptions = {},
): Promise<StateSyncRunResult[]> {
  const states = connectedStates();
  const results: StateSyncRunResult[] = [];
  for (const state of states) {
    results.push(await runStateGrantSync(state, options));
  }
  return results;
}
