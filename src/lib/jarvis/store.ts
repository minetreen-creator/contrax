/**
 * Jarvis Autonomous Upgrade — Phase 1 MEMORY / DATA LAYER (store).
 *
 * Server-only typed CRUD + semantics for the durable Jarvis ledgers created by
 * migration 023 (db/migrations/023_jarvis_memory_layer.sql).
 *
 * This phase is PURE PERSISTENT STORAGE + approved-knowledge seed. It does NOT
 * run any autonomy: no scheduler, no problem-solver, no writes from the
 * existing interactive /api/jarvis path. These modules are the durable bedrock
 * the supervised autonomous assistant (Phases 2–7) will consume.
 *
 * Semantics implemented here (what later phases rely on):
 *   • owner_approved filtering  — non-approved memory/decisions are CANDIDATES,
 *     not facts. Fact-tier readers should only read owner_approved=true rows.
 *   • supersede handling        — marking superseded_by / superseded_at retires
 *     a record. Owner-approved rows are NEVER hard-deleted; `removeMemory` only
 *     physically deletes non-approved rows.
 *   • expiry awareness          — a memory row past expires_at is treated as
 *     STALE, not live (`listLiveMemory` filters it out automatically).
 *   • find-by-category helper   — for seeding / reading approved facts.
 *
 * All functions are server-only (import `sql` from "~/db" — guarded against
 * client bundling). Nothing here is exposed to the client in this phase.
 */
import { sql } from "~/db";

/* ─────────────────────────── Row types ─────────────────────────── */
export interface JarvisMemory {
  id: number;
  category: string;
  fact: string;
  source: string;
  confidence: number;
  owner_approved: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  superseded_by: number | null;
}
export interface JarvisDecision {
  id: number;
  decision: string;
  rationale: string | null;
  owner_approved: boolean;
  effective_at: string;
  superseded_at: string | null;
  created_at: string;
}
export interface JarvisProblem {
  id: number;
  category: string;
  title: string;
  description: string | null;
  severity: "INFO" | "WATCH" | "IMPORTANT" | "CRITICAL";
  confidence: number;
  evidence: unknown[];
  detected_at: string;
  status: "open" | "investigating" | "resolved" | "dismissed";
  owner_acknowledged: boolean;
  resolved_at: string | null;
}
export interface JarvisHypothesis {
  id: number;
  problem_id: number | null;
  hypothesis: string;
  supporting_evidence: unknown[];
  contradicting_evidence: unknown[];
  confidence: number;
  status: "proposed" | "testing" | "active" | "accepted" | "rejected" | "superseded";
  created_at: string;
  updated_at: string;
}
export interface JarvisExperiment {
  id: number;
  hypothesis_id: number | null;
  name: string;
  baseline_metric: string | null;
  target_metric: string | null;
  baseline_value: number | null;
  target_value: number | null;
  start_at: string | null;
  end_at: string | null;
  owner_approved: boolean;
  status: "planned" | "running" | "completed" | "aborted";
  result: string | null;
  conclusion: string | null;
  created_at: string;
}
export interface JarvisFeedback {
  id: number;
  recommendation_id: number;
  accepted: boolean | null;
  owner_rating: number | null;
  owner_comment: string | null;
  expected_result: string | null;
  actual_result: string | null;
  created_at: string;
}
export interface JarvisOutcome {
  id: number;
  subject_type: string;
  subject_id: string;
  metric: string;
  before_value: unknown;
  after_value: unknown;
  observation_window: string | null;
  conclusion: string | null;
  confidence: number | null;
  created_at: string;
}
export interface JarvisTask {
  id: number;
  task_type: string;
  title: string;
  instructions: string | null;
  authority_level: "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
  status: "pending" | "scheduled" | "running" | "completed" | "failed" | "cancelled" | "awaiting_approval";
  created_by: string | null;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
  requires_owner_approval: boolean;
}
export interface JarvisRun {
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
}
export type OwnerAvailability = "available" | "away" | "do_not_disturb";
export interface OwnerStatus {
  id: number;
  availability: OwnerAvailability;
  updated_at: string;
}

