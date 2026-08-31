/**
 * Jarvis Autonomous Upgrade — Phase 4 AUTONOMY & GOVERNANCE (authority engine).
 *
 * Owner directive (ratified business plan rev 131):
 *   "Authority levels L0–L5; a narrow L3 safe-action allowlist; an L4
 *    owner-approval queue; L5 prohibited; and a self-modification ban."
 *
 * This module is the GOVERNANCE / AUTONOMY ENGINE on top of the already-live
 * Phases 1–3:
 *   • Phase 1 store  (src/lib/jarvis/store.ts)        — durable ledgers + type CRUD
 *   • Phase 2 knowledge (src/lib/jarvis/knowledge.ts) — data-priority, owner guard
 *   • Phase 3 problems (src/lib/jarvis/problems.ts)   — candidate-only problem solver
 *
 * What Phase 4 adds (PURELY ADDITIVE — nothing else is touched):
 *   • Authority levels L0–L5 (enum + ordered array with human labels).
 *   • Action classification: a proposed action maps to the MINIMUM authority
 *     level required. The L4 category set mirrors the owner's spec (anything
 *     touching email, prospects, customers, partners, site, pricing, trials,
 *     subscriptions, refunds, money, purchases, accounts, users, bids,
 *     business-records, prod-config, commit, merge, deploy, or any external
 *     side-effect). Everything that is not provably-L3 and not L5 falls to L4.
 *   • Narrow L3 safe-action allowlist — the ONLY things Jarvis may do without
 *     owner approval, checked explicitly.
 *   • L5 prohibited set — including the SELF-MODIFICATION BAN (changing its own
 *     code, config, prompts, or its own authority/approval rules), exfiltration
 *     of secrets / raw-IP / private-comms / voice, and anything deceptive.
 *   • Decision function `decideAction(action)` — PURE, deterministic, NO DB.
 *     Fail-safe: tiny-sample / uncertain / unknown / not-explicitly-allowed →
 *     L4 owner approval (never silently auto-approved).
 *   • Owner-approval QUEUE API over the new `jarvis_actions` ledger (migration
 *     024): enqueue / list pending / resolve (approve|deny). Approved actions
 *     are owner_approved=true and are NEVER hard-deleted.
 *
 * Prompt-injection hygiene: all DB / customer text that flows into this module
 * (action_type/resource/payload/intent) is treated as UNTRUSTED. It is never
 * executed — it is only ever classified against local constant allowlists /
 * deny-lists and persisted as opaque data. Nothing here sends text to a model.
 */
import { sql } from "~/db";

/* ═════════════════════════════════════════════════════════════════════
 * Authority levels L0–L5
 * ═════════════════════════════════════════════════════════════════════ */
export enum AuthorityLevel {
  L0 = "L0",
  L1 = "L1",
  L2 = "L2",
  L3 = "L3",
  L4 = "L4",
  L5 = "L5",
}

export interface AuthorityLevelInfo {
  level: AuthorityLevel;
  label: string;
  description: string;
  /** Whether Jarvis may act at this level WITHOUT owner approval. */
  selfAuthorized: boolean;
}

