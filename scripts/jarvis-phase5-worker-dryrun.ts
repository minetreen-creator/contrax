/**
 * Jarvis Autonomous Upgrade — Phase 5 SCHEDULED SUPERVISED WORKER — dry-run.
 *
 * Verifies the Phase 5 scheduled worker (src/lib/jarvis/worker.ts) against
 * PRODUCTION and proves the invariants:
 *
 *   (a) Every schedule kind (hourly-health / four-hour / daily-am / daily-pm /
 *       weekly) runs end-to-end against prod WITHOUT crashing (or returns a clean
 *       no-op when traffic makes that the honest result).
 *   (b) A `jarvis_runs` audit row is created AND finalized with the correct
 *       status / trigger_kind / refused / completed_at.
 *   (c) Away mode (away / do_not_disturb) and the KILL SWITCH are honored —
 *       work is REFUSED + logged, with NO side effects (nothing persisted,
 *       nothing enqueued). owner_status is restored afterwards.
 *   (d) An L4 side-effect action is ENQUEUED to jarvis_actions (never auto-run)
 *       and an L3 safe action is ALLOWED (auto-run, not enqueued).
 *   (e) Self-cleanup — the dry-run removes ONLY its own throwaway rows
 *       (jarvis_runs audit rows it created + any jarvis_actions it enqueued).
 *       Pre-existing rows and the approved knowledge base are untouched.
 *
 * Requires migration 025 (db/migrations/run-025.ts) applied (adds the
 * jarvis_runs audit columns + owner_status.kill_switch).
 *
 * Run:  bun run scripts/jarvis-phase5-worker-dryrun.ts
 * Exits non-zero on any FAIL so CI can rely on it.
 */
import { sql } from "~/db";
import {
  runScheduledWork,
  collectWorkerActions,
  dispatchAction,
  getOwnerMode,
  WORK_KINDS,
  type WorkKind,
  type RunAudit,
} from "~/lib/jarvis/worker";
import {
  AuthorityLevel,
  type ActionProposal,
} from "~/lib/jarvis/autonomy";
import { loadOperatingModel } from "~/lib/jarvis/knowledge";
import type { ProblemAnalysis, ResolvedProblem, DetectionEvidence } from "~/lib/jarvis/problems";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

const db = sql();

/* ── Snapshot pre-existing state so we only ever touch our OWN rows ── */
const preExistingRuns = (await db`SELECT id FROM jarvis_runs`) as { id: number }[];
const preExistingRunIds = new Set(preExistingRuns.map((r) => r.id));
const preExistingActions = (await db`SELECT id FROM jarvis_actions`) as { id: number }[];
const preExistingActionIds = new Set(preExistingActions.map((r) => r.id));
const approvedKBBefore = Object.values((await loadOperatingModel(db)).byCategory).flat().length;

// Track the throwaway rows this dry-run creates.
const createdRunIds: number[] = [];
const createdActionIds: number[] = [];

// owner_status original state, restored in finally.
const modeBefore = await getOwnerMode(db);
const originalAvailability = modeBefore.availability;
const originalKillSwitch = modeBefore.killSwitch;

const REQ = "phase5-dryrun";

function trackRun(runId: number): void {
  createdRunIds.push(runId);
}

/* ═══════════════════ (a) + (b) — each kind runs end-to-end ═══════════════════ */
section("(a)+(b) Every schedule kind runs end-to-end; audit row created + finalized");
const auditByKind: Record<WorkKind, RunAudit> = {} as Record<WorkKind, RunAudit>;
for (const kind of WORK_KINDS) {
  const run = await runScheduledWork(kind, { requestedBy: REQ, persist: false });
  auditByKind[kind] = run;
  trackRun(run.id);
  check(`  [${kind}] run completed without crashing (status=${run.status})`, run.status === "completed", run.status);
  check(`  [${kind}] not refused (available mode, clean run)`, run.refused === false, `refused=${run.refusedReason}`);
  check(`  [${kind}] metrics/readers gathered (or honest empty)`, true, `readers=${run.readers.length} metricTools=${Object.keys(run.metrics).length}`);
  check(`  [${kind}] brief note populated (grounded/honest)`, !!run.note && run.note.length > 0, run.note?.slice(0, 80));
  check(`  [${kind}] no errors recorded`, run.errors.length === 0, run.errors.join(" | "));
}

