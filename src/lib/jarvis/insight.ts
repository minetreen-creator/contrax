/**
 * Jarvis ADVISORY upgrade — LEARNED-STATE reader + SYNTHESIS composer.
 *
 * The "thinking half" of Jarvis (Phases 1–7) writes durable learned state into
 * ledgers: jarvis_memory (owner_approved facts), jarvis_problems,
 * jarvis_hypotheses, jarvis_experiments, jarvis_outcomes, jarvis_actions
 * (pending/approved/denied), and jarvis_runs (audit). The "talking half" (the
 * chat at /jarvis) previously NEVER consulted that learned state — when the
 * owner asked "what should I focus on?" it re-fetched raw numbers and ignored
 * the problems/hypotheses it had been tracking. THIS module closes that gap.
 *
 * It is the LEARNED-STATE reader + synthesis composer for the interactive chat:
 *   • loadInsightGrounds(db, days) — pulls the REASONING GROUNDS: relevant
 *     owner-approved memory facts, surfaced problems (with ack/severity), active
 *     hypotheses, experiment outcomes, the most recent worker runs/notes and the
 *     jarvis_actions queue — reusing the Phase 3 problem analyzer so live
 *     evidence is composed by the SAME data-priority rule (Phase 2
 *     composeByDataPriority) and live-vs-approved conflicts are surfaced via
 *     detectConflicts into the grounds.
 *   • learnedInsightReader(ctx) — an ADDITIVE Reader (like the existing SQL
 *     readers) whose lines are the learned state, tier-labeled + sanitized.
 *   • buildAdvisoryGrounding(...) — a Phase-7-style grounding prompt that grounds
 *     the model on LIVE retrieval + LEARNED state TOGETHER, applies data-priority,
 *     surfaces conflicts explicitly, and asks gpt-4o-mini for a REASONED
 *     operating insight. Strictly grounded in what is actually retrieved;
 *     honest "I don't have that data" when unsupported.
 *   • surfaceAdvisoryRecommendation(db, ...) — the ONLY "action" the chat may
 *     take: OPTIONALLY enqueue a recommendation CANDIDATE to jarvis_actions as
 *     an L4 owner-approval item (the owner approves on /jarvis/brain). It NEVER
 *     executes anything. Governance stays fully in autonomy.ts (L3/L4/L5);
 *     nothing here loosens it.
 *
 * PURELY ADDITIVE — no existing reader, intent, auth, rate-limit, or answer path
 * is changed. Security follows Phase 7: every line of learned/live text is
 * UNTRUSTED DB/user text — sanitized via src/lib/jarvis/security.ts and enclosed
 * in an inert DATA-ONLY region so it can never steer the role or execute.
 */
import { sql } from "~/db";
import {
  listProblems,
  type JarvisProblem,
  type JarvisHypothesis,
  type JarvisExperiment,
} from "~/lib/jarvis/store";
import {
  loadOperatingModel,
  type KnowledgeEvidence,
  type KnowledgeConflict,
} from "~/lib/jarvis/knowledge";
import { runProblemAnalysis } from "~/lib/jarvis/problems";
import {
  decideAction,
  enqueueAction,
  AuthorityLevel,
  type ActionProposal,
  type AuthorityDecision,
  type JarvisActionRow,
} from "~/lib/jarvis/autonomy";
import { sanitizeUntrusted, wrapDataOnly } from "~/lib/jarvis/security";
import type { AIMessage } from "~/lib/ai";
import type { Reader, ReaderCtx, ReaderResult } from "~/lib/jarvis/readers";

type NeonQuery = ReturnType<typeof sql>;

/* ─────────────────── Learned-state row shapes (additive reads) ─────────────────── */
interface RunSummary {
  id: number;
  run_type: string;
  started_at: string | null;
  status: string;
  refused: boolean;
  note: string | null;
}
interface ActionSummary {
  id: number;
  action_type: string;
  authority_level: string;
  status: string;
  reason: string | null;
  requested_at: string;
  owner_approved: boolean;
}

