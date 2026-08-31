/**
 * Jarvis Autonomous Upgrade — Phase 3 PROBLEM-SOLVING pipeline.
 *
 * Owner directive (ratified business plan rev 129):
 *   "OBSERVE→DEFINE→EVIDENCE→HYPOTHESES→TEST→RANK→SOLUTIONS→SCORE→RECOMMEND→
 *    TRACK→LEARN pipeline; problem detection with min-sample thresholds (no
 *    tiny-sample 'crises'); per-problem PROBLEM/EVIDENCE/CAUSES/
 *    CONTRADICTING-EVIDENCE/KNOWN-UNKNOWNS/SOLUTIONS/IMPACT-EFFORT-RISK/
 *    RECOMMENDED/SUCCESS+FAILURE-SIGNAL/CONFIDENCE."
 *
 * This module is the EXPLICITLY-INVOKED problem-DETECTION + REASONING engine.
 * It is NOT autonomous: there is no scheduler, no background worker, and no UI
 * here (those are Phases 5/6). Any caller (a lead, a future Phase 5 worker, an
 * admin script) can call `runProblemAnalysis()` to detect problems over a
 * window and `persistProblemCandidates()` to land candidate rows in the
 * Jarvis ledgers.
 *
 * Properties guaranteed here:
 *   • PURELY ADDITIVE — it does not touch the interactive /api/jarvis path, any
 *     existing reader, rate-limit, auth, or answer branch. It only ADDS a
 *     self-contained analyzer + its dry-run script.
 *   • Min-sample gating — every problem claim is gated on a minimum number of
 *     qualifying observations (MIN_SAMPLES). A tiny sample NEVER escalates: it
 *     is suppressed entirely or downgraded to INFO with an "insufficient data"
 *     note, never reported as IMPORTANT/CRITICAL.
 *   • Severity guard — CRITICAL is reserved for genuinely severe prod-down /
 *     db-sync-down / payment / security / severe data-integrity conditions.
 *     A normal funnel dip can NEVER be CRITICAL (capped at IMPORTANT).
 *   • Exclusions — every detection SQL re-applies the shared BOT / @test.contrax
 *     / admin exclusion filter (the same predicates the interactive readers and
 *     admin surfaces use), so QA/bot/admin traffic never creates a "crisis".
 *   • Data-priority — gathered evidence (tier `live`) is composed against the
 *     approved operating model with the Phase 2 shared `composeByDataPriority`
 *     primitive, and `detectConflicts` surfaces any live-vs-approved (or
 *     candidate-vs-approved) contradiction into CONTRADICTING EVIDENCE rather
 *     than silently dropping it.
 *   • Write discipline — the only writes are candidate rows in `jarvis_problems`
 *     (+ linked `jarvis_hypotheses`) via the Phase 1 store functions. Problems
 *     have no owner_approved column; "candidate" = status 'open' with
 *     owner_acknowledged=false (the default), never approved. We never touch an
 *     existing approved row and we dedupe open problems on the same subject
 *     within the window instead of piling up duplicates.
 */
import { sql } from "~/db";
import { BOT_EXCLUSION_SQL } from "~/lib/bot-exclusion";
import { qaFunnelExclusionSQL, adminFunnelExclusionSQL } from "~/lib/qa-exclusion";
import {
  loadOperatingModel,
  composeByDataPriority,
  detectConflicts,
  type KnowledgeEvidence,
  type KnowledgeConflict,
  type DataTier,
} from "~/lib/jarvis/knowledge";
import {
  createProblem,
  createHypothesis,
  type JarvisProblem,
} from "~/lib/jarvis/store";

/* ───────────────────────── Constants ───────────────────────── */
/**
 * Minimum number of qualifying observations before any funnel/conversion claim
 * may be treated as a real problem (not a tiny-sample fluke). Any detection
 * whose `n` falls below this is suppressed or downgraded to INFO.
 */