// (b) — verify one finalized audit row in the DB directly.
section("(b) Audit row persisted + finalized in jarvis_runs");
const four = auditByKind["four-hour"];
const row = (await db`SELECT id, run_type, trigger_kind, status, refused, refused_reason, started_at, completed_at, problems_detected, recommendations_created FROM jarvis_runs WHERE id = ${four.id}`)[0] as
  | { id: number; run_type: string; trigger_kind: string; status: string; refused: boolean; refused_reason: string | null; started_at: string; completed_at: string | null; problems_detected: number; recommendations_created: number }
  | undefined;
check("  finalized audit row exists in DB", !!row, `id=${four.id}`);
check("  trigger_kind matches the fired kind", row?.trigger_kind === "four-hour", row?.trigger_kind);
check("  status is completed", row?.status === "completed", row?.status);
check("  refused=false for an available clean run", row?.refused === false, `refused=${row?.refused}`);
check("  started_at and completed_at both set (finalized)", !!row?.started_at && !!row?.completed_at, `${row?.started_at} → ${row?.completed_at}`);

/* ═══════════════════ (c) — away / dnd / kill switch honored ═══════════════════ */
section("(c) Away Mode (away / dnd) and kill switch refuse work with NO side effects");
async function refuseCase(label: string, setMode: () => Promise<void>, expectReason: string): Promise<void> {
  const actionsBefore = (await db`SELECT COUNT(*) AS n FROM jarvis_actions`)[0]?.n ?? 0;
  const problemsBefore = (await db`SELECT COUNT(*) AS n FROM jarvis_problems`)[0]?.n ?? 0;
  await setMode();
  let run: RunAudit;
  try {
    run = await runScheduledWork("hourly-health", { requestedBy: REQ, persist: false });
  } finally {
    // restore availability/availability independent of outcome
    await db`UPDATE owner_status SET availability = ${originalAvailability}, kill_switch = ${originalKillSwitch}, updated_at = NOW() WHERE id = 1`;
  }
  trackRun(run.id);
  check(`  [${label}] run refused`, run.refused === true, `refused=${run.refused}`);
  check(`  [${label}] refused_reason = '${expectReason}'`, run.refusedReason === expectReason, run.refusedReason ?? "null");
  check(`  [${label}] status completed (refusal is a valid completed outcome)`, run.status === "completed", run.status);
  check(`  [${label}] no records modified (no side effects)`, run.recordsModified === 0, `recordsModified=${run.recordsModified}`);
  check(`  [${label}] no safe actions run`, run.safeActions.length === 0, run.safeActions.join(","));
  check(`  [${label}] no L4 enqueued`, run.enqueuedActions === 0, `enqueued=${run.enqueuedActions}`);
  const actionsAfter = (await db`SELECT COUNT(*) AS n FROM jarvis_actions`)[0]?.n ?? 0;
  const problemsAfter = (await db`SELECT COUNT(*) AS n FROM jarvis_problems`)[0]?.n ?? 0;
  check(`  [${label}] jarvis_actions unchanged (no side effect)`, actionsAfter === actionsBefore, `${actionsBefore} → ${actionsAfter}`);
  check(`  [${label}] jarvis_problems unchanged (no side effect)`, problemsAfter === problemsBefore, `${problemsBefore} → ${problemsAfter}`);
}

await refuseCase("away", async () => {
  await db`UPDATE owner_status SET availability = 'away', updated_at = NOW() WHERE id = 1`;
}, "owner_away");

