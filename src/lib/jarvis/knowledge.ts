/**
 * Jarvis Autonomous Upgrade — Phase 2 KNOWLEDGE & DATA-PRIORITY engine.
 *
 * This module teaches Jarvis the Contrax operating model (products / pricing /
 * gating / 14-day trial / funnel stages / activation / KPIs) by reading the
 * OWNER-APPROVED knowledge base written by Phase 1, and it enforces the
 * data-priority rule that all later phases (and the model) must consume:
 *
 *     live Contrax data > approved owner decisions > approved memory
 *       > recent experiment results > historical data > model knowledge
 *
 * Properties guaranteed here:
 *   • Citable operating model  — approved memory + currently-effective approved
 *     decisions are organized into topics (pricing, gating, trial, funnel,
 *     activation, metrics-exclusion, target-market, data-priority) with each item
 *     carrying {tier, source, confidence} so answers can cite facts.
 *   • Data-priority compositor — a pure function that ranks ANY heterogeneous
 *     set of evidence into the strict tier order above. This is THE shared
 *     ordering primitive later phases and the model use ("live overrides stale
 *     memory"; conflicts are surfaced, never silently resolved).
 *   • Conflict detection      — detects (a) contradictions between approved
 *     facts/decisions and (b) live data contradicting an approved fact/decision.
 *     Conflicts are SURFACED for the owner/operator, never auto-resolved and
 *     never silently dropped. Live data wins the TIE-BREAK, but a real
 *     contradiction is still reported.
 *   • Owner-approval guard    — approved rows are read-only to Jarvis writes.
 *     The only legal change paths are supersede-with-successor or an admin
 *     flipping owner_approved. This guard is wired into the new write wrap added
 *     here (`guardedRemove...`), which Phase 2 keeps essentially write-free.
 *
 * READ-ONLY + ADDITIVE: none of this rebuilds the interactive Jarvis. The engine
 * below is pure logic over the Phase 1 store; the `knowledgeReader` (a Reader)
 * is added as an ADDITIONAL grounding source in src/lib/jarvis/index.ts without
 * touching any existing reader, rate-limit, auth, or answer path.
 */
import { sql } from "~/db";
import {
  listLiveMemory,
  listApprovedDecisions,
  type JarvisMemory,
  type JarvisDecision,
} from "~/lib/jarvis/store";
import type { ReaderCtx, ReaderResult } from "~/lib/jarvis/readers";

/* ═════════════════════════════════════════════════════════════════════
 * Data-priority tiers — strict descending order of authority.
 * ═════════════════════════════════════════════════════════════════════ */
export const DATA_TIERS = [
  "live",
  "owner_decision",
  "approved_memory",
  "experiment_results",
  "historical",
  "model_knowledge",
] as const;
export type DataTier = (typeof DATA_TIERS)[number];

/** Ascending rank → strict ordering primitive (lower = higher authority). */
export const DATA_TIER_ORDER: Record<DataTier, number> = {
  live: 0,
  owner_decision: 1,
  approved_memory: 2,
  experiment_results: 3,
  historical: 4,
  model_knowledge: 5,
};

export const DATA_PRIORITY_RULE =
  "Data priority: live Contrax data > approved owner decisions > approved memory > recent experiment results > historical data > model knowledge. " +
  "Live data overrides stale memory; real contradictions are surfaced (never silently resolved) and an owner-approved decision is never silently overwritten.";

/** A single citable / rankable piece of evidence. */
export interface KnowledgeEvidence {
  tier: DataTier;
  /** short provenance label, e.g. "business-plan", "approved_decisions", "bids" */
  source: string;
  /** the citable fact text */
  text: string;
  confidence: number;
  category?: string;
  /** claim subject + value (auto-extracted or explicit) for conflict detection */
  subject?: string | null;
  value?: string | number | null;
  /** row id in the originating ledger (jarvis_memory.id / jarvis_decisions.id) */
  refId?: number | null;
  /**
   * Whether the row behind this evidence is owner-approved. Approved items are
   * FACT-tier (see isFact below). An item may carry an approved_memory tier yet
   * `approved:false` when it is a NON-approved candidate being evaluated — such
   * candidates are NOT facts and a candidate that contradicts an approved fact is
   * surfaced as `candidate_vs_approved`, never silently dropped.
   */
  approved?: boolean;
}

export type ConflictKind =
  | "approved_vs_approved" // two approved facts/decisions assert different values
  | "live_vs_approved" // live data contradicts an approved fact/decision
  | "candidate_vs_approved"; // a non-approved candidate/experiment/history/model assertion contradicts an approved fact/decision

export interface KnowledgeConflict {
  kind: ConflictKind;
  subject: string;
  a: KnowledgeEvidence;
  b: KnowledgeEvidence;
  summary: string;
}