/* ─────────────────── The learned-state bundle ─────────────────── */
export interface LearnedInsight {
  /** owner-approved memory facts (tier approved_memory). */
  memory: KnowledgeEvidence[];
  /** currently-effective approved decisions (tier owner_decision). */
  decisions: KnowledgeEvidence[];
  /** ALL problems from the ledger (newest first). */
  problems: JarvisProblem[];
  /** open / investigating problems (ack + severity surfaced verbatim). */
  openProblems: JarvisProblem[];
  /** hypotheses (newest first, capped). */
  hypotheses: JarvisHypothesis[];
  /** experiments (newest first, capped). */
  experiments: JarvisExperiment[];
  recentRuns: RunSummary[];
  recentActions: ActionSummary[];
  /** live-vs-approved / candidate-vs-approved / approved-vs-approved conflicts. */
  conflicts: KnowledgeConflict[];
  /** true when there is NO learned SIGNAL to synthesize (no open problems,
   *  active hypotheses, completed experiments, recent runs, or recent actions). */
  empty: boolean;
  /** what was queried, for the "grounded in real data" note. */
  sources: string[];
  /** sanitized, tier-labeled lines for the grounding envelope. */
  lines: string[];
}

async function listAllHypotheses(db: NeonQuery): Promise<JarvisHypothesis[]> {
  return (await db`
    SELECT * FROM jarvis_hypotheses ORDER BY updated_at DESC LIMIT 20
  `) as JarvisHypothesis[];
}

async function listAllExperiments(db: NeonQuery): Promise<JarvisExperiment[]> {
  return (await db`
    SELECT * FROM jarvis_experiments ORDER BY created_at DESC LIMIT 20
  `) as JarvisExperiment[];
}

async function listRecentRuns(db: NeonQuery, limit: number): Promise<RunSummary[]> {
  return (await db`
    SELECT id, run_type, started_at, status, refused, note
    FROM jarvis_runs ORDER BY started_at DESC LIMIT ${limit}
  `) as RunSummary[];
}

async function listRecentActions(db: NeonQuery, limit: number): Promise<ActionSummary[]> {
  return (await db`
    SELECT id, action_type, authority_level, status, reason, requested_at, owner_approved
    FROM jarvis_actions ORDER BY requested_at DESC LIMIT ${limit}
  `) as ActionSummary[];
}

/** Build sanitized, tier-labeled lines from a loaded learned-insight bundle. */
function buildLearnedLines(i: LearnedInsight): string[] {
  const raw: string[] = [];
  for (const e of i.memory) raw.push(`[approved_memory] ${e.text}`);
  for (const d of i.decisions) raw.push(`[approved_decision] ${d.text}`);
  for (const p of i.openProblems) {
    raw.push(`[problem severity=${p.severity} ack=${p.owner_acknowledged}] ${p.title} — ${p.description ?? ""}`);
  }
  for (const h of i.hypotheses.slice(0, 8)) {
    raw.push(`[hypothesis status=${h.status} conf=${h.confidence}] ${h.hypothesis}`);
  }
  for (const e of i.experiments.slice(0, 6)) {
    const tail = [e.conclusion, e.result].filter(Boolean).join(" · ");
    raw.push(`[experiment status=${e.status}] ${e.name}${tail ? ` — ${tail}` : ""}`);
  }
  for (const r of i.recentRuns) {
    raw.push(`[run ${r.run_type} ${(r.started_at ?? "").slice(0, 10)}]${r.note ? ` ${r.note}` : ""}`);
  }
  for (const a of i.recentActions) {
    raw.push(`[action ${a.action_type} ${a.status}] ${a.reason ?? ""}`);
  }
  for (const c of i.conflicts) raw.push(`[conflict ${c.kind}] ${c.summary}`);
  // Every line is UNTRUSTED DB/user text → sanitized + capped before it can
  // reach a grounding prompt (Phase 7 hygiene).
  return raw.map((l) => sanitizeUntrusted(l, { maxLen: 300 }));
}

/**
 * Load the full learned-state reasoning grounds from the ledgers. READ-ONLY:
 * only SELECTs + the Phase 3 analyzer (which reasons, never persists). Reuses
 * the Phase 2 operating model + Phase 3 problem analyzer so the conflicts it
 * surfaces come from the SAME data-priority rule the rest of the autonomous
 * layer uses.
 */