/** Throw when a required row is not found — the caller decides how to handle. */
export class NotFoundError extends Error {
  constructor(name: string, id: number) {
    super(`${name} #${id} not found`);
    this.name = "NotFoundError";
  }
}

type NeonQuery = ReturnType<typeof sql>;
const now = () => new Date().toISOString();

const byId = (rows: any[]) => (rows.length ? rows[0] : null);

/* ─────────────────────────── MEMORY ─────────────────────────── */
export async function getMemory(db: NeonQuery, id: number): Promise<JarvisMemory | null> {
  const rows = await db`SELECT * FROM jarvis_memory WHERE id = ${id}`;
  return (byId(rows) as JarvisMemory | null) ?? null;
}

export interface CreateMemoryInput {
  category: string;
  fact: string;
  source?: string;
  confidence?: number;
  owner_approved?: boolean;
  expires_at?: string | null;
  superseded_by?: number | null;
}
export async function createMemory(db: NeonQuery, input: CreateMemoryInput): Promise<JarvisMemory> {
  const rows = await db`
    INSERT INTO jarvis_memory (category, fact, source, confidence, owner_approved, expires_at, superseded_by)
    VALUES (${input.category}, ${input.fact}, ${input.source ?? "jarvis"}, ${input.confidence ?? 1}, ${input.owner_approved ?? false}, ${input.expires_at ?? null}, ${input.superseded_by ?? null})
    RETURNING *
  `;
  return rows[0] as JarvisMemory;
}

export interface UpdateMemoryInput {
  fact?: string;
  confidence?: number;
  owner_approved?: boolean;
  expires_at?: string | null;
}
export async function updateMemory(db: NeonQuery, id: number, patch: UpdateMemoryInput): Promise<JarvisMemory | null> {
  const existing = await getMemory(db, id);
  if (!existing) return null;
  const rows = await db`
    UPDATE jarvis_memory
    SET fact = ${patch.fact ?? existing.fact},
        confidence = ${patch.confidence ?? existing.confidence},
        owner_approved = ${patch.owner_approved ?? existing.owner_approved},
        expires_at = ${patch.expires_at !== undefined ? patch.expires_at : existing.expires_at},
        updated_at = ${now()}
    WHERE id = ${id}
    RETURNING *
  `;
  return byId(rows) as JarvisMemory | null;
}

/**
 * Retire a memory by pointing superseded_by at a successor. Owner-approved rows
 * must NEVER be hard-deleted — this is the only supported retirement path for
 * them. (Non-approved rows may alternatively be removed with `removeMemory`.)
 */
export async function supersedeMemory(db: NeonQuery, id: number, supersedingId: number): Promise<JarvisMemory | null> {
  const rows = await db`
    UPDATE jarvis_memory
    SET superseded_by = ${supersedingId}, updated_at = ${now()}
    WHERE id = ${id}
    RETURNING *
  `;
  return byId(rows) as JarvisMemory | null;
}

/** Physically delete ONLY a non-approved record. Owner-approved rows are protected. */
export async function removeMemory(db: NeonQuery, id: number): Promise<boolean> {
  const res = await db`
    DELETE FROM jarvis_memory WHERE id = ${id} AND owner_approved = FALSE
  `;
  const changed = (res as any)?.length !== undefined ? res.length > 0 : true;
  if (changed) {
    const chk = await getMemory(db, id);
    if (chk) throw new Error("removeMemory: attempted to delete an owner-approved memory — refused");
  }
  return changed;
}

/**
 * LIVE memory = owner_approved AND not expired AND not superseded. This is the
 * "approved facts" view the data-priority rule uses. Expired rows are stale.
 */
export async function listLiveMemory(db: NeonQuery, options?: {
  category?: string;
  source?: string;
}): Promise<JarvisMemory[]> {
  if (options?.category) {
    return (await db`
      SELECT * FROM jarvis_memory
      WHERE owner_approved = TRUE AND (expires_at IS NULL OR expires_at > ${now()})
        AND superseded_by IS NULL AND category = ${options.category}
      ORDER BY created_at ASC
    `) as JarvisMemory[];
  }
  if (options?.source) {
    return (await db`
      SELECT * FROM jarvis_memory
      WHERE owner_approved = TRUE AND (expires_at IS NULL OR expires_at > ${now()})
        AND superseded_by IS NULL AND source = ${options.source}
      ORDER BY created_at ASC
    `) as JarvisMemory[];
  }
  return (await db`
    SELECT * FROM jarvis_memory
    WHERE owner_approved = TRUE AND (expires_at IS NULL OR expires_at > ${now()})
      AND superseded_by IS NULL
    ORDER BY created_at ASC
  `) as JarvisMemory[];
}