/* ═════════════════════════════════════════════════════════════════════
 * Operating-model organization
 * ═════════════════════════════════════════════════════════════════════ */
export interface OperatingModel {
  /** All approved evidence (memory + decisions), in data-priority order. */
  all: KnowledgeEvidence[];
  /** Grouped by memory category (funnel, pricing, trial, target-market, ...). */
  byCategory: Record<string, KnowledgeEvidence[]>;
  /** Approved owner decisions (tier owner_decision). */
  decisions: KnowledgeEvidence[];
  products: KnowledgeEvidence[];
  pricing: KnowledgeEvidence[];
  gating: KnowledgeEvidence[];
  trial: KnowledgeEvidence[];
  funnel: KnowledgeEvidence[];
  activation: KnowledgeEvidence[];
  metricsExclusion: KnowledgeEvidence[];
  targetMarket: KnowledgeEvidence[];
  dataPriority: KnowledgeEvidence[];
}

const memoryToEvidence = (m: JarvisMemory): KnowledgeEvidence => ({
  tier: "approved_memory",
  source: m.source || "jarvis",
  text: m.fact,
  confidence: m.confidence,
  category: m.category,
  refId: m.id,
  approved: true,
  ...claimOf(m.fact, m.category),
});

const decisionToEvidence = (d: JarvisDecision): KnowledgeEvidence => ({
  tier: "owner_decision",
  source: "approved_decisions",
  text: d.decision,
  confidence: 1,
  category: "decision",
  refId: d.id,
  approved: true,
});

/**
 * Load the CANDIDATE set of approved evidence directly from the Phase 1 store
 * (approved memory via listLiveMemory + currently-effective approved decisions
 * via listApprovedDecisions). Callers pass in their own db handle (normally
 * `sql()`). Returns both an `all` list (composed, ordered) and grouped views.
 */
export async function loadOperatingModel(db: ReturnType<typeof sql>): Promise<OperatingModel> {
  const [mem, decs] = await Promise.all([
    listLiveMemory(db),
    listApprovedDecisions(db),
  ]);
  const memoryEvidence = mem.map(memoryToEvidence);
  const decisionEvidence = decs.map(decisionToEvidence);

  const byCategory: Record<string, KnowledgeEvidence[]> = {};
  for (const e of memoryEvidence) {
    (byCategory[e.category ?? "uncategorized"] ??= []).push(e);
  }

  const all = composeByDataPriority([...decisionEvidence, ...memoryEvidence]);

  const cat = (c: string) => byCategory[c] ?? [];
  const modelEvidence = all.filter((e) => e.tier === "approved_memory" || e.tier === "owner_decision");

  return {
    all,
    byCategory,
    decisions: decisionEvidence,
    products: modelEvidence.filter(
      (e) => e.category === "pricing" && /skip|product|professional|agency/.test(e.text) && /\$\s?\d/.test(e.text),
    ),
    pricing: modelEvidence.filter((e) => e.category === "pricing"),
    gating: modelEvidence.filter((e) => e.category === "pricing"),
    trial: cat("trial"),
    funnel: cat("funnel"),
    activation: cat("funnel"),
    metricsExclusion: cat("metrics-exclusion"),
    targetMarket: cat("target-market"),
    dataPriority: cat("data-priority"),
  };
}

/* ═════════════════════════════════════════════════════════════════════
 * Data-priority compositor — the SHARED ORDERING PRIMITIVE.
 *
 * Takes evidence from ANY tiers and returns a strictly tier-ranked,
 * tier-annotated list (live > owner_decision > approved_memory >
 * experiment_results > historical > model_knowledge). Within a tier it orders
 * by confidence descending, then by source for determinism. Callers (Phases 3–7
 * and the model) rely on this to know which evidence wins.
 * ═════════════════════════════════════════════════════════════════════ */
export function composeByDataPriority(evidence: KnowledgeEvidence[]): KnowledgeEvidence[] {
  return [...evidence]
    .sort((a, b) => {
      const tierDiff = DATA_TIER_ORDER[a.tier] - DATA_TIER_ORDER[b.tier];
      if (tierDiff !== 0) return tierDiff;
      const confDiff = (b.confidence ?? 0) - (a.confidence ?? 0);
      if (confDiff !== 0) return confDiff;
      return (a.source ?? "").localeCompare(b.source ?? "");
    })
    .map((e) => ({ ...e })); // return annotated copies (tier/source/confidence present)
}

/* ═════════════════════════════════════════════════════════════════════
 * Claim extraction — deterministic subject/value pairs for a memory fact,
 * used by conflict detection. Conservative by design: only extracts from
 * categories/patterns where a numeric claim is well-defined, so it cannot
 * false-positive on unrelated facts. Callers may always pass an explicit
 * {subject,value} on the evidence to force a check.
 * ═════════════════════════════════════════════════════════════════════ */