export const MIN_SAMPLES = 5;
/** Stricter (larger) gate for funnel-drop reasoning that needs a broader base. */
export const MIN_FUNNEL_SAMPLES = 10;
/** Sync-stall hours that escalate severity (db-sync availability). */
export const SYNC_STALE_HOURS_WATCH = 12;
export const SYNC_STALE_HOURS_IMPORTANT = 24;
export const SYNC_STALE_HOURS_CRITICAL = 72;
/** Funnel drop-off percentage treated as a real soft-funnel problem. */
export const FUNNEL_DROP_PCT_THRESHOLD = 60;

export type Severity = "INFO" | "WATCH" | "IMPORTANT" | "CRITICAL";

/* ───────────────────────── Types ───────────────────────── */
export interface DetectionEvidence {
  /** stable metric slug, e.g. "funnel_qualified_to_signup" */
  metric: string;
  label: string;
  value: number | string | null;
  /** number of qualifying observations behind this evidence */
  n: number;
  window: number;
  tier: DataTier;
  confidence: number;
  /** human-readable grounding line */
  text: string;
  subject?: string | null;
}

export interface Solution {
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  effort: "high" | "medium" | "low";
  risk: "high" | "medium" | "low";
}

export interface ResolvedProblem {
  category: string;
  title: string;
  description: string;
  evidence: DetectionEvidence[];
  causes: string[];
  contradictingEvidence: string[];
  knownUnknowns: string[];
  solutions: Solution[];
  recommended: string;
  successSignal: string;
  failureSignal: string;
  confidence: number;
  severity: Severity;
  /** true when downgraded/suppressed purely for lack of sample size */
  insufficientData: boolean;
}

export interface ProblemAnalysis {
  problems: ResolvedProblem[];
  /** every piece of evidence gathered (ordered by data priority) */
  evidence: DetectionEvidence[];
  /** conflicts surfaced by detectConflicts, mapped into problem context */
  conflicts: KnowledgeConflict[];
  /** true when the window had too little traffic for any real problem */
  insufficientData: boolean;
  windowDays: number;
}

export interface AnalyzeOptions {
  days?: number;
  /** optional explicitly-supplied evidence set (skips live detection) */
  evidence?: DetectionEvidence[];
}

/* ───────────────────────── Shared exclusion filter ─────────────────────────
 * Re-applies the SAME bot / @test.contrax / admin predicates the interactive
 * readers and admin surfaces use. Copied-by-reference here so Phase 3 detection
 * counts the same humans as the rest of the product; do not fork the logic.
 */
const humanFilter = `NOT COALESCE((${BOT_EXCLUSION_SQL}), false)
  AND ${qaFunnelExclusionSQL("")} AND ${adminFunnelExclusionSQL("")}`;

const RADAR_COMPLETE = "radar_scan_complete";
const ACTIVATION_EVENTS = [
  "rfp_brief_result",
  "save_success",
  "score_result",
  "score_submit",
  "alert_created",
];
/** A visitor is "qualified" when they reach any meaningful product touch. */
const QUALIFY_EVENTS = [
  ...ACTIVATION_EVENTS,
  RADAR_COMPLETE,
  "signup_view",
  "signup_view_with_score",
  "signup_start",
  "signup_submit",
  "signup_abandon",
  "signup_success",
  "hero_cta_click",
  "radar_scan_start",
];
const SIGNUP_COMPLETE = "signup_success";

/* ───────────────────────── Detection SQL ───────────────────────── */
async function stageCount(
  db: ReturnType<typeof sql>,
  fromIso: string,
  eventNames: string[],
): Promise<number> {
  const r = await db`
    SELECT COUNT(DISTINCT visitor_id) AS n FROM funnel_events
    WHERE visitor_id IS NOT NULL AND visitor_id <> ''
      AND created_at >= ${fromIso}
      AND event_name = ANY(${eventNames})
      AND ${db.unsafe(humanFilter)}`;
  return Number(r[0]?.n ?? 0);
}