/** Approved facts for a category — the seeding / reading helper for later phases. */
export async function findMemoryByCategory(db: NeonQuery, category: string): Promise<JarvisMemory[]> {
  return listLiveMemory(db, { category });
}

export async function listAllMemory(db: NeonQuery): Promise<JarvisMemory[]> {
  return (await db`SELECT * FROM jarvis_memory ORDER BY created_at ASC`) as JarvisMemory[];
}

/* ─────────────────────────── DECISIONS ─────────────────────────── */
export async function getDecision(db: NeonQuery, id: number): Promise<JarvisDecision | null> {
  return byId(await db`SELECT * FROM jarvis_decisions WHERE id = ${id}`) as JarvisDecision | null;
}
export async function createDecision(
  db: NeonQuery,
  input: { decision: string; rationale?: string | null; owner_approved?: boolean; effective_at?: string },
): Promise<JarvisDecision> {
  const rows = await db`
    INSERT INTO jarvis_decisions (decision, rationale, owner_approved, effective_at)
    VALUES (${input.decision}, ${input.rationale ?? null}, ${input.owner_approved ?? false}, ${input.effective_at ?? now()})
    RETURNING *
  `;
  return rows[0] as JarvisDecision;
}
/** Retire a decision at a point in time (soft, never hard-delete). */
export async function supersedeDecision(db: NeonQuery, id: number, at?: string): Promise<JarvisDecision | null> {
  return byId(await db`
    UPDATE jarvis_decisions SET superseded_at = ${at ?? now()} WHERE id = ${id} RETURNING *
  `) as JarvisDecision | null;
}
/** Approved, currently-effective decisions — the "approved decisions" fact tier. */
export async function listApprovedDecisions(db: NeonQuery): Promise<JarvisDecision[]> {
  return (await db`
    SELECT * FROM jarvis_decisions
    WHERE owner_approved = TRUE AND superseded_at IS NULL
    ORDER BY effective_at ASC
  `) as JarvisDecision[];
}

/* ─────────────────────────── PROBLEMS / HYPOTHESES / EXPERIMENTS ─────────────────────────── */
export async function createProblem(
  db: NeonQuery,
  input: Partial<JarvisProblem> & { category: string; title: string },
): Promise<JarvisProblem> {
  const rows = await db`
    INSERT INTO jarvis_problems (category, title, description, severity, confidence, evidence, status, owner_acknowledged)
    VALUES (${input.category}, ${input.title}, ${input.description ?? null},
            ${input.severity ?? "INFO"}, ${input.confidence ?? 0.5},
            ${JSON.stringify(input.evidence ?? [])}, ${input.status ?? "open"}, ${input.owner_acknowledged ?? false})
    RETURNING *
  `;
  return rows[0] as JarvisProblem;
}
export async function getProblem(db: NeonQuery, id: number): Promise<JarvisProblem | null> {
  return byId(await db`SELECT * FROM jarvis_problems WHERE id = ${id}`) as JarvisProblem | null;
}
export async function updateProblemStatus(
  db: NeonQuery,
  id: number,
  status: JarvisProblem["status"],
  opts?: { resolvedAt?: string },
): Promise<JarvisProblem | null> {
  return byId(await db`
    UPDATE jarvis_problems
    SET status = ${status},
        resolved_at = ${opts?.resolvedAt ?? (status === "resolved" ? now() : null)}
    WHERE id = ${id}
    RETURNING *
  `) as JarvisProblem | null;
}
export async function listProblems(db: NeonQuery, status?: JarvisProblem["status"]): Promise<JarvisProblem[]> {
  if (status) {
    return (await db`SELECT * FROM jarvis_problems WHERE status = ${status} ORDER BY detected_at DESC`) as JarvisProblem[];
  }
  return (await db`SELECT * FROM jarvis_problems ORDER BY detected_at DESC`) as JarvisProblem[];
}

