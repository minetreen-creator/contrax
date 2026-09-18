/**
 * brief-source.ts — the SINGLE source of truth for (a) the AI Executive Brief
 * source fingerprint and (b) the "is this bid renderable as the homepage
 * EXAMPLE brief?" eligibility rules.
 *
 * Owner order 2026-09-18 (homepage "Example AI Executive Brief" defect): the
 * homepage example was stale and internally contradictory — the card header
 * showed the bid's CURRENT due_date ("Due Sep 23, 2026") while the cached brief
 * still said the submission deadline was Sep 16, 2026 and listed mandatory
 * pre-bid meetings that had already happened. The old loader picked the
 * "richest" cached `ai_summary` with NO freshness, deadline or milestone checks.
 *
 * This module is PURE (no DB, no network, no React) so the rules are unit
 * testable, and it is imported by BOTH:
 *   - src/routes/api/bids.$bidId.analyze.ts  (the cache identity / staleness rule)
 *   - src/lib/example-brief.ts               (the homepage + /example-brief loader)
 * so the two surfaces can never diverge on what "fresh" means.
 *
 * ── THE FINGERPRINT (v2) ──────────────────────────────────────────────────
 * SHA-256 over the canonical JSON of the exact source fields that are fed to
 * the model — title, agency, description, category, set_aside, due_date,
 * estimated_value — PLUS `updated_at` (the sync path's "source changed" stamp)
 * and `latest_amendment_at` (max bid_amendments.detected_at for the bid).
 *
 * Adding the two timestamps changes the meaning of every previously stored
 * hash: existing cached summaries read as STALE until they are regenerated.
 * That is intentional (owner order) and is why the homepage falls back to the
 * next eligible opportunity — or hides — rather than showing a cached brief it
 * cannot prove is current.
 *
 * Dates are normalized to ISO-8601 UTC before hashing (a raw `String(Date)` is
 * driver/timezone dependent and would make the hash unstable across runtimes).
 */
import type { RfpMilestone, RfpSummary } from "~/components/RfpSummaryCard";

/** Model identity — part of the cache key (never change casually). */
export const AI_MODEL = "gpt-4o-mini";
/**
 * Bump when the AiSummary schema / SYSTEM_PROMPT shape changes so previously
 * cached summaries (old shape) are treated as stale and regenerated.
 */
export const AI_SCHEMA_VERSION = 2;

/** The exact source fields that are fed to the LLM — used for hashing too. */
export interface BriefSourceInput {
  title: string;
  agency: string;
  description: string;
  category: string | null;
  set_aside: string | null;
  due_date: string | null;
  estimated_value: string | null;
  /** v2 fingerprint component — the sync path's "source changed" stamp. */
  updated_at: string | null;
  /** v2 fingerprint component — newest bid_amendments.detected_at for the bid. */
  latest_amendment_at: string | null;
}

/** The subset of a `bids` row the fingerprint and eligibility rules need. */
export interface BriefSourceBid {
  title: string | null;
  agency: string | null;
  description: string | null;
  category: string | null;
  set_aside: string | null;
  due_date: string | Date | null;
  estimated_value: string | null;
  updated_at?: string | Date | null;
  latest_amendment_at?: string | Date | null;
}

/** Cached-summary cache-identity columns (mirrors the bids table). */
export interface BriefCacheColumns {
  ai_summary_source_hash: string | null;
  ai_summary_schema_version: number | null;
  ai_summary_model: string | null;
}

/**
 * Normalize any date-ish value to an ISO-8601 UTC string, or null. Unparseable
 * non-empty strings are passed through verbatim (never invented, never dropped)
 * so a weird stored value still contributes to the fingerprint deterministically.
 */
export function isoOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

/**
 * Date-only (YYYY-MM-DD, UTC) view of a date-ish value — the comparison basis
 * for "does the cached submission deadline match the record's current due
 * date?". Both sides are normalized the same way (an ISO timestamp or a bare
 * YYYY-MM-DD milestone date both reduce to the same calendar day in UTC), so
 * the comparison never depends on the server's local timezone.
 */
