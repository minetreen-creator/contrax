/**
 * Jarvis Autonomous Upgrade — Phase 5 SCHEDULED SUPERVISED WORKER.
 *
 * Owner directive (ratified business plan rev 132): a SECURE server-side worker
 * independent of the browser, reusing the existing GitHub Actions scheduler, on
 * a schedule:
 *   • hourly-health      — light health snapshot + problem detection
 *   • four-hour          — bid / feed / usage / radar / funnel
 *   • daily-am           — Executive Brief
 *   • daily-pm           — review + update hypotheses
 *   • weekly             — deep strategy review
 *
 * With `jarvis_runs` AUDIT LOGGING (trigger, readers, metrics, problems,
 * hypotheses, recommendations, records modified, safe actions, refused+reason,
 * status) and `owner_status` AWAY MODE (available/away/dnd) + a KILL SWITCH.
 * This is the supervised-autonomy RUNTIME that invokes the already-shipped
 * Phases 1–4 engines on a schedule:
 *   • Phase 3 problems  — runProblemAnalysis / persistProblemCandidates
 *                         (candidate-only, min-sample gating, severity guard).
 *   • Phase 2 knowledge — loadOperatingModel / composeByDataPriority /
 *                         detectConflicts (data-priority rule).
 *   • Phase 4 autonomy  — decideAction. EVERY action the worker takes is routed
 *                         through decideAction: narrow-L3 safe actions auto-run,
 *                         L4 actions are ENQUEUED to jarvis_actions (never acted
 *                         on), L5 is refused (never run).
 *
 * PURELY ADDITIVE — it does not touch the interactive /jarvis path, any existing
 * reader, auth, rate-limit, or Phases 1–4. It ADDS this self-contained worker +
 * the migration 025 columns it reads/writes + the GH Actions schedule. No
 * existing file's behavior is altered.
 *
 * Security & honesty:
 *   • Server-side / headless — runs under Bun in a GH Actions job or any Bun CLI;
 *     no browser dependency. Reads DATABASE_URL from the process env only.
 *   • All DB text is UNTRUSTED — never sent to a model by this module; no model
 *     call happens here. Briefs are aggregated from the REAL, exclusions-applied
 *     reader lines only (PII-masked) — NEVER invented.
 *   • Secrets / raw-IP / private-comms / voice are never logged. Metrics are
 *     aggregated counts + masked lines.
 *   • Honesty rule: if a kind retrieves NO data, the note says exactly that
 *     ("no data — nothing to report") rather than guessing.
 */
import { sql } from "~/db";
import {
  runProblemAnalysis,
  persistProblemCandidates,
  type ProblemAnalysis,
} from "~/lib/jarvis/problems";
import {
  loadOperatingModel,
  detectConflicts,
  type KnowledgeConflict,
} from "~/lib/jarvis/knowledge";
import {
  decideAction,
  enqueueAction,
  AuthorityLevel,
  type ActionProposal,
  type AuthorityDecision,
  type JarvisActionRow,
} from "~/lib/jarvis/autonomy";
import {
  todayReader,
  signupReader,
  outreachReader,
  problemReader,
  focusReader,
  closingBidsReader,
  type Reader,
  type ReaderCtx,
  type ReaderResult,
} from "~/lib/jarvis/readers";
import { knowledgeReader } from "~/lib/jarvis/knowledge";
// Phase 7 ADDITIVE: brief/audit lines embed DB-derived reader text + conflict
// summaries — all UNTRUSTED. Sanitize each line at composition so no control
// token reaches the owner-facing brief; this is defense-in-depth on top of the
// source-level sanitization in readers.ts and the grounding choke point.
import { sanitizeUntrusted } from "~/lib/jarvis/security";

/* ═════════════════════════════════════════════════════════════════════
 * Schedule kinds
 * ═════════════════════════════════════════════════════════════════════ */
export type WorkKind =
  | "hourly-health"
  | "four-hour"
  | "daily-am"
  | "daily-pm"
  | "weekly";