export async function createHypothesis(
  db: NeonQuery,
  input: { problem_id?: number | null; hypothesis: string; confidence?: number; status?: JarvisHypothesis["status"] },
): Promise<JarvisHypothesis> {
  const rows = await db`
    INSERT INTO jarvis_hypotheses (problem_id, hypothesis, supporting_evidence, contradicting_evidence, confidence, status)
    VALUES (${input.problem_id ?? null}, ${input.hypothesis}, '[]'::jsonb, '[]'::jsonb,
            ${input.confidence ?? 0.5}, ${input.status ?? "proposed"})
    RETURNING *
  `;
  return rows[0] as JarvisHypothesis;
}
export async function listHypothesesForProblem(db: NeonQuery, problemId: number): Promise<JarvisHypothesis[]> {
  return (await db`
    SELECT * FROM jarvis_hypotheses WHERE problem_id = ${problemId} ORDER BY created_at ASC
  `) as JarvisHypothesis[];
}
export async function updateHypothesisStatus(db: NeonQuery, id: number, status: JarvisHypothesis["status"]): Promise<JarvisHypothesis | null> {
  return byId(await db`
    UPDATE jarvis_hypotheses SET status = ${status}, updated_at = ${now()} WHERE id = ${id} RETURNING *
  `) as JarvisHypothesis | null;
}

export async function createExperiment(
  db: NeonQuery,
  input: { hypothesis_id?: number | null; name: string; status?: JarvisExperiment["status"] },
): Promise<JarvisExperiment> {
  const rows = await db`
    INSERT INTO jarvis_experiments (hypothesis_id, name, status)
    VALUES (${input.hypothesis_id ?? null}, ${input.name}, ${input.status ?? "planned"})
    RETURNING *
  `;
  return rows[0] as JarvisExperiment;
}
export async function listExperimentsForHypothesis(db: NeonQuery, hypothesisId: number): Promise<JarvisExperiment[]> {
  return (await db`
    SELECT * FROM jarvis_experiments WHERE hypothesis_id = ${hypothesisId} ORDER BY created_at ASC
  `) as JarvisExperiment[];
}

/* ─────────────────────────── FEEDBACK / OUTCOMES / TASKS / RUNS ─────────────────────────── */
export async function createFeedback(
  db: NeonQuery,
  input: { recommendation_id: number; accepted?: boolean | null; owner_rating?: number | null; owner_comment?: string | null; expected_result?: string | null; actual_result?: string | null },
): Promise<JarvisFeedback> {
  const rows = await db`
    INSERT INTO jarvis_feedback (recommendation_id, accepted, owner_rating, owner_comment, expected_result, actual_result)
    VALUES (${input.recommendation_id}, ${input.accepted ?? null}, ${input.owner_rating ?? null},
            ${input.owner_comment ?? null}, ${input.expected_result ?? null}, ${input.actual_result ?? null})
    RETURNING *
  `;
  return rows[0] as JarvisFeedback;
}
export async function listFeedback(db: NeonQuery, recommendationId: number): Promise<JarvisFeedback[]> {
  return (await db`
    SELECT * FROM jarvis_feedback WHERE recommendation_id = ${recommendationId} ORDER BY created_at ASC
  `) as JarvisFeedback[];
}

export async function createOutcome(
  db: NeonQuery,
  input: { subject_type: string; subject_id: string; metric: string; before_value?: unknown; after_value?: unknown; confidence?: number | null; conclusion?: string | null; observation_window?: string | null },
): Promise<JarvisOutcome> {
  const rows = await db`
    INSERT INTO jarvis_outcomes (subject_type, subject_id, metric, before_value, after_value, confidence, conclusion, observation_window)
    VALUES (${input.subject_type}, ${input.subject_id}, ${input.metric},
            ${input.before_value !== undefined ? JSON.stringify(input.before_value) : null},
            ${input.after_value !== undefined ? JSON.stringify(input.after_value) : null},
            ${input.confidence ?? null}, ${input.conclusion ?? null}, ${input.observation_window ?? null})
    RETURNING *
  `;
  return rows[0] as JarvisOutcome;
}