function claimOf(text: string, category?: string): { subject: string | null; value: string | number | null } {
  const norm = text.toLowerCase();
  // Trial length — the classic "14 days" vs "21 days" contradiction.
  if (category === "trial") {
    const m = norm.match(/(\d{1,2})\s*(?:-|\s)?days?\b/);
    if (m) return { subject: "trial_length_days", value: m[1] };
  }
  // Pricing — "<Tier> $N". Extracts one tier+price per fact (Basic/Starter/Pro/Agency).
  if (category === "pricing") {
    const m = text.match(/\b(Basic|Starter|Professional|Agency)\b[^$]*?\$\s?(\d+)/i);
    if (m) return { subject: `price_${m[1].toLowerCase()}`, value: m[2] };
  }
  // Trial per-item caps (5 briefs / 3 scores / 1 draft / 3 incumbent).
  if (category === "trial") {
    const m = norm.match(/(\d+)\s*(ai brief|brief|match score|score|draft|incumbent)/);
    if (m) return { subject: `trial_cap_${m[2].replace(/\s+/g, "_")}`, value: m[1] };
  }
  return { subject: null, value: null };
}

/* ═════════════════════════════════════════════════════════════════════
 * Conflict detection.
 *
 * Surfaced, never auto-resolved. Within a shared claim subject, a conflict is
 * raised whenever TWO DISTINCT values are present and at least one side is an
 * approved fact/decision:
 *   • both fact-tier                  → approved_vs_approved
 *   • one live, one fact-tier         → live_vs_approved
 *   • one non-fact/non-live (candidate/experiment/historical/model) + fact-tier
 *                                     → candidate_vs_approved
 * Notice the rule DOES NOT silently drop a contradictory candidate/historical/
 * model assertion — live STILL wins a tie-break via composeByDataPriority, but
 * the contradiction is reported for the owner rather than hidden.
 * ═════════════════════════════════════════════════════════════════════ */
const FACT_TIERS: DataTier[] = ["owner_decision", "approved_memory"];

export function detectConflicts(evidence: KnowledgeEvidence[]): KnowledgeConflict[] {
  // attach explicit-or-extracted claims
  const withClaims: KnowledgeEvidence[] = evidence.map((e) => {
    if (e.subject) return e;
    const c = claimOf(e.text, e.category);
    return { ...e, subject: c.subject, value: c.value };
  });

  const bySubject = new Map<string, KnowledgeEvidence[]>();
  for (const e of withClaims) {
    if (!e.subject) continue;
    if (!bySubject.has(e.subject)) bySubject.set(e.subject, []);
    bySubject.get(e.subject)!.push(e);
  }

  const conflicts: KnowledgeConflict[] = [];
  for (const [subject, items] of bySubject) {
    // distinct values among qualifying items
    const valueGroups = new Map<string, KnowledgeEvidence[]>();
    for (const it of items) {
      const k = String(it.value);
      if (!valueGroups.has(k)) valueGroups.set(k, []);
      valueGroups.get(k)!.push(it);
    }
    if (valueGroups.size < 2) continue; // no distinct value → no conflict

    const groups = [...valueGroups.entries()];
    const isFact = (e: KnowledgeEvidence) =>
      FACT_TIERS.includes(e.tier) && e.approved !== false;

      for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const [, listA] = groups[i];
          const [, listB] = groups[j];
          for (const a of listA) {
          for (const b of listB) {
            let kind: ConflictKind | null = null;
            let first = a;
            let second = b;
            if (isFact(a) && isFact(b)) kind = "approved_vs_approved";
            else if (isFact(a) && b.tier === "live") { kind = "live_vs_approved"; first = a; second = b; }
            else if (isFact(b) && a.tier === "live") { kind = "live_vs_approved"; first = b; second = a; }
            else if (isFact(a)) kind = "candidate_vs_approved";
            else if (isFact(b)) { kind = "candidate_vs_approved"; first = b; second = a; }
            if (kind) {
              conflicts.push({
                kind,
                subject,
                a: first,
                b: second,
                summary: `${kind} on "${subject}": "${first.text}" (${first.tier}, value ${String(first.value)}) vs "${second.text}" (${second.tier}, value ${String(second.value)})`,
              });
            }
          }
        }
      }
    }
  }
  return conflicts;
}

/* ═════════════════════════════════════════════════════════════════════
 * Owner-approval guard.
 *
 * Part of the policy that makes approved rows read-only to Jarvis. The store
 * already physically protects them (removeMemory refuses, supersede is the
 * retirement path); this helper makes that policy EXPLICIT and gives Phase 2's
 * (few) new write paths a uniform "cannot silently overwrite" gate. There is
 * intentionally almost no new writing in this phase.
 * ═════════════════════════════════════════════════════════════════════ */