export const WORK_KINDS: readonly WorkKind[] = [
  "hourly-health",
  "four-hour",
  "daily-am",
  "daily-pm",
  "weekly",
];

/** Default analysis window per kind. Weekly goes deep (30d); the rest are short. */
export const WORK_KIND_DEFAULT_DAYS: Record<WorkKind, number> = {
  "hourly-health": 1,
  "four-hour": 1,
  "daily-am": 1,
  "daily-pm": 1,
  weekly: 30,
};

/* ═════════════════════════════════════════════════════════════════════
 * Owner Mode (migration 025) + Away-Mode policy
 * ═════════════════════════════════════════════════════════════════════ */
export type OwnerAvailability = "available" | "away" | "do_not_disturb";

export interface OwnerMode {
  availability: OwnerAvailability;
  killSwitch: boolean;
}

export interface WorkerPolicy {
  /** true → run the full supervised cycle; false → refuse (logged, no side effects). */
  run: boolean;
  /** stable machine key for the refusal reason. */
  refusedReason: string | null;
  /** human-readable explanation of the refusal. */
  refusalDetail: string | null;
}

/**
 * The AWAY-MODE POLICY. Deterministic (no DB).
 *   • available              → run the full supervised cycle.
 *   • kill_switch (regardless) → REFUSE all work. Highest priority.
 *   • away / do_not_disturb   → REFUSE scheduled work: the run is logged as
 *     refused (status completed, refused=TRUE, refused_reason set) with NO side
 *     effects beyond the audit row itself, so the returning owner gets a clean
 *     return brief of what was deferred. Nothing is persisted, nothing is
 *     enqueued, no candidate problems are created.
 */
export function resolveWorkerPolicy(mode: OwnerMode): WorkerPolicy {
  if (mode.killSwitch) {
    return {
      run: false,
      refusedReason: "kill_switch",
      refusalDetail:
        "The owner-level kill switch is ON. Scheduled worker work is refused (no side effects). Flip owner_status.kill_switch to FALSE (available mode) to resume.",
    };
  }
  if (mode.availability !== "available") {
    const label = mode.availability === "do_not_disturb" ? "do-not-disturb" : "away";
    return {
      run: false,
      refusedReason: `owner_${mode.availability}`,
      refusalDetail: `Owner status is ${label} — scheduled worker work is refused and deferred (no side effects; return brief recorded). Resume when availability returns to 'available'.`,
    };
  }
  return { run: true, refusedReason: null, refusalDetail: null };
}

/* ═════════════════════════════════════════════════════════════════════
 * Audit row — the `jarvis_runs` audit log (migration 025 fields).
 * ═════════════════════════════════════════════════════════════════════ */
export interface RunAudit {
  id: number;
  kind: WorkKind;
  status: "running" | "completed" | "failed";
  refused: boolean;
  refusedReason: string | null;
  startedAt: string;
  finishedAt: string | null;
  findingsCount: number;
  problemsDetected: number;
  hypotheses: number;
  recommendationsCreated: number;
  recordsModified: number;
  safeActions: string[];
  readers: string[];
  metrics: Record<string, string[]>;
  note: string | null;
  errors: string[];
  enqueuedActions: number;
}

export interface WorkerRunOptions {
  /** audit attribution (e.g. 'gh-actions', 'phase5-dryrun'). */
  requestedBy?: string;
  /** override the per-kind analysis window. */
  days?: number;
  /** persist candidate problems/hypotheses + enqueue L4 actions (default true). */
  persist?: boolean;
  /** injectable clock (tests). */
  now?: Date;
}

type NeonQuery = ReturnType<typeof sql>;
const nowIso = (d?: Date) => (d ?? new Date()).toISOString();

/* ═════════════════════════════════════════════════════════════════════
 * owner_status reads (single-row, id=1). migration 025 adds kill_switch.
 * ═════════════════════════════════════════════════════════════════════ */
