/**
 * Jarvis Autonomous Upgrade — Phase 6 BRAIN + OWNER CONTROLS (read model + the
 * TWO explicit mutations the owner is allowed to make).
 *
 * Owner directive (ratified business plan rev 133): an OWNER-FACING "brain" app
 * at /jarvis/brain plus an authorization / owner-controls UI — review + approve
 * the L4 `jarvis_actions` queue, and steer the scheduled worker (available /
 * away / do_not_disturb + kill switch).
 *
 * This module is PURELY ADDITIVE over Phases 1–5:
 *   • It READS every ledger created by migrations 023–025 through fresh SELECTs
 *     and reuses the typed store (src/lib/jarvis/store.ts) / autonomy
 *     (autonomy.ts) / worker (worker.ts) helpers wherever they already expose
 *     what we need (listRuns, listProblems, listApprovedDecisions,
 *     listLiveMemory, getOwnerStatus / getOwnerMode, listPendingActions,
 *     resolveAction). A handful of list-all readers that the store does not yet
 *     expose (all hypotheses / experiments / feedback / outcomes / actions by
 *     status) live here — still plain reads, no behavior touched elsewhere.
 *   • The ONLY writes are the two owner-gated mutations the brief calls for:
 *       (1) resolveQueueAction  → approve / deny a pending jarvis_actions row
 *           (wraps autonomy.resolveAction — approved rows are never hard-deleted)
 *       (2) setOwnerMode        → owner flips availability / kill_switch
 *   Nothing else writes. No existing file's behavior is altered.
 *
 * Honesty & security:
 *   • Every value rendered comes from a real SQL query over existing ledgers —
 *     nothing is fabricated. Hypothesis/experiment lists, counts, and severities
 *     are the actual rows.
 *   • All DB text is UNTRUSTED. This module only ever returns data (never
 *     evaluates it, never sends it to a model). The UI layer escapes on render.
 *   • Min-sample honesty (Phase 3) is honored by the problem rows themselves
 *     (a tiny-sample problem was already gated to INFO by the analyzer); this
 *     module surfaces each problem's own severity/confidence/evidence from the
 *     ledger and never inflates it. The severity guard (CRITICAL reserved for
 *     prod/db-sync/payment/security/data-integrity) is likewise already enforced
 *     at write time by Phase 3 — the brain displays the stored severity verbatim.
 */
import { sql } from "~/db";
import {
  listLiveMemory,
  listAllMemory,
  listProblems,
  listApprovedDecisions,
  getOwnerStatus,
  type JarvisMemory,
  type JarvisDecision,
  type JarvisProblem,
  type JarvisHypothesis,
  type JarvisExperiment,
  type JarvisFeedback,
  type JarvisOutcome,
  type OwnerAvailability,
} from "~/lib/jarvis/store";
import {
  listActionsByStatus,
  listPendingActions,
  resolveAction,
  type JarvisActionRow,
  type ResolveOutcome,
} from "~/lib/jarvis/autonomy";
import { getOwnerMode, resolveWorkerPolicy, type OwnerMode } from "~/lib/jarvis/worker";

type NeonQuery = ReturnType<typeof sql>;
const nowIso = () => new Date().toISOString();

/* ═════════════════════════════════════════════════════════════════════
 * Row shapes (mirror the ledger columns we surface — all additive reads)
 * ═════════════════════════════════════════════════════════════════════ */
interface RunRow {
  id: number;
  run_type: string;
  started_at: string;
  completed_at: string | null;
  status: "running" | "completed" | "failed";
  findings_count: number;
  problems_detected: number;
  recommendations_created: number;
  safe_actions_taken: number;
  errors: unknown[];
  trigger_kind: string | null;
  refused: boolean;
  refused_reason: string | null;
  note: string | null;
  hypotheses: number;
  records_modified: number;
  safe_actions: string[];
}

interface ActionLite {
  id: number;
  action_type: string;
  resource: string | null;
  authority_level: string;
  status: string;
  requested_by: string | null;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  reason: string | null;
  owner_approved: boolean;
}

/* ═════════════════════════════════════════════════════════════════════
 * Brain snapshot — the shape returned by GET /api/admin/jarvis/brain.
 * ═════════════════════════════════════════════════════════════════════ */