/** OBSERVE — pull real funnel-stage counts + bid + sync signals over the window. */
async function observe(db: ReturnType<typeof sql>, fromIso: string, days: number): Promise<DetectionEvidence[]> {
  const [qualified, radar, signup, activated, paid, pv, users, bids] = await Promise.all([
    stageCount(db, fromIso, QUALIFY_EVENTS),
    stageCount(db, fromIso, [RADAR_COMPLETE]),
    stageCount(db, fromIso, [SIGNUP_COMPLETE]),
    stageCount(db, fromIso, ACTIVATION_EVENTS),
    paidCount(db, fromIso),
    db`SELECT COUNT(*) AS n FROM page_views
        WHERE created_at >= ${fromIso} AND ${db.unsafe(humanFilter)}`,
    db`SELECT COUNT(*) AS n FROM users
        WHERE created_at >= ${fromIso}
          AND LOWER(COALESCE(email,'')) NOT LIKE '%@test.contrax'
          AND is_admin = FALSE`,
    db`SELECT COUNT(*) AS n FROM bids WHERE created_at >= ${fromIso}`,
  ]);

  const ev: DetectionEvidence[] = [];
  ev.push({ metric: "funnel_qualified", label: "qualified visitors", value: qualified, n: qualified, window: days, tier: "live", confidence: 1, text: `Qualified visitors in ${days}d: ${qualified}` });
  ev.push({ metric: "funnel_radar", label: "radar scans completed", value: radar, n: radar, window: days, tier: "live", confidence: 1, text: `Radar scans completed in ${days}d: ${radar}` });
  ev.push({ metric: "funnel_signup", label: "signups completed", value: signup, n: signup, window: days, tier: "live", confidence: 1, text: `Signups completed in ${days}d: ${signup}` });
  ev.push({ metric: "funnel_activated", label: "activated users", value: activated, n: activated, window: days, tier: "live", confidence: 1, text: `Activated users in ${days}d: ${activated}` });
  ev.push({ metric: "funnel_paid", label: "paid users", value: paid, n: paid, window: days, tier: "live", confidence: 1, text: `Paid users in ${days}d: ${paid}` });
  ev.push({ metric: "page_views", label: "page views", value: Number(pv[0]?.n ?? 0), n: Number(pv[0]?.n ?? 0), window: days, tier: "live", confidence: 1, text: `Page views in ${days}d: ${Number(pv[0]?.n ?? 0)}` });
  ev.push({ metric: "signups_in_users", label: "new user rows", value: Number(users[0]?.n ?? 0), n: Number(users[0]?.n ?? 0), window: days, tier: "live", confidence: 1, text: `New user rows in ${days}d: ${Number(users[0]?.n ?? 0)}` });
  ev.push({ metric: "bids_ingested", label: "bids ingested", value: Number(bids[0]?.n ?? 0), n: Number(bids[0]?.n ?? 0), window: days, tier: "live", confidence: 1, text: `Bids ingested in ${days}d: ${Number(bids[0]?.n ?? 0)}` });

  // Sync freshness from the LATEST sync_logs row (whole-history, the live signal
  // is "how long since a sync ran, whether or not it landed in the window").
  const syncs = await db`
    SELECT MAX(created_at) AS latest, source FROM sync_logs GROUP BY source ORDER BY latest DESC LIMIT 1`;
  if (syncs.length) {
    const latest = new Date(String(syncs[0].latest));
    const hoursAgo = (Date.now() - latest.getTime()) / 3_600_000;
    const src = String(syncs[0].source ?? "unknown");
    ev.push({
      metric: "sync_stale_hours",
      label: "bid sync staleness",
      value: Math.round(hoursAgo * 10) / 10,
      n: 1, window: days, tier: "live", confidence: 1,
      text: `Latest ${src} bid sync ran ${Math.round(hoursAgo * 10) / 10}h ago`,
    });
  }
  return ev;
}

async function paidCount(db: ReturnType<typeof sql>, fromIso: string): Promise<number> {
  const pr = await db`
    SELECT COUNT(DISTINCT fe.user_id) AS n
    FROM funnel_events fe JOIN users u ON u.id::text = fe.user_id
    WHERE fe.user_id IS NOT NULL AND fe.user_id <> '' AND fe.created_at >= ${fromIso}
      AND u.subscription_status = 'active'
      AND ${db.unsafe(humanFilter)}`;
  return Number(pr[0]?.n ?? 0);
}