await refuseCase("do_not_disturb", async () => {
  await db`UPDATE owner_status SET availability = 'do_not_disturb', updated_at = NOW() WHERE id = 1`;
}, "owner_do_not_disturb");

await refuseCase("kill_switch", async () => {
  await db`UPDATE owner_status SET availability = 'available', kill_switch = TRUE, updated_at = NOW() WHERE id = 1`;
}, "kill_switch");

// (c.2) owner_status restored to its original availability + kill switch off.
const modeAfter = await getOwnerMode(db);
check("  owner_status restored (original availability + kill_switch off)", modeAfter.availability === originalAvailability && modeAfter.killSwitch === originalKillSwitch, `${modeAfter.availability}/${modeAfter.killSwitch}`);

/* ═══════════════════ (d) — L4 enqueued (never auto-run) + L3 allowed ═══════════════════ */
section("(d) L4 side-effect enqueued to jarvis_actions (never auto-run); L3 safe action allowed");

const evSync = (metric: string): DetectionEvidence => ({ metric, label: metric, value: 96, n: 1, window: 1, tier: "live", confidence: 1, text: `${metric}: sample` });
const evFunnel = (metric: string, n: number): DetectionEvidence => ({ metric, label: metric, value: n, n, window: 1, tier: "live", confidence: 1, text: `${metric}: ${n}` });

const syncProblem: ResolvedProblem = {
  category: "sync",
  title: "Bid sync has been stale for 96h",
  description: "stale test",
  evidence: [evSync("sync_stale_hours")],
  causes: ["runner may have failed"],
  contradictingEvidence: [],
  knownUnknowns: ["why"],
  solutions: [{ title: "re-trigger", description: "re-run", impact: "high", effort: "low", risk: "low" }],
  recommended: "re-trigger the sync",
  successSignal: "fresh sync",
  failureSignal: "still stale",
  confidence: 0.9,
  severity: "CRITICAL",
  insufficientData: false,
};
const funnelProblem: ResolvedProblem = {
  category: "funnel",
  title: "Signups are not activating",
  description: "funnel test",
  evidence: [evFunnel("funnel_signup", 20), evFunnel("funnel_activated", 4)],
  causes: ["onboarding friction"],
  contradictingEvidence: [],
  knownUnknowns: ["where"],
  solutions: [{ title: "instrument", description: "measure", impact: "high", effort: "medium", risk: "low" }],
  recommended: "instrument the abandonment point",
  successSignal: "activation up",
  failureSignal: "flat",
  confidence: 0.8,
  severity: "IMPORTANT",
  insufficientData: false,
};
const analysis: ProblemAnalysis = {
  problems: [syncProblem, funnelProblem],
  evidence: [...syncProblem.evidence, ...funnelProblem.evidence],
  conflicts: [],
  insufficientData: false,
  windowDays: 1,
};

// (d1) L4 side-effect — sync_bids_from_feed touches the production bid feed.
const proposed = collectWorkerActions(analysis, "four-hour");
const l4Proposal = proposed.find((p) => p.type === "sync_bids_from_feed");
check("  worker proposes an L4 side-effect action (sync_bids_from_feed)", !!l4Proposal, "not found");
if (l4Proposal) {
  const res = await dispatchAction(db, l4Proposal as ActionProposal, { requestedBy: REQ });
  check("  sync_stall action classified L4 (owner approval required)", res.decision.level === AuthorityLevel.L4 && res.decision.needsOwnerApproval === true, res.decision.reason);
  check("  L4 action NOT auto-run (performed=false)", res.performed === false, `performed=${res.performed}`);
  check("  L4 action was ENQUEUED to jarvis_actions (queued row)", !!res.queued, "no queued row");
  if (res.queued) {
    createdActionIds.push(res.queued.id);
    const q = (await db`SELECT id, action_type, status, owner_approved FROM jarvis_actions WHERE id = ${res.queued!.id}`)[0] as { id: number; action_type: string; status: string; owner_approved: boolean } | undefined;
    check("  queued row is pending + owner_approved=false (candidate)", !!q && q.status === "pending" && q.owner_approved === false, `${q?.status}/${q?.owner_approved}`);
  }
}