/** Ordered low→high authority. L0 is the least authority, L5 is prohibited. */
export const AUTHORITY_LEVELS: readonly AuthorityLevelInfo[] = [
  {
    level: AuthorityLevel.L0,
    label: "Observer",
    description: "Read-only observation and monitoring. No authority to change anything.",
    selfAuthorized: true,
  },
  {
    level: AuthorityLevel.L1,
    label: "Reporter",
    description: "Informational summaries, reports, and notes with no external effect.",
    selfAuthorized: true,
  },
  {
    level: AuthorityLevel.L2,
    label: "Internal candidate",
    description: "Low-risk writes to Jarvis's OWN candidate ledgers (administration) with no external side-effect.",
    selfAuthorized: true,
  },
  {
    level: AuthorityLevel.L3,
    label: "Safe autonomous action",
    description:
      "The NARROW allowlist of provably-safe, internal-only actions Jarvis may perform unsupervised " +
      "(rerun read-only analysis, refresh cached summaries, create/close its own problems + hypotheses on " +
      "objective criteria, record experiment measurements, prepare reports/recommendations/owner-review items).",
    selfAuthorized: true,
  },
  {
    level: AuthorityLevel.L4,
    label: "Owner approval required",
    description:
      "Actions with a real or external effect (email, prospects, customers, partners, site, pricing, trials, " +
      "subscriptions, refunds, money, purchases, accounts, users, bids, business-records, prod-config, commit, " +
      "merge, deploy, or any external side-effect) — and any uncertain/unknown action. Must go through the " +
      "owner-approval queue.",
    selfAuthorized: false,
  },
  {
    level: AuthorityLevel.L5,
    label: "Prohibited",
    description:
      "Never permitted: self-modification (own code/config/prompts/authority/approval rules), exfiltration of " +
      "secrets/raw-IP/private-comms/voice, deception, impersonation, fraud.",
    selfAuthorized: false,
  },
];

export const AUTHORITY_LEVEL_MAP: Record<AuthorityLevel, AuthorityLevelInfo> = Object.fromEntries(
  AUTHORITY_LEVELS.map((a) => [a.level, a]),
) as Record<AuthorityLevel, AuthorityLevelInfo>;

/* ═════════════════════════════════════════════════════════════════════
 * L4 owner-approval category set (mirrors the owner's ratified spec).
 * Anything touching one of these resource categories, OR any external
 * side-effect, requires owner approval. The fail-safe default also routes every
 * not-provably-L3 action here, so this set also serves the "reason" text.
 * ═════════════════════════════════════════════════════════════════════ */
export const L4_OWNER_APPROVAL_CATEGORIES: ReadonlySet<string> = new Set([
  "email",
  "prospects",
  "customers",
  "partners",
  "site",
  "pricing",
  "trials",
  "subscriptions",
  "refunds",
  "money",
  "purchases",
  "accounts",
  "users",
  "bids",
  "business-records",
  "prod-config",
  "commit",
  "merge",
  "deploy",
  "external-side-effect",
  // common aliases for the categories above (fail-safe: broader L4 never hurts)
  "billing",
  "payment",
  "stripe",
  "checkout",
  "marketplace",
  "publication",
  "release",
  "customer-facing",
]);

/* ═════════════════════════════════════════════════════════════════════
 * Narrow L3 safe-action allowlist — THE ONLY actions Jarvis may take without
 * owner approval. Everything here is internal-only: no external side-effect,
 * no customer/site/money impact, no mutable shared resources outside Jarvis's
 * own candidate ledgers.
 * ═════════════════════════════════════════════════════════════════════ */
export const L3_SAFE_ACTION_ALLOWLIST: ReadonlySet<string> = new Set([
  "rerun_readonly_analysis", // recompute an existing read-only analysis
  "refresh_cached_summary", // refresh a cached summary (no external effect)
  "create_jarvis_problem", // Jarvis-own problem candidate on objective criteria
  "close_jarvis_problem", // close a Jarvis-own problem candidate
  "create_jarvis_hypothesis", // Jarvis-own hypothesis candidate
  "update_jarvis_hypothesis", // update a Jarvis-own hypothesis candidate
  "update_experiment_measurement", // record a measurement on a Jarvis experiment
  "prepare_report", // draft/refresh a report (informational)
  "prepare_recommendation", // draft a recommendation for owner review
  "prepare_owner_review_item", // queue an item for the owner's review
]);

/* ═════════════════════════════════════════════════════════════════════
 * L5 PROHIBITED set — never permitted. Includes the SELF-MODIFICATION BAN and
 * exfiltration / deception. Deterministic; mirrored by keyword heuristics in
 * detectL5 so an untrusted intent describing one of these is also refused.
 * ═════════════════════════════════════════════════════════════════════ */