/* ───────────────────────── Reasoning helpers ───────────────────────── */
function dropPct(from: number, to: number): number | null {
  if (from <= 0) return null;
  return Math.round((1 - to / from) * 1000) / 10;
}

function confidenceFromSample(n: number, min: number): number {
  // Saturating confidence on sample size: under-gated samples score low.
  const ratio = Math.min(1, n / (min * 2));
  return Math.round(Math.max(0.2, Math.min(0.95, ratio)) * 100) / 100;
}

/**
 * Min-sample gate: cap/downgrade severity when the qualifying observation count
 * is below the threshold. Tiny samples NEVER escalate beyond INFO and always
 * carry an "insufficient data" note.
 */
function gateSample(severity: Severity, n: number, minSamples: number): { severity: Severity; insufficientData: boolean } {
  if (n < minSamples) {
    return { severity: "INFO", insufficientData: true };
  }
  return { severity, insufficientData: false };
}

/**
 * Severity guard: CRITICAL is reserved for genuinely severe prod-down / db-sync
 * down / payment / security / data-integrity conditions. A normal funnel/conversion
 * dip can NEVER be CRITICAL — it is capped at IMPORTANT.
 */
function guardCritical(severity: Severity, allowCritical: boolean): Severity {
  if (severity === "CRITICAL" && !allowCritical) return "IMPORTANT";
  return severity;
}

/* ───────────────────────── DEFINE — detect problems ───────────────────────── */
function defineFunnelProblem(ev: DetectionEvidence[]): ResolvedProblem | null {
  const get = (m: string) => ev.find((e) => e.metric === m)?.n ?? 0;
  const qualified = get("funnel_qualified");
  const radar = get("funnel_radar");
  const signup = get("funnel_signup");
  const activated = get("funnel_activated");

  const qualifiedToSignupPct = dropPct(qualified, signup);
  const radarToSignupPct = dropPct(radar, signup);
  const signupToActivatedPct = dropPct(signup, activated);

  const related: DetectionEvidence[] = ev.filter((e) =>
    ["funnel_qualified", "funnel_radar", "funnel_signup", "funnel_activated", "funnel_paid"].includes(e.metric),
  );

  // Heuristic: the single largest eligible drop that clears the severity bar.
  let target: { title: string; desc: string; pct: number | null; fromN: number; metric: string } | null = null;

  // signup→activated is the highest-leverage business signal.
  if (signupToActivatedPct !== null && signupToActivatedPct >= FUNNEL_DROP_PCT_THRESHOLD && signup >= MIN_SAMPLES) {
    target = {
      title: "Signups are not activating",
      desc: `${signup} signup(s) but only ${activated} activated within ${30}d — a ${signupToActivatedPct}% signup→activated drop.`,
      pct: signupToActivatedPct, fromN: signup, metric: "funnel_activated",
    };
  } else if (qualifiedToSignupPct !== null && qualifiedToSignupPct >= FUNNEL_DROP_PCT_THRESHOLD && qualified >= MIN_SAMPLES) {
    target = {
      title: "Qualified visitors aren't converting to signup",
      desc: `${qualified} qualified visitor(s) but only ${signup} signup(s) — a ${qualifiedToSignupPct}% qualified→signup drop.`,
      pct: qualifiedToSignupPct, fromN: qualified, metric: "funnel_signup",
    };
  } else if (radarToSignupPct !== null && radarToSignupPct >= FUNNEL_DROP_PCT_THRESHOLD && radar >= MIN_SAMPLES) {
    target = {
      title: "Radar scans aren't converting to signup",
      desc: `${radar} radar scan(s) completed but only ${signup} signup(s) — a ${radarToSignupPct}% radar→signup drop.`,
      pct: radarToSignupPct, fromN: radar, metric: "funnel_signup",
    };
  }

  if (!target) return null;

  // A funnel dip is a SOFT problem: never CRITICAL.
  let severity: Severity = target.pct !== null && target.pct >= 75 ? "IMPORTANT" : "WATCH";
  const gate = gateSample(severity, target.fromN, MIN_SAMPLES);
  severity = guardCritical(gate.severity, false);

  return {
    category: "funnel",
    title: target.title,
    description: target.desc,
    evidence: related,
    causes: [
      "Onboarding friction between the previous stage and the next (value not yet demonstrated).",
      "Radar results may not clearly motivate creating an account / activating.",
      "Possible signup-form or activation-flow blocker.",
    ],
    contradictingEvidence: [],
    knownUnknowns: [
      "Whether drop-off is a product/UX issue vs. a traffic-quality issue (unverified).",
      "Visitor-level step timing (the detail path) would confirm where users stall.",
    ],
    solutions: [
      { title: "Instrument the exact abandonment point", description: "Add stage-by-stage funnel event instrumentation so the precise drop location is verified before changing anything.", impact: "high", effort: "medium", risk: "low" },
      { title: "Reduce signup friction", description: "Move radar results into an in-app, no-form signup surface and measure the delta on signup→activation.", impact: "high", effort: "high", risk: "medium" },
      { title: "A/B the activation CTA", description: "Test the first-premium-use prompt (trial) to lift signup→activation conversion.", impact: "medium", effort: "medium", risk: "low" },
    ],
    recommended: "Instrument the exact abandonment point first — verify the cause before changing the flow.",
    successSignal: "Signup→activation conversion improves by a measurable amount (e.g. >30% relative) over the next 14 days.",
    failureSignal: "Conversion is flat after 14 days or the hypothesis is contradicted by step-level data.",
    confidence: confidenceFromSample(target.fromN, MIN_SAMPLES),
    severity,
    insufficientData: gate.insufficientData,
  };
}