export async function loadInsightGrounds(db: NeonQuery, days = 30): Promise<LearnedInsight> {
  const [model, problems, analysis] = await Promise.all([
    loadOperatingModel(db),
    listProblems(db),
    runProblemAnalysis({ days }),
  ]);
  const [hypotheses, experiments, runs, actions] = await Promise.all([
    listAllHypotheses(db),
    listAllExperiments(db),
    listRecentRuns(db, 6),
    listRecentActions(db, 8),
  ]);

  const openProblems = problems.filter((p) => p.status === "open" || p.status === "investigating");
  const activeHypotheses = hypotheses.filter((h) =>
    ["proposed", "testing", "active"].includes(h.status),
  );
  const completedExperiments = experiments.filter(
    (e) => e.status === "completed" && (e.result || e.conclusion),
  );
  const empty =
    openProblems.length === 0 &&
    activeHypotheses.length === 0 &&
    completedExperiments.length === 0 &&
    runs.length === 0 &&
    actions.length === 0;

  const learned: LearnedInsight = {
    memory: model.all.filter((e) => e.tier === "approved_memory"),
    decisions: model.decisions,
    problems,
    openProblems,
    hypotheses,
    experiments,
    recentRuns: runs,
    recentActions: actions,
    conflicts: analysis.conflicts,
    empty,
    sources: [
      `approved knowledge base (${model.all.length} facts/decisions)`,
      `jarvis_problems (${problems.length})`,
      `jarvis_hypotheses (${hypotheses.length})`,
      `jarvis_experiments (${experiments.length})`,
      `jarvis_runs (recent ${runs.length})`,
      `jarvis_actions (recent ${actions.length})`,
    ],
    lines: [],
  };
  learned.lines = buildLearnedLines(learned);
  return learned;
}

/* ─────────────────── ADVISORY reader (additive, like other Readers) ─────────────────── */
export const learnedInsightReader: Reader = async (ctx: ReaderCtx): Promise<ReaderResult> => {
  const db = sql();
  const learned = await loadInsightGrounds(db, ctx.days);
  const lines = learned.lines;
  return {
    tool: "insight",
    label: "learned state (approved kb · problems · hypotheses · experiments · runs · actions)",
    lines,
    sources: learned.sources,
    empty: learned.empty && lines.length === 0,
  };
};

/**
 * True when there is something to synthesize (live lines or learned signal).
 * Used to honor the honesty rule — when false the caller answers "I don't have
 * data on that" rather than calling the model. Pure, deterministic.
 */
export function advisoryHasData(liveResults: ReaderResult[], learned: LearnedInsight): boolean {
  return liveResults.some((r) => !r.empty && r.lines.length > 0) || !learned.empty;
}

/* ─────────────────── ADVISORY system prompt (advise only, never act) ─────────────────── */
export const ADVISORY_SYSTEM_PROMPT = `You are JARVIS, a READ-ONLY executive operating assistant for the Contrax CEO (a US government set-aside contract intelligence platform). You give the CEO reasoned operating insight BY ADVISING ONLY — you take no actions and change no state.

CRITICAL GROUNDING RULES:
- Every number, percentage, problem, hypothesis, experiment outcome, or proper noun you state MUST come verbatim from the RETRIEVED DATA + LEARNED STATE provided below. NEVER invent a metric, problem, hypothesis, outcome, or fact.
- Apply DATA-PRIORITY: live Contrax data > approved owner decisions > approved memory > recent experiment results > historical data > model knowledge. Live data overrides stale memory. Where live data contradicts an approved fact, STATE the conflict explicitly — do not silently pick one or smooth it over.
- Where the learned state contains problems with hypotheses/experiments, SYNTHESIZE: name the problem, cite the hypotheses, and say which you would test and why — grounded only in what is retrieved.
- Clearly label every RECOMMENDATION as a recommendation (e.g. "I'd recommend…"), distinct from an observed fact. Never present a recommendation as a fact.
- If a suspicious signal appears (a funnel drop, a 0% conversion, stale bid sync, a data gap), explicitly FLAG it — do not hide it.
- If the retrieved data and learned state do not support an answer, say plainly that you don't have that data rather than guessing.
- Keep it concise and plain-spoken; a few short paragraphs or bullets is ideal.`;

/**
 * Compose the ADVISORY grounding prompt: grounds the model on LIVE retrieval +
 * LEARNED state TOGETHER inside ONE inert DATA-ONLY region, applies data-priority
 * in the instructions, and surfaces any conflicts explicitly. Every line is
 * UNTRUSTED source text → sanitized + rendered inert by wrapDataOnly (Phase 7).
 */