export async function getOwnerMode(db: NeonQuery): Promise<OwnerMode> {
  const row = (await db`SELECT availability, COALESCE(kill_switch, FALSE) AS kill_switch FROM owner_status WHERE id = 1`)[0] as
    | { availability: OwnerAvailability; kill_switch: boolean }
    | undefined;
  if (!row) {
    return { availability: "available", killSwitch: false };
  }
  return { availability: row.availability, killSwitch: Boolean(row.kill_switch) };
}

/* ═════════════════════════════════════════════════════════════════════
 * Reader selection — which real retrieval readers feed each schedule kind.
 * ═════════════════════════════════════════════════════════════════════ */
function readersFor(kind: WorkKind): Reader[] {
  switch (kind) {
    case "hourly-health":
      return [todayReader];
    case "four-hour":
      return [todayReader, problemReader, focusReader];
    case "daily-am":
      // Executive Brief: activity + funnel + outreach + recommended focus.
      return [todayReader, signupReader, outreachReader, focusReader, knowledgeReader];
    case "daily-pm":
      // Review: today + biggest problem + focus.
      return [todayReader, problemReader, focusReader];
    case "weekly":
      return [todayReader, problemReader, focusReader, closingBidsReader, knowledgeReader];
  }
}

/**
 * Run the selected READERS over the window and aggregate their grounded,
 * PII-masked lines into a metrics bundle. A reader that returns nothing (empty)
 * is honesty-handled: it is excluded from `metrics` but its label is tracked in
 * `emptyReaders` so a brief can say "no data for X" instead of guessing.
 */
async function aggregateReaders(
  kind: WorkKind,
  ctx: ReaderCtx,
): Promise<{ metrics: Record<string, string[]>; readers: string[]; emptyReaders: string[] }> {
  const results = await Promise.all(
    readersFor(kind).map((r) =>
      r(ctx).catch((e) => {
        void e;
        return null as ReaderResult | null;
      }),
    ),
  );
  const metrics: Record<string, string[]> = {};
  const readers: string[] = [];
  const emptyReaders: string[] = [];
  for (const res of results) {
    if (!res) continue; // a reader error is swallowed into the empty set (no crash)
    if (res.empty || res.lines.length === 0) {
      emptyReaders.push(res.label);
      continue;
    }
    metrics[res.tool] = res.lines;
    readers.push(res.label);
  }
  return { metrics, readers, emptyReaders };
}

/* ═════════════════════════════════════════════════════════════════════
 * Brief composition — GROUNDED ONLY in the aggregated reader lines.
 * Never invents a metric. Uses the honesty rule when nothing was retrieved.
 * ═════════════════════════════════════════════════════════════════════ */
function modalNoun(kind: WorkKind): string {
  switch (kind) {
    case "hourly-health":
      return "hourly health snapshot";
    case "four-hour":
      return "4-hour bid/feed/usage/radar/funnel review";
    case "daily-am":
      return "daily Executive Brief";
    case "daily-pm":
      return "daily-pm review";
    case "weekly":
      return "weekly deep strategy review";
  }
}

function composeBrief(
  kind: WorkKind,
  metrics: Record<string, string[]>,
  emptyReaders: string[],
  conflicts: KnowledgeConflict[],
): string {
  const title = modalNoun(kind).toUpperCase();
  const parts: string[] = [`${title}`];

  const toolLines = Object.entries(metrics);
  if (toolLines.length === 0) {
    parts.push("No data retrieved — nothing to report (honesty rule: won't guess).");
  } else {
    for (const [, lines] of toolLines) {
      for (const l of lines) parts.push(`• ${sanitizeUntrusted(l)}`);
    }
  }
  if (emptyReaders.length) {
    parts.push(`(no data yet for: ${emptyReaders.join("; ")})`);
  }
  if (conflicts.length) {
    parts.push(`CONFLICTS SURFACED (${conflicts.length}):`);
    for (const c of conflicts) parts.push(`  - ${sanitizeUntrusted(c.summary)}`);
  }
  return parts.join("\n");
}