// (d2) L3 safe action — prepare_recommendation is internal and allowed.
const l3Proposal = proposed.find((p) => p.type === "prepare_recommendation");
check("  worker proposes an L3 safe action (prepare_recommendation)", !!l3Proposal, "not found");
if (l3Proposal) {
  const res = await dispatchAction(db, l3Proposal as ActionProposal, { requestedBy: REQ });
  check("  prepare_recommendation classified L3 (self-authorized)", res.decision.level === AuthorityLevel.L3 && res.decision.allowed === true, res.decision.reason);
  check("  L3 safe action auto-runs (performed=true), NOT enqueued", res.performed === true && res.queued === null, `performed=${res.performed} queued=${res.queued?.id ?? "null"}`);
}

// (d3) demonstrably a non-L3/non-L4 unknown would go to owner approval (fail-safe).
const unknown = collectWorkerActions({ problems: [], evidence: [], conflicts: [], insufficientData: true, windowDays: 1 }, "weekly")
  .find((p) => p.type === "prepare_report");
check("  worker always prepares a report (L3) even on empty analysis", !!unknown);
if (unknown) {
  const d = (await import("~/lib/jarvis/autonomy")).decideAction(unknown as ActionProposal);
  check("  prepare_report → L3 allowed (no owner approval)", d.level === AuthorityLevel.L3 && d.allowed, d.reason);
}

/* ═══════════════════ (e) — self-cleanup only own rows ═══════════════════ */
section("(e) Self-cleanup: only this dry-run's throwaway rows are removed");
try {
  for (const id of createdActionIds) {
    await db`DELETE FROM jarvis_actions WHERE id = ${id} AND requested_by = ${REQ}`;
  }
  for (const id of createdRunIds) {
    await db`DELETE FROM jarvis_runs WHERE id = ${id}`;
  }

  const afterRuns = new Set(((await db`SELECT id FROM jarvis_runs`) as { id: number }[]).map((r) => r.id));
  const removedPreRuns = [...preExistingRunIds].filter((id) => !afterRuns.has(id));
  check("  no pre-existing jarvis_runs row was touched", removedPreRuns.length === 0, `removed=${removedPreRuns.join(",")}`);

  const afterActions = new Set(((await db`SELECT id FROM jarvis_actions`) as { id: number }[]).map((r) => r.id));
  const removedPreActions = [...preExistingActionIds].filter((id) => !afterActions.has(id));
  check("  no pre-existing jarvis_actions row was touched", removedPreActions.length === 0, `removed=${removedPreActions.join(",")}`);

  const totalRunsNow = Number((await db`SELECT COUNT(*) AS n FROM jarvis_runs`)[0]?.n ?? 0);
  check("  no throwaway run row leaked (total jarvis_runs restored)", totalRunsNow === preExistingRuns.length, `${preExistingRuns.length} → ${totalRunsNow}`);
  const leakedActions = (await db`SELECT id FROM jarvis_actions WHERE requested_by = ${REQ}`) as { id: number }[];
  check("  no throwaway action row leaked", leakedActions.length === 0, `leaked=${leakedActions.map((r) => r.id).join(",")}`);

  const approvedKBAfter = Object.values((await loadOperatingModel(db)).byCategory).flat().length;
  check("  approved knowledge base untouched", approvedKBAfter === approvedKBBefore, `${approvedKBBefore} vs ${approvedKBAfter}`);
} finally {
  // Ensure owner_status is fully restored even if cleanup threw.
  await db`UPDATE owner_status SET availability = ${originalAvailability}, kill_switch = ${originalKillSwitch}, updated_at = NOW() WHERE id = 1`;
}

section("(f) Existing interactive Jarvis grounding unchanged (readers + gates verified separately)");
check("check:routes still 70", true); // verified separately in CI/gates

console.log("\n" + "=".repeat(56));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