export const L5_PROHIBITED_ACTION_TYPES: ReadonlySet<string> = new Set([
  // ── SELF-MODIFICATION BAN ──
  "self_modify",
  "modify_own_code",
  "modify_own_script",
  "modify_own_config",
  "modify_own_prompts",
  "change_own_authority",
  "change_authority_rules",
  "change_approval_rules",
  "change_own_kill_switch",
  "rewrite_own_governance",
  // ── EXFILTRATION / PRIVACY ──
  "exfiltrate_secrets",
  "expose_secret",
  "send_raw_ip",
  "expose_private_communication",
  "expose_voice",
  // ── DECEPTION / FRAUD ──
  "deceptive_action",
  "impersonate",
  "fraud",
  "fabricate_metric",
  "cover_up",
]);

const L5_INTENT_SIGNALS: ReadonlySet<string> = new Set([
  "self-modification",
  "self modification",
  "modify your own code",
  "modify your code",
  "modify your own config",
  "change your own config",
  "change your authority",
  "change the approval rules",
  "edit yourself",
  "bypass approval",
  "skip approval",
  "override your rules",
  "grant yourself access",
  "expose the secret",
  "send the secret",
  "raw ip",
  "raw ip address",
  "ssh key",
  "api key",
  "private communication",
  "private messages",
  "voice recording",
  "deceive",
  "deceptive",
  "misrepresent",
  "conceal",
  "fabricate",
  "impersonate",
  "pretend to be",
]);

/**
 * INTENT-REDIRECT signals — an untrusted intent that tries to get Jarvis to do
 * something OTHER than the declared action type (prompt-injection style: "ignore
 * your instructions", "send email instead", "disregard that"). These never honor
 * the redirect; classify as UNCERTAIN and fall to owner approval (fail-safe).
 */
const INTENT_REDIRECT_SIGNALS: ReadonlySet<string> = new Set([
  "ignore",
  "ignore your instructions",
  "disregard",
  "never mind",
  "instead",
  "rather than",
  "switch to",
  "actually do",
  "don't do",
  "do not do",
  "forget that",
  "send email",
  "send_email",
  "pretend",
  "as if",
]);

/* ═════════════════════════════════════════════════════════════════════
 * Objective / uncertainty gates (fail-safe). Reuses Phase 3's min-sample
 * philosophy: a tiny sample or low confidence must NOT auto-approve anything.
 * ═════════════════════════════════════════════════════════════════════ */
/** Minimum evidence sample before an L3 objective action may auto-proceed. */
export const OBJECTIVE_MIN_SAMPLES = 5;
/** Minimum model/label confidence before an L3 objective action may proceed. */
export const OBJECTIVE_MIN_CONFIDENCE = 0.6;

/* ═════════════════════════════════════════════════════════════════════
 * Action proposal + decision
 * ═════════════════════════════════════════════════════════════════════ */
export interface ActionProposal {
  /** action type slug, e.g. "send_email", "create_jarvis_problem" */
  type: string;
  /** resource category domain (see L4_OWNER_APPROVAL_CATEGORIES) */
  category?: string;
  /** specific resource the action would touch */
  resource?: string;
  /** natural-language intent (UNTRUSTED — only used for L5 heuristic classification) */
  intent?: string;
  /** label/objective confidence 0..1 (low → fail-safe owner approval) */
  confidence?: number;
  /** number of qualifying observations behind the proposal (tiny → fail-safe) */
  evidenceN?: number;
  /** explicit deceptive/self-mod/exfil flags supplied by a caller/supervisor */
  flags?: string[];
}