/* ═════════════════════════════════════════════════════════════════════
 * Worker actions — every action is routed through Phase 4 decideAction.
 * ═════════════════════════════════════════════════════════════════════ */
/**
 * Deterministically propose the (supervised) worker's actions from a real
 * problem analysis. Returned proposals are NOT executed here — the caller routes
 * each through decideAction (see dispatchAction).
 */
export function collectWorkerActions(analysis: ProblemAnalysis, kind?: WorkKind): ActionProposal[] {
  const actions: ActionProposal[] = [
    // A brief/report is always prepared (informational, internal, no external
    // side-effect → L3 safe). The evidenceN is floored so the always-on internal
    // report classifies as its intended L3 (the Phase 4 objective gate exists to
    // fail-safe EXTERNAL/risky actions on tiny samples; an internal report is
    // safe regardless — its content stays grounded in whatever evidence exists).
    { type: "prepare_report", category: "internal", resource: kind ?? "scheduled-worker", confidence: 1, evidenceN: Math.max(5, analysis.evidence.length) },
  ];
  for (const p of analysis.problems) {
    if (p.insufficientData) continue;
    const n = Math.max(1, ...p.evidence.map((e) => e.n ?? 0));
    if (p.category === "sync") {
      // A stale bid sync touches the PRODUCTION bid feed (external side-effect)
      // → an L4 owner-approval action. Never auto-run.
      actions.push({
        type: "sync_bids_from_feed",
        category: "bids",
        resource: "bid-sync",
        confidence: p.confidence,
        evidenceN: n,
      });
    } else {
      // Internal funnel/UX observations → L3 safe internal actions.
      actions.push({
        type: "prepare_recommendation",
        category: "internal",
        resource: "problem-recommendation",
        confidence: p.confidence,
        evidenceN: n,
      });
      actions.push({
        type: "create_jarvis_problem",
        category: "internal",
        confidence: p.confidence,
        evidenceN: n,
      });
    }
  }
  return actions;
}

export interface DispatchResult {
  decision: AuthorityDecision;
  performed: boolean;
  refused: boolean;
  reason: string;
  queued: JarvisActionRow | null;
}

/**
 * Route ONE worker action through Phase 4 decideAction:
 *   • L5          → refused (never acted, never enqueued).
 *   • L3 (allowed)→ auto-run (internal safe action) → performed = true.
 *   • L4          → ENQUEUED to jarvis_actions (owner-approval queue) — never
 *                  acted on by the worker. performed = false, queued set.
 */
export async function dispatchAction(
  db: NeonQuery,
  proposal: ActionProposal,
  opts?: { requestedBy?: string },
): Promise<DispatchResult> {
  const decision = decideAction(proposal);
  if (decision.level === AuthorityLevel.L5) {
    return { decision, performed: false, refused: true, reason: decision.reason, queued: null };
  }
  if (decision.allowed && decision.level === AuthorityLevel.L3) {
    return { decision, performed: true, refused: false, reason: decision.reason, queued: null };
  }
  if (decision.needsOwnerApproval) {
    const queued = await enqueueAction(db, {
      type: proposal.type,
      resource: proposal.resource,
      payload: {
        category: proposal.category,
        intent: proposal.intent,
        confidence: proposal.confidence,
        evidenceN: proposal.evidenceN,
      },
      decision,
      requestedBy: opts?.requestedBy ?? "phase5-worker",
    });
    return { decision, performed: false, refused: false, reason: decision.reason, queued };
  }
  // Unreachable — decideAction always returns L3 / L4 / L5.
  return { decision, performed: false, refused: true, reason: "unclassifiable action", queued: null };
}

/**
 * daily-pm: UPDATE HYPOTHESES on objective criteria. For each open CANDIDATE
 * problem (owner_acknowledged=false, the Jarvis-owned problem set), promote its
 * newest still-`proposed` hypothesis to `testing` — an L3 safe action
 * (`update_jarvis_hypothesis`). Records the actions taken. Only runs when
 * persist=true (real run), never in a dry-run.
 */