function defineZeroSignupBlocker(ev: DetectionEvidence[]): ResolvedProblem | null {
  const qualified = ev.find((e) => e.metric === "funnel_qualified")?.n ?? 0;
  const signup = ev.find((e) => e.metric === "funnel_signup")?.n ?? 0;
  if (!(qualified > 0 && signup === 0)) return null;

  // Gate on the QUALIFIED base (the humans who actually reached a qualifying
  // touch and didn't complete a signup) — never on broad page-view counts, or a
  // tiny handful of visitors could fabricate a "crisis". STILL a soft funnel
  // signal — never CRITICAL.
  const gate = gateSample("IMPORTANT", qualified, MIN_SAMPLES);
  const severity = guardCritical(gate.severity, false);
  const related = ev.filter((e) => ["funnel_qualified", "funnel_signup"].includes(e.metric));

  return {
    category: "funnel",
    title: "Qualified traffic is completing zero signups",
    description: `${qualified} qualified visitor(s) in window, but 0 signups completed — 0% qualified→signup conversion.`,
    evidence: related,
    causes: ["Possible signup-flow technical blocker or broken submit.", "Signup CTA/value proposition not compelling to qualified visitors.", "Traffic may be low-intent despite qualifying product touches."],
    contradictingEvidence: [],
    knownUnknowns: ["Whether the form submits successfully end-to-end (needs a manual or scripted check).", "Step-level signup_abandon data would localize the failure."],
    solutions: [
      { title: "Verify the signup flow end-to-end", description: "Run a scripted signup through staging to rule out a technical blocker before treating it as a conversion problem.", impact: "high", effort: "low", risk: "low" },
      { title: "Inspect signup_abandon events", description: "Pull step-level signup abandonment to see if users reach the form then stall, or never reach it.", impact: "high", effort: "low", risk: "low" },
    ],
    recommended: "Verify the signup flow end-to-end and inspect signup_abandon events — rule out a technical blocker first.",
    successSignal: "At least one signup completes, or a specific form bug is found and fixed.",
    failureSignal: "After verification the flow works and zero-signups continues, indicating a traffic/conversion (not technical) issue.",
    confidence: Math.round(Math.max(0.3, Math.min(0.8, qualified / (MIN_SAMPLES * 2))) * 100) / 100,
    severity,
    insufficientData: gate.insufficientData,
  };
}