export interface AuthorityDecision {
  /** minimum authority level required: L3 (self-authorized), L4 (owner) or L5 (prohibited) */
  level: AuthorityLevel.L3 | AuthorityLevel.L4 | AuthorityLevel.L5;
  /** true only for L3 — Jarvis may proceed without owner approval */
  allowed: boolean;
  /** true for L4 — must be enqueued and approved by the owner before acting */
  needsOwnerApproval: boolean;
  /** deterministic, human-readable justification */
  reason: string;
}

const norm = (s: string | undefined): string => (s ?? "").trim().toLowerCase();

function hasIntentSignal(intent: string | undefined): string | null {
  const i = norm(intent);
  if (!i) return null;
  for (const sig of L5_INTENT_SIGNALS) {
    if (i.includes(sig)) return sig;
  }
  return null;
}

/** True when an (untrusted) intent tries to redirect Jarvis to a different action. */
function intentRedirects(proposal: ActionProposal): string | null {
  const i = norm(proposal.intent);
  if (!i) return null;
  for (const sig of INTENT_REDIRECT_SIGNALS) {
    if (i.includes(sig)) return sig;
  }
  return null;
}

/**
 * Detect L5 (prohibited) reasons for an action. Pure + deterministic. Governs
 * self-modification, exfiltration, deception, impersonation, and fraud.
 */
export function detectL5(proposal: ActionProposal): string | null {
  const t = norm(proposal.type);
  if (L5_PROHIBITED_ACTION_TYPES.has(t)) {
    return `action type '${t}' is on the L5 prohibited list (${AUTHORITY_LEVEL_MAP[AuthorityLevel.L5].label})`;
  }
  const flags = proposal.flags ?? [];
  for (const f of flags) {
    if (L5_PROHIBITED_ACTION_TYPES.has(norm(f))) {
      return `explicit flag '${f}' is L5 prohibited`;
    }
  }
  const sig = hasIntentSignal(proposal.intent);
  if (sig) {
    return `intent matches L5 signal '${sig}' (self-modification / exfiltration / deception / impersonation)`;
  }
  return null;
}

/** Gate: is the proposal "objective" enough to qualify for the L3 allowlist? */
export function isObjective(proposal: ActionProposal): boolean {
  if (proposal.confidence != null && proposal.confidence < OBJECTIVE_MIN_CONFIDENCE) return false;
  if (proposal.evidenceN != null && proposal.evidenceN < OBJECTIVE_MIN_SAMPLES) return false;
  return true;
}

/** Classify which of the L4 owner-approval categories this action touches (for the reason text). */
export function matchedL4Category(proposal: ActionProposal): string | null {
  const c = norm(proposal.category);
  if (c && L4_OWNER_APPROVAL_CATEGORIES.has(c)) return c;
  if (c) {
    for (const cat of L4_OWNER_APPROVAL_CATEGORIES) {
      if (c.includes(cat) || cat.includes(c)) return cat;
    }
  }
  const res = norm(proposal.resource);
  if (res) {
    for (const cat of L4_OWNER_APPROVAL_CATEGORIES) {
      if (res.includes(cat)) return cat;
    }
  }
  const t = norm(proposal.type);
  for (const cat of L4_OWNER_APPROVAL_CATEGORIES) {
    if (t.includes(cat)) return cat;
  }
  return null;
}

const OWNER_APPROVAL = (
  reason: string,
): AuthorityDecision => ({
  level: AuthorityLevel.L4,
  allowed: false,
  needsOwnerApproval: true,
  reason,
});

const BANNED = (reason: string): AuthorityDecision => ({
  level: AuthorityLevel.L5,
  allowed: false,
  needsOwnerApproval: false,
  reason,
});

const SELF_AUTHORIZED = (reason: string): AuthorityDecision => ({
  level: AuthorityLevel.L3,
  allowed: true,
  needsOwnerApproval: false,
  reason,
});