export function dateOnly(v: unknown): string | null {
  const iso = isoOrNull(v);
  if (!iso) return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Build the canonical, order-stable source input for hashing + the LLM call. */
export function buildInput(bid: BriefSourceBid): BriefSourceInput {
  return {
    title: String(bid.title ?? ""),
    agency: String(bid.agency ?? ""),
    description: String(bid.description ?? ""),
    category: bid.category ? String(bid.category) : null,
    set_aside: bid.set_aside ? String(bid.set_aside) : null,
    due_date: isoOrNull(bid.due_date),
    estimated_value: bid.estimated_value ? String(bid.estimated_value) : null,
    // ── v2 fingerprint components (appended, so the key order stays stable) ──
    updated_at: isoOrNull(bid.updated_at),
    latest_amendment_at: isoOrNull(bid.latest_amendment_at),
  };
}

/**
 * SHA-256 over the canonical JSON of the source fields. Any change to a fed
 * field (an amended solicitation, a moved due date, a newer sync stamp) changes
 * the hash → stale cache. WebCrypto is available in Node/Bun/browsers, so no
 * node:crypto import is needed.
 */
export async function sourceHash(input: BriefSourceInput): Promise<string> {
  const canonical = JSON.stringify(input);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Convenience: hash a bid row directly (used by the loaders). */
export async function fingerprintFor(bid: BriefSourceBid): Promise<string> {
  return sourceHash(buildInput(bid));
}

/**
 * Cache identity check — the ONE definition of "fresh", shared by the analyze
 * route and the homepage example loader: the stored hash must equal the current
 * source fingerprint AND the schema version AND the model must match.
 */
export function isFingerprintFresh(
  cache: BriefCacheColumns,
  currentFingerprint: string,
): boolean {
  if ((cache.ai_summary_source_hash ?? null) !== currentFingerprint) return false;
  if (Number(cache.ai_summary_schema_version ?? -1) !== AI_SCHEMA_VERSION) return false;
  if (String(cache.ai_summary_model ?? "") !== AI_MODEL) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Milestones
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A dated milestone that must still be UPCOMING for the bid to be shown as the
 * homepage example: a mandatory site visit / pre-bid conference / Q&A deadline.
 * The submission deadline is NOT a pre-bid date (see `classifyMilestone`).
 */
export type MilestoneKind = "prebid" | "submission" | "other";

const PREBID_RE =
  /(pre-?\s?bid|prebid|pre-?\s?submission|site\s+(visit|tour|inspection|showing)|walk-?\s?through|job\s?show|conference|meeting|questions?|q\s*&\s*a|faq|inquir|clarification|rf[ip]\b)/i;
const SUBMISSION_RE =
  /(submission|submittal|proposal|response|bid|quote|closing|closing date|due date|deadline|due)/i;
/** Event/source text that marks a pre-bid date as NOT binding. */
const NON_BINDING_RE = /(non-?\s?mandatory|not\s+mandatory|optional|recommended|voluntary)/i;

/**
 * Classify a key_milestone by what kind of date it is. Pre-bid-style events win
 * over submission-style ones so "questions submission deadline" and
 * "pre-submission conference" are correctly read as PRE-BID dates, while
 * "proposal submission deadline" / "bid due date" are the submission deadline.
 */
export function classifyMilestone(milestone: Pick<RfpMilestone, "event">): MilestoneKind {
  const e = String(milestone.event ?? "");
  if (PREBID_RE.test(e)) return "prebid";
  if (SUBMISSION_RE.test(e)) return "submission";
  return "other";
}

/**
 * True when a pre-bid milestone binds the bidder. A date the notice itself
 * calls non-mandatory / optional / recommended is surfaced but not treated as a
 * hard gate (owner intent: "mandatory pre-bid dates").
 */
export function isBindingPrebid(milestone: Pick<RfpMilestone, "event" | "source">): boolean {
  if (classifyMilestone(milestone) !== "prebid") return false;
  const text = `${milestone.event ?? ""} ${milestone.source ?? ""}`;
  return !NON_BINDING_RE.test(text);
}

/** True once a whole calendar day (UTC) has passed. A same-day date is still "upcoming". */
export function isPastDay(day: string | null, now: number): boolean {
  if (!day) return false;
  const end = Date.parse(`${day}T23:59:59.999Z`);
  if (Number.isNaN(end)) return false;
  return end < now;
}

/** Days from `now` until an instant (negative = already past); null when unparseable. */
export function daysUntil(v: unknown, now: number): number | null {
  const iso = isoOrNull(v);
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.ceil((ms - now) / 86_400_000);
}

/** The cached submission-deadline milestone (if the brief identified one). */
export function submissionDeadlineMilestone(
  milestones: RfpMilestone[],
): RfpMilestone | null {
  return (
    milestones.find(
      (m) => classifyMilestone(m) === "submission" && dateOnly(m.date) !== null,
    ) ?? null
  );
}

/** Binding pre-bid milestones with a parseable date. */
export function bindingPrebidMilestones(milestones: RfpMilestone[]): RfpMilestone[] {
  return milestones.filter((m) => isBindingPrebid(m) && dateOnly(m.date) !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cached-summary mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a stored `ai_summary` JSONB blob to the RfpSummary contract. Never
 * fabricates: missing/invalid pieces become empty, exactly as before.
 */
export function mapStoredSummary(raw: unknown): RfpSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!r.summary) return null;
  const items = (v: unknown) =>
    Array.isArray(v)
      ? v.map((x: unknown) => ({
          text: String((x as { text?: unknown })?.text ?? ""),
          source: String((x as { source?: unknown })?.source ?? ""),
        }))
      : [];
  const milestones = (v: unknown) =>
    Array.isArray(v)
      ? v.map((x: unknown) => ({
          event: String((x as { event?: unknown })?.event ?? ""),
          date:
            (x as { date?: unknown })?.date == null
              ? null
              : String((x as { date?: unknown }).date),
          source: String((x as { source?: unknown })?.source ?? ""),
        }))
      : [];
  return {
    summary: String(r.summary ?? ""),
    mandatory_requirements: items(r.mandatory_requirements),
    key_milestones: milestones(r.key_milestones),
    trade_category: String(r.trade_category ?? ""),
    red_flags: items(r.red_flags),
  };
}

/**
 * A brief is only usable as the public example when it actually carries the
 * substance the section promises: a non-empty plain-English summary, at least
 * one mandatory requirement, and at least one dated milestone. An empty array
 * means the model found nothing to ground — treat as incomplete, skip the bid.
 */
export function isCompleteSummary(summary: RfpSummary | null): boolean {
  if (!summary) return false;
  if (!String(summary.summary ?? "").trim()) return false;
  if (summary.mandatory_requirements.length === 0) return false;
  if (summary.key_milestones.length === 0) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Homepage example eligibility
// ─────────────────────────────────────────────────────────────────────────────

export type ExampleRejectReason =
  | "no_summary"
  | "incomplete_summary"
  | "missing_due_date"
  | "expired_due_date"
  | "missing_source_url"
  | "passed_prebid_date"
  | "deadline_mismatch"
  | "stale_fingerprint";

export interface ExampleBidRow extends BriefSourceBid, BriefCacheColumns {
  id: number;
  source_url: string | null;
  updated_at: string | null;
  latest_amendment_at: string | null;
  ai_summary: unknown;
  ai_summary_at: string | null | Date;
  /** Display-only passthrough columns — never used by the eligibility rules. */
  location?: string | null;
  naics_code?: string | null;
}

export interface ExampleCandidate {
  row: ExampleBidRow;
  /** Current source fingerprint (computed by the loader from the same row). */
  currentFingerprint: string;
}

export interface ExampleEvaluation {
  row: ExampleBidRow;
  summary: RfpSummary | null;
  eligible: boolean;
  reasons: ExampleRejectReason[];
  dueDateOnly: string | null;
  daysRemaining: number | null;
  /** Preference: at least a week left to bid. */
  atLeastOneWeekLeft: boolean;
  /** Preference: the title is not a correction/amendment notice. */
  cleanTitle: boolean;
  /** Tie-break: mandatory_requirements + red_flags (the old "richest" rule). */
  richness: number;
  bindingPrebidDays: string[];
  submissionDeadlineDay: string | null;
}

/** Correction/amendment notices — deprioritized, never hard-rejected. */
const CORRECTION_TITLE_RE = /(amendment|correction|modification|addendum)/i;

/**
 * Apply EVERY eligibility rule to one candidate, in the owner's priority order.
 * Pure and DB-free: `now` is injected so the rules are deterministic in tests.
 */
export function evaluateExample(
  candidate: ExampleCandidate,
  now: number,
): ExampleEvaluation {
  const { row, currentFingerprint } = candidate;
  const summary = mapStoredSummary(row.ai_summary);
  const reasons: ExampleRejectReason[] = [];

  const complete = isCompleteSummary(summary);
  if (!summary) reasons.push("no_summary");
  else if (!complete) reasons.push("incomplete_summary");

  const dueIso = isoOrNull(row.due_date);
  const dueDateOnly = dateOnly(row.due_date);
  const dueMs = dueIso ? Date.parse(dueIso) : NaN;
  if (!dueIso || Number.isNaN(dueMs)) reasons.push("missing_due_date");
  else if (dueMs <= now) reasons.push("expired_due_date");

  if (!String(row.source_url ?? "").trim()) reasons.push("missing_source_url");

  const milestones = summary?.key_milestones ?? [];
  const bindingPrebidDays = bindingPrebidMilestones(milestones).map(
    (m) => dateOnly(m.date) as string,
  );
  if (bindingPrebidDays.some((d) => isPastDay(d, now))) {
    reasons.push("passed_prebid_date");
  }

  // Fail-closed deadline consistency: a cached submission-deadline milestone
  // that disagrees with the record's CURRENT due_date means the cached brief
  // describes a different (usually earlier) solicitation version.
  const deadlineMilestone = submissionDeadlineMilestone(milestones);
  const submissionDeadlineDay = dateOnly(deadlineMilestone?.date ?? null);
  if (submissionDeadlineDay && dueDateOnly && submissionDeadlineDay !== dueDateOnly) {
    reasons.push("deadline_mismatch");
  }

  if (!isFingerprintFresh(row, currentFingerprint)) reasons.push("stale_fingerprint");

  const daysRemaining = Number.isNaN(dueMs) ? null : Math.ceil((dueMs - now) / 86_400_000);

  return {
    row,
    summary,
    eligible: reasons.length === 0,
    reasons,
    dueDateOnly,
    daysRemaining,
    atLeastOneWeekLeft: daysRemaining !== null && daysRemaining >= 7,
    cleanTitle: !CORRECTION_TITLE_RE.test(String(row.title ?? "")),
    richness:
      (summary?.mandatory_requirements.length ?? 0) +
      (summary?.red_flags.length ?? 0),
    bindingPrebidDays,
    submissionDeadlineDay,
  };
}

/**
 * Best-first ordering: ≥7 days left, then a clean (non-correction) title, then
 * the richest brief, then the newest generation. Stable and total.
 */
export function compareExamples(a: ExampleEvaluation, b: ExampleEvaluation): number {
  if (a.atLeastOneWeekLeft !== b.atLeastOneWeekLeft) return a.atLeastOneWeekLeft ? -1 : 1;
  if (a.cleanTitle !== b.cleanTitle) return a.cleanTitle ? -1 : 1;
  if (a.richness !== b.richness) return b.richness - a.richness;
  const at = a.row.ai_summary_at ? Date.parse(isoOrNull(a.row.ai_summary_at)!) : 0;
  const bt = b.row.ai_summary_at ? Date.parse(isoOrNull(b.row.ai_summary_at)!) : 0;
  if (at !== bt) return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
  return a.row.id - b.row.id;
}

export interface ExampleSelection {
  /** The best fully-eligible (fresh + consistent + open) opportunity, or null. */
  best: ExampleEvaluation | null;
  /** Every fully-eligible candidate, best first. */
  eligible: ExampleEvaluation[];
  /**
   * Candidates that pass every CONTENT check but whose cached brief is stale
   * (fingerprint changed) — best first. Used to repair the cache on demand.
   */
  staleEligible: ExampleEvaluation[];
  /** Every candidate with its reasons (diagnostics / logs). */
  all: ExampleEvaluation[];
}

/** Rank all candidates and pick the best fresh one (null when none is valid). */
export function selectExampleBrief(
  candidates: ExampleCandidate[],
  now: number,
): ExampleSelection {
  const all = candidates.map((c) => evaluateExample(c, now));
  const eligible = all.filter((e) => e.eligible).sort(compareExamples);
  const staleEligible = all
    .filter((e) => !e.eligible && e.reasons.length === 1 && e.reasons[0] === "stale_fingerprint")
    .sort(compareExamples);
  return { best: eligible[0] ?? null, eligible, staleEligible, all };
}