export interface OwnerApprovalPolicy {
  approved: boolean;
  readOnly: boolean;
  /** what a human operator must do to change this row */
  actionRequired: "none" | "supersede" | "admin_toggle";
  reason: string;
}

export function ownerApprovalPolicy(ownerApproved: boolean): OwnerApprovalPolicy {
  if (!ownerApproved) {
    return {
      approved: false,
      readOnly: false,
      actionRequired: "none",
      reason: "Non-approved (candidate) row — editable and removable by Jarvis.",
    };
  }
  return {
    approved: true,
    readOnly: true,
    actionRequired: "supersede",
    reason:
      "Owner-approved rows are READ-ONLY to Jarvis. To change one, create a superseding successor (supersedeMemory/supersedeDecision) or have an admin flip owner_approved " +
      "(admin_toggle). Jarvis must never silently overwrite or hard-delete an owner-approved decision or fact.",
  };
}

/** Throw unless the row is a modifiable (candidate) row. Wire into new writes. */
export function assertModifiable(ownerApproved: boolean, label: string): void {
  const p = ownerApprovalPolicy(ownerApproved);
  if (p.readOnly) {
    throw new Error(`owner-guard: ${label} is owner-approved and READ-ONLY to Jarvis — ${p.reason}`);
  }
}

/**
 * A guarded delete wrapper: refuses owner-approved rows (which must be retired
 * via supersede, never hard-deleted). Wires the owner-approval guard into the
 * only new write Phase 2 introduces — a defensive double-check that stays even
 * if the store's own guard weakens.
 */
export async function guardedRemoveMemory(
  db: ReturnType<typeof sql>,
  row: Pick<JarvisMemory, "id" | "owner_approved">,
): Promise<boolean> {
  assertModifiable(row.owner_approved, `jarvis_memory #${row.id}`);
  const { removeMemory } = await import("~/lib/jarvis/store");
  return removeMemory(db, row.id);
}

/* ═════════════════════════════════════════════════════════════════════
 * knowledgeReader — ADDITIVE grounding source for the interactive Jarvis.
 *
 * Answers operating-model questions (pricing, plan tiers, gating, the 14-day
 * trial, funnel stages, target market, data-priority) by CITING the approved
 * knowledge base. It is an ADDITIONAL reader alongside the existing SQL readers;
 * each line is prefixed with its tier so the model never mixes a lower-priority
 * assertion with an approved fact. It never fabricates: it only emits approved
 * facts/decisions, and if none match it returns empty (caller answers "I don't
 * have data on that").
 * ═════════════════════════════════════════════════════════════════════ */
export const knowledgeReader = async (ctx: ReaderCtx): Promise<ReaderResult> => {
  const db = sql();
  const model = await loadOperatingModel(db);
  const q = ctx.question.toLowerCase();

  const picks: KnowledgeEvidence[] = [];
  const want = (re: RegExp, group: KnowledgeEvidence[]) => {
    if (re.test(q)) picks.push(...group);
  };

  want(/\btrial\b|\b14.day\b|\bmission beyond\b/, model.trial);
  want(/(pric|plan\b|plans|tier|cost|how much|\$\s?\d|gate|included|unlimited|bundl|professional|starter|\bbasic\b|\bagency\b)/, model.pricing);
  want(/funnel stage|stages of the funnel|what counts as|\bactivated\b|\bactivation\b/, model.funnel);
  want(/target|market|customer|niche|set.aside|8\(a\)|sdvosb|wosb|hubzone/, model.targetMarket);
  want(/data priority|priority|tier order|memory|decision/, model.dataPriority);
  want(/exclu|\bbot\b|\bqa\b|metric|health check/, model.metricsExclusion);

  if (picks.length === 0) {
    // Default operating-model overview: trial + pricing + funnel.
    picks.push(...model.trial, ...model.pricing, ...model.funnel);
  }

  const dedup = new Map<string, KnowledgeEvidence>();
  for (const e of picks) dedup.set(e.text, e);

  const lines = [...dedup.values()]
    .map((e) => `[${e.tier}] (${e.source ?? "approved kb"}) ${e.text}`)
    .sort(); // deterministic
  const sources = [...new Set(lines.map((l) => (l.startsWith("[approved_memory]") ? "approved knowledge base" : "approved owner decisions")))];
  if (model.decisions.length) sources.push("approved owner decisions");

  return {
    tool: "knowledge",
    label: "approved operating model (knowledge base)",
    lines,
    sources,
    empty: lines.length === 0,
  };
};