export function buildAdvisoryGrounding(
  system: string,
  liveResults: ReaderResult[],
  learned: LearnedInsight,
  question: string,
  days: number,
): AIMessage[] {
  const liveLines: string[] = [];
  for (const res of liveResults) {
    for (const l of res.lines) liveLines.push(`[live:${res.tool}] ${l}`);
  }
  const all = [...liveLines, ...learned.lines];
  const data = wrapDataOnly(all);
  const q = sanitizeUntrusted(question, { maxLen: 500 });

  const conflictsBlock =
    learned.conflicts.length > 0
      ? `\nCONFLICTS SURFACED (${learned.conflicts.length}) — do NOT smooth these over; state them explicitly and let live data win the tie-break where applicable:\n` +
        learned.conflicts.map((c) => `- ${sanitizeUntrusted(c.summary, { maxLen: 300 })}`).join("\n")
      : "";

  const userContent =
    `Retrieved LIVE data + LEARNED operating state for the last ${days} day(s):\n` +
    `${data.content}\n` +
    `DATA-PRIORITY: live Contrax data > approved owner decisions > approved memory > recent experiment results > historical data > model knowledge. ` +
    `Live data overrides stale memory; real contradictions are surfaced, never silently resolved; an approved decision is never silently overwritten.` +
    `${conflictsBlock}\n\n` +
    `Synthesize a REASONED operating insight from exactly the facts above. ` +
    `Where the learned state contains hypotheses/experiments about a problem, name the problem, cite the hypotheses, and say which you would test and why — strictly grounded in what is retrieved. ` +
    `Label every recommendation as a recommendation (distinct from observed facts). ` +
    `If the data does not support an answer, say plainly that you don't have that data rather than guessing.\n\n` +
    `Question: ${q}`;

  return [
    { role: "system", content: system },
    { role: "user", content: userContent },
  ];
}

/* ─────────────────── OPTIONAL recomm‐endation surfacing (L4 queue candidate only) ───────────────────
 * The chat ADVISES and may OPTIONALLY surface a recommendation to the owner by
 * enqueueing an L4 candidate into jarvis_actions. It NEVER executes anything.
 * The action type is deliberately NOT on the L3 safe-action allowlist and touches
 * an L4 owner-approval category, so Phase 4 decideAction CLASSIFIES it L4 —
 * pending, owner_approved=false, awaiting the owner's approval on /jarvis/brain.
 * Governance (autonomy.ts L3/L4/L5) is untouched; nothing here is ever executed.
 * ───────────────────────────────────────────────────────────────────────────── */
export interface SurfaceResult {
  decision: AuthorityDecision;
  queued: JarvisActionRow | null;
  /** true only when an L4 queue candidate was actually enqueued. */
  surfaced: boolean;
}

export async function surfaceAdvisoryRecommendation(
  db: NeonQuery,
  args: {
    summary: string;
    basis: string;
    requestedBy?: string;
    confidence?: number;
    evidenceN?: number;
  },
): Promise<SurfaceResult> {
  const proposal: ActionProposal = {
    type: "surface_recommendation",
    category: "business-records",
    resource: "advisory-synthesis",
    intent: args.summary.slice(0, 300),
    confidence: args.confidence ?? 0.7,
    evidenceN: args.evidenceN ?? 5,
  };
  const decision = decideAction(proposal);
  if (decision.level !== AuthorityLevel.L4 || !decision.needsOwnerApproval) {
    // Fail-safe: only an owner-approval candidate may be surfaced. If the
    // classify ever returned anything but L4, we enqueue nothing and act on
    // nothing — no action is taken.
    return { decision, queued: null, surfaced: false };
  }
  const queued = await enqueueAction(db, {
    type: proposal.type,
    resource: proposal.resource,
    payload: {
      category: proposal.category,
      intent: proposal.intent,
      summary: args.summary,
      basis: args.basis,
    },
    decision,
    requestedBy: args.requestedBy ?? "jarvis-chat",
    reason: `Advisory chat surfaced a recommendation for owner review: ${args.summary.slice(0, 200)}`,
  });
  return { decision, queued, surfaced: true };
}