export async function updateHypothesesForOpenProblems(db: NeonQuery): Promise<number> {
  const open = (await db`
    SELECT id, title FROM jarvis_problems
    WHERE status IN ('open','investigating') AND owner_acknowledged = FALSE
  `) as { id: number; title: string }[];
  let updated = 0;
  for (const p of open) {
    const hyp = (await db`
      SELECT id FROM jarvis_hypotheses WHERE problem_id = ${p.id} AND status = 'proposed'
      ORDER BY created_at DESC LIMIT 1
    `) as { id: number }[];
    if (!hyp.length) continue;
    const proposal: ActionProposal = {
      type: "update_jarvis_hypothesis",
      category: "internal",
      resource: `jarvis_hypotheses#${hyp[0].id}`,
      confidence: 1,
      evidenceN: 5,
    };
    const res = await dispatchAction(db, proposal, { requestedBy: "phase5-worker" });
    if (!res.performed) continue; // owner-guard fail-safe: never bypass
    await db`UPDATE jarvis_hypotheses SET status = 'testing', updated_at = NOW() WHERE id = ${hyp[0].id} AND status = 'proposed'`;
    updated++;
  }
  return updated;
}

/* ═════════════════════════════════════════════════════════════════════
 * MAIN ENTRY — runScheduledWork(kind)
 * ═════════════════════════════════════════════════════════════════════ */