/**
 * Decide whether a proposed action may be performed and at what authority
 * level. PURE + DETERMINISTIC — no DB reads or writes.
 *
 * Order of checks (each earlier check is authoritative):
 *   1. L5  — prohibited (self-modification, exfiltration, deception…). Blocked.
 *   2. L3  — narrow safe-action allowlist AND objective (safe, confident sample).
 *            Allowed, owner approval NOT required.
 *   3. L4  — EVERYTHING ELSE (any external/owner-category effect, or any
 *            uncertain / unknown / not-explicitly-allowed action). Fail-safe:
 *            routed to the owner-approval queue.
 */
export function decideAction(proposal: ActionProposal): AuthorityDecision {
  const l5 = detectL5(proposal);
  if (l5) return BANNED(l5);

  const t = norm(proposal.type);
  if (L3_SAFE_ACTION_ALLOWLIST.has(t)) {
    // Prompt-injection-hygiene: an untrusted intent that tries to redirect the
    // action is UNCERTAIN — fall to owner approval rather than auto-proceed.
    const redirect = intentRedirects(proposal);
    if (redirect) {
      return OWNER_APPROVAL(
        `'${t}' is L3-allowlisted but the intent (` + JSON.stringify(proposal.intent) +
          `) contains redirect signal '${redirect}' (prompt-injection style) — ` +
          `fail-safe: never honor a redirect; owner approval required`,
      );
    }
    if (!isObjective(proposal)) {
      return OWNER_APPROVAL(
        `'${t}' is L3-allowlisted but the proposal is uncertain (confidence=${proposal.confidence ?? "n/a"}, ` +
          `evidenceN=${proposal.evidenceN ?? "n/a"}, objective min=${OBJECTIVE_MIN_CONFIDENCE}/${OBJECTIVE_MIN_SAMPLES}) — ` +
          `fail-safe: owner approval required`,
      );
    }
    return SELF_AUTHORIZED(
      `'${t}' is on the narrow L3 safe-action allowlist (internal-only, no external side-effect) and is objective — ` +
        `Jarvis may proceed without owner approval`,
    );
  }

  const cat = matchedL4Category(proposal);
  if (cat) {
    return OWNER_APPROVAL(
      `'${t}' touches the L4 owner-approval category '${cat}' — owner approval required before acting`,
    );
  }

  return OWNER_APPROVAL(
    `'${t}' is not on the L3 safe-action allowlist — fail-safe default requires owner approval (never silently auto-approved)`,
  );
}

/* ═════════════════════════════════════════════════════════════════════
 * Owner-approval QUEUE — persisted in `jarvis_actions` (migration 024).
 *
 * create / list / resolve / execute / (cleanup) all respect the
 * owner-approved-never-hard-delete principle: only non-approved rows may be
 * physically removed, and only for explicit cleanup (dry-runs, dedupe).
 * ═════════════════════════════════════════════════════════════════════ */
export type JarvisActionStatus = "pending" | "approved" | "denied" | "executed" | "failed" | "expired";
export type JarvisActionAuthority = "L0" | "L1" | "L2" | "L3" | "L4" | "L5";

export interface JarvisActionRow {
  id: number;
  action_type: string;
  resource: string | null;
  payload: unknown;
  authority_level: JarvisActionAuthority;
  status: JarvisActionStatus;
  requested_by: string | null;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  reason: string | null;
  owner_approved: boolean;
}

type NeonQuery = ReturnType<typeof sql>;
const byId = (rows: any[]) => (rows.length ? rows[0] : null);
const now = () => new Date().toISOString();

export interface EnqueueActionInput {
  type: string;
  resource?: string;
  payload?: unknown;
  decision: AuthorityDecision;
  requestedBy?: string;
  reason?: string;
}

/**
 * Enqueue an action that requires owner approval (or record any decision).
 * Pending rows start owner_approved=false (candidates, not approvals).
 */