export interface BrainSnapshot {
  owner: { availability: OwnerAvailability; killSwitch: boolean; updatedAt: string };
  ownerModeNote: string;
  /** worker-run consequence given the current owner mode. */
  health: {
    totalRuns: number;
    lastRun: RunRow | null;
    recentRuns: RunRow[];
    refusedRuns: number;
    failedRuns: number;
  };
  problems: JarvisProblem[]; // all problems, newest first (severity surfaced verbatim)
  openProblems: JarvisProblem[]; // status open/investigating, severity desc + confidence desc
  detectedWhileAway: { problems: JarvisProblem[]; hypotheses: JarvisHypothesis[]; actions: ActionLite[]; runs: RunRow[] };
  hypotheses: JarvisHypothesis[]; // all, newest first
  openHypotheses: JarvisHypothesis[]; // proposed/testing/active
  experiments: JarvisExperiment[]; // all, newest first
  feedback: JarvisFeedback[]; // all, newest first
  outcomes: JarvisOutcome[]; // all, newest first
  learned: JarvisMemory[]; // approved, live facts
  disproven: JarvisMemory[]; // approved-but-superseded (retired) facts
  candidates: JarvisMemory[]; // NOT owner-approved memory (known unknowns / unaffirmed)
  decisions: JarvisDecision[]; // approved, currently-effective decisions
  candidateDecisions: JarvisDecision[]; // not-yet-approved decisions
  runs: RunRow[]; // recent runs (latest 12)
  actions: {
    pending: ActionLite[];
    approved: ActionLite[];
    denied: ActionLite[];
    executed: ActionLite[];
    failed: ActionLite[];
  };
  counts: {
    memory: number;
    decisions: number;
    problems: number;
    hypotheses: number;
    experiments: number;
    outcomes: number;
    actions: number;
    runs: number;
  };
}

const actionToLite = (a: JarvisActionRow): ActionLite => ({
  id: a.id,
  action_type: a.action_type,
  resource: a.resource,
  authority_level: a.authority_level,
  status: a.status,
  requested_by: a.requested_by,
  requested_at: a.requested_at,
  decided_at: a.decided_at,
  decided_by: a.decided_by,
  reason: a.reason,
  owner_approved: a.owner_approved,
});