function defineSyncStall(ev: DetectionEvidence[]): ResolvedProblem | null {
  const s = ev.find((e) => e.metric === "sync_stale_hours");
  if (!s) return null;
  const hours = Number(s.value);
  if (!Number.isFinite(hours) || hours <= SYNC_STALE_HOURS_WATCH) return null;

  // db-sync stall is a genuinely severe availability condition (the platform's
  // source of fresh opportunities). Unlike funnel analytics — where a "crisis"
  // needs a minimum human sample — staleness is measured in elapsed hours, so
  // a 96h-stale single reading is already a definitive signal and CRITICAL is
  // legitimate here (reserved strictly for the deep-stall case). The `n` field
  // still records how this was observed.
  let severity: Severity;
  if (hours > SYNC_STALE_HOURS_CRITICAL) severity = "CRITICAL";
  else if (hours > SYNC_STALE_HOURS_IMPORTANT) severity = "IMPORTANT";
  else severity = "WATCH";

  return {
    category: "sync",
    title: `Bid sync has been stale for ${Math.round(hours)}h`,
    description: `The latest bid sync (${s.label.toLowerCase()}) ran ${hours}h ago. Fresh opportunities are not entering the platform.`,
    evidence: [s],
    causes: ["Scheduled bid-sync job may have failed or been skipped.", "Sync runner may be erroring (see sync_logs.errors)."],
    contradictingEvidence: [],
    knownUnknowns: ["Whether the sync job is failing (error) or simply unscheduled.", "How many opportunities are being missed per hour of staleness."],
    solutions: [
      { title: "Check the sync runner's latest logs", description: "Confirm whether the GH Actions / runner is erroring and surface the raw error.", impact: "high", effort: "low", risk: "low" },
      { title: "Re-trigger the bid sync", description: "Manually run the sync to catch up on missed opportunities, then watch the next scheduled run.", impact: "high", effort: "low", risk: "low" },
    ],
    recommended: "Check the sync runner's latest logs and re-trigger the sync to restore bid freshness.",
    successSignal: "A fresh sync completes and sync_stale_hours drops below the watch threshold.",
    failureSignal: "The sync continues to fail >72h, confirming a persistent runner problem.",
    confidence: Math.round(Math.max(0.4, Math.min(0.9, 1 - hours / (SYNC_STALE_HOURS_CRITICAL * 2))) * 100) / 100,
    severity,
    insufficientData: false,
  };
}

/* ───────────────────────── CONTRADICTING EVIDENCE (LEARN) ───────────────────────── */
/**
 * Surface conflicts between live evidence and the approved operating model via
 * the Phase 2 `detectConflicts` primitive. Conflicts are reported into a
 * problem's CONTRADICTING EVIDENCE, never silently dropped.
 */
function attachContradictions(
  problems: ResolvedProblem[],
  conflicts: KnowledgeConflict[],
): void {
  const conflictStrs = conflicts.map((c) =>
    `${c.kind} on "${c.subject}": "${c.a.text.slice(0, 120)}" vs "${c.b.text.slice(0, 120)}"`,
  );
  for (const p of problems) {
    if (conflictStrs.length) {
      p.contradictingEvidence.push(...conflictStrs);
    }
    // Any explicitly-surfaced contradiction lowers confidence a little.
    if (conflictStrs.length) {
      p.confidence = Math.round(Math.max(0.2, p.confidence - 0.1) * 100) / 100;
    }
  }
}

/* ───────────────────────── Main entry (OBSERVE→…→LEARN) ───────────────────────── */
/**
 * Run the full problem-solving pipeline over a window and return the ranked
 * problems. This ONLY reasons (and returns the analysis); it does not persist.
 * Call `persistProblemCandidates` separately to land candidate ledger rows.
 */