export async function createTask(
  db: NeonQuery,
  input: { task_type: string; title: string; instructions?: string | null; authority_level?: JarvisTask["authority_level"]; status?: JarvisTask["status"]; created_by?: string | null; scheduled_for?: string | null; requires_owner_approval?: boolean },
): Promise<JarvisTask> {
  const rows = await db`
    INSERT INTO jarvis_tasks (task_type, title, instructions, authority_level, status, created_by, scheduled_for, requires_owner_approval)
    VALUES (${input.task_type}, ${input.title}, ${input.instructions ?? null},
            ${input.authority_level ?? "L0"}, ${input.status ?? "pending"}, ${input.created_by ?? null},
            ${input.scheduled_for ?? null}, ${input.requires_owner_approval ?? false})
    RETURNING *
  `;
  return rows[0] as JarvisTask;
}
export async function updateTaskStatus(db: NeonQuery, id: number, status: JarvisTask["status"], opts?: { result?: string | null }): Promise<JarvisTask | null> {
  const completed = status === "completed" || status === "failed";
  return byId(await db`
    UPDATE jarvis_tasks
    SET status = ${status}, result = ${opts?.result ?? null},
        started_at = COALESCE(started_at, ${now()}),
        completed_at = ${completed ? now() : null}
    WHERE id = ${id}
    RETURNING *
  `) as JarvisTask | null;
}
export async function listTasksByStatus(db: NeonQuery, status: JarvisTask["status"]): Promise<JarvisTask[]> {
  return (await db`
    SELECT * FROM jarvis_tasks WHERE status = ${status} ORDER BY scheduled_for NULLS LAST, id ASC
  `) as JarvisTask[];
}

export async function createRun(db: NeonQuery, run_type: string): Promise<JarvisRun> {
  const rows = await db`
    INSERT INTO jarvis_runs (run_type) VALUES (${run_type}) RETURNING *
  `;
  return rows[0] as JarvisRun;
}
export async function completeRun(
  db: NeonQuery,
  id: number,
  input: { status?: JarvisRun["status"]; findings_count?: number; problems_detected?: number; recommendations_created?: number; safe_actions_taken?: number; errors?: unknown[] },
): Promise<JarvisRun | null> {
  return byId(await db`
    UPDATE jarvis_runs
    SET status = COALESCE(${input.status}, status),
        completed_at = ${now()},
        findings_count = COALESCE(${input.findings_count}, findings_count),
        problems_detected = COALESCE(${input.problems_detected}, problems_detected),
        recommendations_created = COALESCE(${input.recommendations_created}, recommendations_created),
        safe_actions_taken = COALESCE(${input.safe_actions_taken}, safe_actions_taken),
        errors = ${JSON.stringify(input.errors ?? [])}
    WHERE id = ${id}
    RETURNING *
  `) as JarvisRun | null;
}
export async function listRuns(db: NeonQuery, runType?: string): Promise<JarvisRun[]> {
  if (runType) {
    return (await db`
      SELECT * FROM jarvis_runs WHERE run_type = ${runType} ORDER BY started_at DESC
    `) as JarvisRun[];
  }
  return (await db`SELECT * FROM jarvis_runs ORDER BY started_at DESC`) as JarvisRun[];
}

/* ─────────────────────────── OWNER STATUS ─────────────────────────── */
export async function getOwnerStatus(db: NeonQuery): Promise<OwnerStatus> {
  return (byId(await db`SELECT * FROM owner_status WHERE id = 1`) ?? {
    id: 1,
    availability: "available",
    updated_at: now(),
  }) as OwnerStatus;
}
export async function setOwnerStatus(db: NeonQuery, availability: OwnerAvailability): Promise<OwnerStatus> {
  await db`
    INSERT INTO owner_status (id, availability, updated_at)
    VALUES (1, ${availability}, ${now()})
    ON CONFLICT (id) DO UPDATE SET availability = EXCLUDED.availability, updated_at = EXCLUDED.updated_at
  `;
  return getOwnerStatus(db);
}