/* READ helpers the store does not yet expose (all plain reads). */
async function listAllHypotheses(db: NeonQuery): Promise<JarvisHypothesis[]> {
  return (await db`SELECT * FROM jarvis_hypotheses ORDER BY created_at DESC`) as JarvisHypothesis[];
}
async function listAllExperiments(db: NeonQuery): Promise<JarvisExperiment[]> {
  return (await db`SELECT * FROM jarvis_experiments ORDER BY created_at DESC`) as JarvisExperiment[];
}
async function listAllFeedback(db: NeonQuery): Promise<JarvisFeedback[]> {
  return (await db`SELECT * FROM jarvis_feedback ORDER BY created_at DESC`) as JarvisFeedback[];
}
async function listAllOutcomes(db: NeonQuery): Promise<JarvisOutcome[]> {
  return (await db`SELECT * FROM jarvis_outcomes ORDER BY created_at DESC`) as JarvisOutcome[];
}
async function listRunsRecent(db: NeonQuery, limit = 12): Promise<RunRow[]> {
  return (await db`
    SELECT * FROM jarvis_runs ORDER BY started_at DESC LIMIT ${limit}
  `) as RunRow[];
}
async function countRuns(db: NeonQuery): Promise<number> {
  const rows = (await db`SELECT COUNT(*) AS n FROM jarvis_runs`) as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

/**
 * Load the full brain snapshot. READ-ONLY — performs only SELECTs over the
 * Phase 1–5 ledgers + the single owner_status row.
 */
export async function loadBrainSnapshot(db: NeonQuery): Promise<BrainSnapshot> {
  const [
    owner,
    totalRuns,
    runs,
    problems,
    hypotheses,
    experiments,
    feedback,
    outcomes,
    memory,
    decisions,
    candidateDecisions,
    pendingA,
    approvedA,
    deniedA,
    executedA,
    failedA,
  ] = await Promise.all([
    getOwnerStatus(db),
    countRuns(db),
    listRunsRecent(db, 12),
    listProblems(db),
    listAllHypotheses(db),
    listAllExperiments(db),
    listAllFeedback(db),
    listAllOutcomes(db),
    listAllMemory(db),
    listApprovedDecisions(db),
    db`SELECT * FROM jarvis_decisions WHERE owner_approved = FALSE ORDER BY created_at DESC`.then(
      (rows) => rows as JarvisDecision[],
    ),
    listPendingActions(db),
    listActionsByStatus(db, "approved"),
    listActionsByStatus(db, "denied"),
    listActionsByStatus(db, "executed"),
    listActionsByStatus(db, "failed"),
  ]);

  const ownerMode: OwnerMode = { availability: owner.availability, killSwitch: owner.kill_switch };
  const policy = resolveWorkerPolicy(ownerMode);
  const ownerModeNote = policy.run
    ? "Availability 'available' — the scheduled worker is running its full supervised cycle."
    : policy.refusalDetail ?? "Scheduled worker work is refused (no side effects).";

  // Detected-While-Away: only meaningful when the owner is currently away/dnd.
  // Honest + auditable from real data: the ledgers don't keep an owner_status
  // history, so we compare each arriving row's timestamp to owner_status.updated_at
  // — rows created while the owner was (and still is) non-'available' are shown.
  const away = owner.availability !== "available";
  const sinceIso = new Date(new Date(owner.updated_at).getTime() - 5).toISOString();
  const arrivedWhileAway = (ts: string) => away && ts >= sinceIso;
  const detectedWhileAway = {
    problems: problems.filter((p) => arrivedWhileAway(p.detected_at)),
    hypotheses: hypotheses.filter((h) => arrivedWhileAway(h.created_at)),
    actions: pendingA.filter((a) => arrivedWhileAway(a.requested_at)).map(actionToLite),
    runs: runs.filter((r) => arrivedWhileAway(r.started_at)),
  };

  const openProblemsRaw = problems.filter((p) => p.status === "open" || p.status === "investigating");
  const openHypotheses = hypotheses.filter((h) => ["proposed", "testing", "active"].includes(h.status));
  const learned = await listLiveMemory(db);
  const disproven = memory.filter((m) => m.owner_approved && m.superseded_by !== null);
  const candidates = memory.filter((m) => !m.owner_approved);

  const severityRank: Record<string, number> = { INFO: 0, WATCH: 1, IMPORTANT: 2, CRITICAL: 3 };
  const openSorted = [...openProblemsRaw].sort(
    (a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0) || b.confidence - a.confidence,
  );

  return {
    owner: { availability: owner.availability, killSwitch: owner.kill_switch, updatedAt: owner.updated_at },
    ownerModeNote,
    health: {
      totalRuns,
      lastRun: runs[0] ?? null,
      recentRuns: runs,
      refusedRuns: runs.filter((r) => r.refused).length,
      failedRuns: runs.filter((r) => r.status === "failed").length,
    },
    problems,
    openProblems: openSorted,
    detectedWhileAway,
    hypotheses,
    openHypotheses,
    experiments,
    feedback,
    outcomes,
    learned,
    disproven,
    candidates,
    decisions,
    candidateDecisions,
    runs,
    actions: {
      pending: pendingA.map(actionToLite),
      approved: approvedA.map(actionToLite),
      denied: deniedA.map(actionToLite),
      executed: executedA.map(actionToLite),
      failed: failedA.map(actionToLite),
    },
    counts: {
      memory: memory.length,
      decisions: decisions.length,
      problems: problems.length,
      hypotheses: hypotheses.length,
      experiments: experiments.length,
      outcomes: outcomes.length,
      actions: pendingA.length + approvedA.length + deniedA.length + executedA.length + failedA.length,
      runs: totalRuns,
    },
  };
}

/**
 * OWNER-GATED MUTATION #1 — approve / deny a pending jarvis_actions row.
 * Delegates to autonomy.resolveAction (status → approved | denied,
 * owner_approved set true only on approve). Approved/owner-approved rows are
 * NEVER hard-deleted (Phase 1/4 semantics preserved). Only a 'pending' row may
 * be resolved. Returns the updated row, or null when it wasn't found/not pending.
 */
export async function resolveQueueAction(
  db: NeonQuery,
  id: number,
  decidedBy: string,
  outcome: ResolveOutcome,
  reason?: string,
): Promise<JarvisActionRow | null> {
  const existing = (await db`SELECT status FROM jarvis_actions WHERE id = ${id}`)[0] as
    | { status: string }
    | undefined;
  if (!existing) return null;
  if (existing.status !== "pending") {
    throw new Error(`action #${id} is not pending (status=${existing.status}) — only pending actions can be approved or denied`);
  }
  return resolveAction(db, id, decidedBy, outcome, reason);
}

/**
 * OWNER-GATED MUTATION #2 — set the owner's availability / kill switch.
 * Wraps the worker's getOwnerMode + a single-row UPDATE on owner_status
 * (migration 023 + 025 columns). Persists whatever fields are provided and
 * returns the new OwnerMode.
 */
export async function setOwnerMode(
  db: NeonQuery,
  patch: { availability?: OwnerAvailability; killSwitch?: boolean },
): Promise<OwnerMode> {
  const current = await getOwnerMode(db);
  const availability = patch.availability ?? current.availability;
  const killSwitch = patch.killSwitch ?? current.killSwitch;
  if (availability === current.availability && killSwitch === current.killSwitch) {
    return { availability, killSwitch };
  }
  await db`
    UPDATE owner_status
    SET availability = ${availability}, kill_switch = ${killSwitch}, updated_at = ${nowIso()}
    WHERE id = 1
  `;
  return { availability, killSwitch };
}