export async function runProblemAnalysis(options: AnalyzeOptions = {}): Promise<ProblemAnalysis> {
  const days = Math.min(Math.max(options.days ?? 30, 1), 90);
  const db = sql();
  const fromIso = new Date(Date.now() - days * 86400_000).toISOString();

  const evidence = options.evidence?.length
    ? options.evidence
    : await observe(db, fromIso, days);

  const problems: ResolvedProblem[] = [];
  const funnel = defineFunnelProblem(evidence);
  if (funnel) problems.push(funnel);
  const blocker = defineZeroSignupBlocker(evidence);
  if (blocker) problems.push(blocker);
  const sync = defineSyncStall(evidence);
  if (sync) problems.push(sync);

  // OBSERVE→compose by data priority (live evidence against approved model).
  const model = await loadOperatingModel(db);
  const liveEvidence: KnowledgeEvidence[] = evidence.map((e) => ({
    tier: "live" as DataTier,
    source: e.metric,
    text: e.text,
    confidence: e.confidence,
    subject: e.subject ?? undefined,
    value: typeof e.value === "number" ? e.value : undefined,
  }));
  const all = composeByDataPriority([...model.all, ...liveEvidence]);
  const conflicts = detectConflicts(all);

  attachContradictions(problems, conflicts);

  // Sort by severity then confidence: CRITICAL first, then IMPORTANT, etc.
  const sevRank: Record<Severity, number> = { CRITICAL: 4, IMPORTANT: 3, WATCH: 2, INFO: 1 };
  problems.sort((a, b) => sevRank[b.severity] - sevRank[a.severity] || b.confidence - a.confidence);

  const anyReal = problems.some((p) => !p.insufficientData);
  return { problems, evidence, conflicts, insufficientData: !anyReal, windowDays: days };
}

/* ───────────────────────── TRACK — persist candidate rows ───────────────────────── */
/**
 * Persist a problem-solving analysis as CANDIDATE rows in the Jarvis ledgers
 * (jarvis_problems + linked jarvis_hypotheses), using the Phase 1 store
 * functions. All rows are candidates (open, owner_acknowledged=false on the
 * problem; note the problems table has no owner_approved column — candidate =
 * not owner-acknowledged). Dedupes open problems on the same category+subject
 * within the window. Always returns what was created (or the existing dupes).
 */
export async function persistProblemCandidates(analysis: ProblemAnalysis): Promise<JarvisProblem[]> {
  const db = sql();
  if (analysis.insufficientData) return []; // nothing worth persisting
    
  const created: JarvisProblem[] = [];
  for (const p of analysis.problems) {
    if (p.insufficientData) continue; // never persist tiny-sample "problems"
    const existing = await findOpenProblem(db, p.category, p.title);
    if (existing) {
      created.push(existing); // dedup — reuse the open problem, don't pile up
      continue;
    }
    const row = await createProblem(db, {
      category: p.category,
      title: p.title,
      description: p.description + (p.contradictingEvidence.length ? `\nCONTRADICTING EVIDENCE: ${p.contradictingEvidence.join(" | ")}` : ""),
      severity: p.severity,
      confidence: p.confidence,
      evidence: p.evidence as unknown[],
      status: "open",
      owner_acknowledged: false,
    });
    // Link a candidate hypothesis per problem (the "why" to test later).
    if (p.causes[0]) {
      await createHypothesis(db, {
        problem_id: row.id,
        hypothesis: p.causes[0],
        confidence: p.confidence,
        status: "proposed",
      });
    }
    created.push(row);
  }
  return created;
}

async function findOpenProblem(
  db: ReturnType<typeof sql>,
  category: string,
  title: string,
): Promise<JarvisProblem | null> {
  const windowAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const rows = await db`
    SELECT * FROM jarvis_problems
    WHERE category = ${category} AND title = ${title}
      AND status IN ('open','investigating') AND detected_at >= ${windowAgo}
    ORDER BY detected_at DESC LIMIT 1`;
  return (rows[0] as JarvisProblem | null) ?? null;
}