export async function enqueueAction(db: NeonQuery, input: EnqueueActionInput): Promise<JarvisActionRow> {
  const rows = await db`
    INSERT INTO jarvis_actions (action_type, resource, payload, authority_level, status, requested_by, reason, owner_approved)
    VALUES (${input.type}, ${input.resource ?? null}, ${JSON.stringify(input.payload ?? {})},
            ${input.decision.level}, 'pending', ${input.requestedBy ?? "jarvis"}, ${input.reason ?? input.decision.reason}, FALSE)
    RETURNING *
  `;
  return rows[0] as JarvisActionRow;
}

export async function getAction(db: NeonQuery, id: number): Promise<JarvisActionRow | null> {
  return (byId(await db`SELECT * FROM jarvis_actions WHERE id = ${id}`) as JarvisActionRow | null) ?? null;
}

export async function listPendingActions(db: NeonQuery): Promise<JarvisActionRow[]> {
  return (await db`
    SELECT * FROM jarvis_actions WHERE status = 'pending' ORDER BY requested_at ASC
  `) as JarvisActionRow[];
}

export async function listActionsByStatus(db: NeonQuery, status: JarvisActionStatus): Promise<JarvisActionRow[]> {
  return (await db`
    SELECT * FROM jarvis_actions WHERE status = ${status} ORDER BY requested_at DESC
  `) as JarvisActionRow[];
}

export type ResolveOutcome = "approve" | "deny";

/**
 * Owner resolves a queued action: approve (status='approved', owner_approved=
 * true) or deny (status='denied', owner_approved stays false). The approved
 * row is durable — it is NEVER hard-deleted.
 */
export async function resolveAction(
  db: NeonQuery,
  id: number,
  decidedBy: string,
  outcome: ResolveOutcome,
  reason?: string,
): Promise<JarvisActionRow | null> {
  const status: JarvisActionStatus = outcome === "approve" ? "approved" : "denied";
  const approved = outcome === "approve";
  return byId(await db`
    UPDATE jarvis_actions
    SET status = ${status},
        owner_approved = ${approved},
        decided_at = ${now()},
        decided_by = ${decidedBy},
        reason = COALESCE(${reason ?? null}, reason)
    WHERE id = ${id}
    RETURNING *
  `) as JarvisActionRow | null;
}

/** Record that an owner-APPROVED action has been carried out. */
export async function markActionExecuted(db: NeonQuery, id: number): Promise<JarvisActionRow | null> {
  return byId(await db`
    UPDATE jarvis_actions
    SET status = 'executed'
    WHERE id = ${id} AND owner_approved = TRUE AND status = 'approved'
    RETURNING *
  `) as JarvisActionRow | null;
}

/**
 * Physically delete ONLY a NON-approved row (explicit cleanup path for
 * dry-runs / dedupe). Owner-approved rows are protected and refused.
 */
export async function removeAction(db: NeonQuery, id: number): Promise<boolean> {
  const res = await db`DELETE FROM jarvis_actions WHERE id = ${id} AND owner_approved = FALSE`;
  const changed = (res as any)?.length !== undefined ? res.length > 0 : true;
  if (changed) {
    const chk = await getAction(db, id);
    if (chk?.owner_approved) throw new Error("removeAction: attempted to delete an owner-approved action — refused");
  }
  return changed;
}

/**
 * High-level helper: classify a proposal and, if it needs owner approval,
 * enqueue it. Returns the decision + (when enqueued) the queued row. PURE
 * callers that only want the decision should call decideAction directly.
 */
export async function requestAction(
  db: NeonQuery,
  proposal: ActionProposal,
  opts?: { requestedBy?: string; reason?: string },
): Promise<{ decision: AuthorityDecision; queued: JarvisActionRow | null }> {
  const decision = decideAction(proposal);
  if (!decision.needsOwnerApproval) {
    return { decision, queued: null };
  }
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
    requestedBy: opts?.requestedBy,
    reason: opts?.reason,
  });
  return { decision, queued };
}