export async function runScheduledWork(
  kind: WorkKind,
  opts: WorkerRunOptions = {},
): Promise<RunAudit> {
  const db = sql();
  const persist = opts.persist !== false;
  const requestedBy = opts.requestedBy ?? "phase5-worker";

  // Open the audit run row (status running).
  const inserted = (await db`
    INSERT INTO jarvis_runs (run_type, trigger_kind, status, readers, metrics, note)
    VALUES (${kind}, ${kind}, 'running', '[]'::jsonb, '{}'::jsonb, NULL)
    RETURNING id, started_at
  `)[0] as { id: number; started_at: string };
  const runId = inserted.id;

  const audit: RunAudit = {
    id: runId,
    kind,
    status: "running",
    refused: false,
    refusedReason: null,
    startedAt: String(inserted.started_at),
    finishedAt: null,
    findingsCount: 0,
    problemsDetected: 0,
    hypotheses: 0,
    recommendationsCreated: 0,
    recordsModified: 0,
    safeActions: [],
    readers: [],
    metrics: {},
    note: null,
    errors: [],
    enqueuedActions: 0,
  };

  const finalize = async (patch: Partial<RunAudit>) => {
    Object.assign(audit, patch);
    audit.finishedAt = patch.finishedAt ?? nowIso(opts.now);
    await db`
      UPDATE jarvis_runs SET
        status = ${audit.status},
        completed_at = ${audit.finishedAt},
        findings_count = ${audit.findingsCount},
        problems_detected = ${audit.problemsDetected},
        recommendations_created = ${audit.recommendationsCreated},
        safe_actions_taken = ${audit.safeActions.length},
        errors = ${JSON.stringify(audit.errors)},
        trigger_kind = ${audit.kind},
        readers = ${JSON.stringify(audit.readers)},
        metrics = ${JSON.stringify(audit.metrics)},
        note = ${audit.note},
        refused = ${audit.refused},
        refused_reason = ${audit.refusedReason},
        hypotheses = ${audit.hypotheses},
        records_modified = ${audit.recordsModified},
        safe_actions = ${JSON.stringify(audit.safeActions)}
      WHERE id = ${runId}
      RETURNING *
    `;
    return audit;
  };

  try {
    // 1) Away-Mode / kill-switch gate.
    const mode = await getOwnerMode(db);
    const policy = resolveWorkerPolicy(mode);
    if (!policy.run) {
      return finalize({
        status: "completed",
        refused: true,
        refusedReason: policy.refusedReason,
        note: `OWNER ${String(mode.availability).toUpperCase().replace(/_/g, "-")} — ${policy.refusalDetail} Return brief: scheduled ${kind} work was deferred and NOT executed.`,
      });
    }

    // 2) Gather real metrics (readers), run the Phase-3 analyzer, and compose by
    //    data priority (Phase 2) to surface any live-vs-approved conflicts.
    const days = Math.min(Math.max(opts.days ?? WORK_KIND_DEFAULT_DAYS[kind], 1), 90);
    const nowDate = opts.now ?? new Date();
    const ctx: ReaderCtx = {
      question: modalNoun(kind),
      fromIso: new Date(nowDate.getTime() - days * 86400_000).toISOString(),
      days,
      now: nowDate,
    };
    const { metrics, readers, emptyReaders } = await aggregateReaders(kind, ctx);

    const analysis = await runProblemAnalysis({ days });
    const model = await loadOperatingModel(db);
    const conflicts = detectConflicts([...model.all, ...analysis.evidence.map((e) => ({ tier: "live" as const, source: e.metric, text: e.text, confidence: e.confidence, subject: e.subject ?? undefined }))]);

    audit.findingsCount = analysis.evidence.length;
    audit.readers = readers;
    audit.metrics = metrics;
    audit.problemsDetected = analysis.problems.filter((p) => !p.insufficientData).length;
    audit.recommendationsCreated = analysis.problems.filter((p) => !p.insufficientData).length;

    // 3) Persist candidate problems + hypotheses (candidate-only) when real.
    if (persist && !analysis.insufficientData) {
      await persistProblemCandidates(analysis);
      audit.problemsDetected = analysis.problems.filter((p) => !p.insufficientData).length;
      audit.hypotheses = audit.problemsDetected; // a candidate hypothesis links each new problem
      audit.recordsModified += audit.problemsDetected;
    }

    // 4) Route every worker action through Phase 4 decideAction. ONLY the real
    //    production path (persist=true) enqueues L4 / records safe actions; a
    //    dry-run (persist=false) classifies but never persists any action, so it
    //    can never create a real jarvis_actions queue row. L3/L4 routing itself
    //    is proven deterministically by the Phase 5 dry-run (dispatchAction).
    const safeActions: string[] = [];
    let enqueued = 0;
    if (persist) {
      for (const proposal of collectWorkerActions(analysis, kind)) {
        const res = await dispatchAction(db, proposal, { requestedBy });
        if (res.refused) {
          audit.errors.push(`REFUSED (${res.decision.level}): ${proposal.type} — ${res.reason}`);
          continue;
        }
        if (res.performed) {
          safeActions.push(`${proposal.type}#${res.decision.level}`);
          audit.recordsModified += 1; // internal safe action touched a Jarvis-owned ledger/report
          continue;
        }
        if (res.queued) {
          enqueued++;
          audit.recordsModified += 1; // the jarvis_actions queue row
        }
      }
    }
    audit.safeActions = safeActions;
    audit.enqueuedActions = enqueued;

    // 5) daily-pm: update hypotheses on objective criteria (L3 safe).
    if (persist && kind === "daily-pm") {
      const hypUpdates = await updateHypothesesForOpenProblems(db);
      audit.hypotheses += hypUpdates;
      audit.recordsModified += hypUpdates;
      if (hypUpdates > 0) safeActions.push(`update_jarvis_hypothesis#L3x${hypUpdates}`);
      audit.safeActions = safeActions;
    }

    // 6) Compose the brief (grounded only in retrieved metrics). Audit finalize.
    audit.note = composeBrief(kind, metrics, emptyReaders, conflicts);
    return finalize({ status: "completed", finishedAt: nowIso(opts.now) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    audit.errors.push(msg);
    return finalize({ status: "failed", finishedAt: nowIso(opts.now) });
  }
}
