/**
 * FREE-FIRST-AUTOPSY ACQUISITION FUNNEL (owner-endorsed 2026-09-05, rev 171).
 *
 * The Award Autopsy becomes an ACQUISITION mechanic, not a paywall:
 *
 *   Facebook/GovCon groups → "Why did you lose?" (/autopsy, PUBLIC) →
 *   enter the lost solicitation → real award found (winner + amount +
 *   difference, visible BEFORE signup) → signup wall → free-Basic signup →
 *   COMPLETE first autopsy (full findings + recommendation + historical
 *   comparison — the Starter+ content) → Radar cross-sell → Starter $19.
 *
 * This module is the single place that owns:
 *   1. the 9 owner-exact funnel stages and their event mapping (reusing the
 *      existing Visitor Intelligence plumbing — funnel_events via the shared
 *      /api/track-visitor intake — NO parallel system),
 *   2. the first-ever-autopsy-free-complete GIFT: `users.first_autopsy_gifted`
 *      (migration 030, nullable-by-default FALSE + self-healed at runtime like
 *      every other schema guard), consumed atomically once, so a user's SECOND
 *      autopsy onward falls back to the normal owner-exact gating (Basic 1/mo
 *      demo fields, Starter 5/mo full, Pro/Agency unlimited).
 *
 * Gifting RULES (owner-exact):
 *   - The gift is served ONCE per account: `first_autopsy_gifted` flips to
 *     TRUE the first time the complete report is actually generated (atomic
 *     UPDATE ... WHERE first_autopsy_gifted = FALSE).
 *   - It is only available to a user who has NEVER consumed a ledger autopsy
 *     (no `autopsy_allowance` row with autopsies_used > 0) — i.e. the
 *     first-ever autopsy for a genuinely new user. A no-award lookup (honest
 *     "no award data found yet" fallback) does NOT consume the gift.
 *   - The ⚡ Contrax Learning memory stays PAID-ONLY (Starter+): the gift path
 *     never writes a `bid_losses` row and never renders the memory banner —
 *     server-gated, same as the shipped /losses surface.
 */
import { sql } from "~/db";
import { buildAutopsy, type AwardAutopsy } from "~/lib/award-autopsy";

// ── Funnel stages (owner-exact 9, order matters) ─────────────────────────────
export const AUTOPSY_FUNNEL_STAGES = [
  { stage: "autopsy_landing", label: "Autopsy entry opened" },
  { stage: "contract_entered", label: "Lost solicitation entered" },
  { stage: "award_found", label: "Real award found" },
  { stage: "autopsy_generated", label: "Autopsy preview generated" },
  { stage: "signup_wall", label: "Signup wall shown" },
  { stage: "signup", label: "Signup completed (Basic)" },
  { stage: "report_viewed", label: "Complete autopsy viewed" },
  { stage: "radar_used", label: "Radar cross-sell used" },
  { stage: "paid", label: "Paid upgrade" },
] as const;

/** New autopsy-funnel event names (the stages that need a NEW event). */
export const AUTOPSY_EVENTS = [
  "autopsy_landing", // 1 — public entry opened
  "autopsy_contract_entered", // 2 — solicitor entered the lost solicitation
  "autopsy_award_found", // 3 — real award matched (winner+amount+difference)
  "autopsy_generated", // 4 — autopsy preview generated (pre-signup)
  "autopsy_signup_wall", // 5 — signup gate shown (after the preview)
  "autopsy_report_viewed", // 7 — free COMPLETE report viewed post-signup
  "autopsy_radar_cta", // 8 — Radar cross-sell CTA clicked (handoff click)
] as const;

/** Reused existing events (no duplicates): stage 6 = signup_success; stage 8
 *  also accepts radar_scan_complete; stage 9 is derived from the users table. */
export const AUTOPSY_SIGNUP_EVENT = "signup_success";
export const AUTOPSY_RADAR_COMPLETE_EVENT = "radar_scan_complete";

/** Tag every autopsy event with this label so the admin funnel view can also
 *  filter by label — belt-and-suspenders on top of the event-name set. */
export const AUTOPSY_FUNNEL_LABEL = "autopsy_funnel";

/** Human labels for the admin timeline (also added to tracking-intake /
 *  journeys EVENT_LABELS maps so every surface renders a readable label). */
export const AUTOPSY_EVENT_LABELS: Record<string, string> = {
  autopsy_landing: "Why-did-you-lose entry opened",
  autopsy_contract_entered: "Lost solicitation entered",
  autopsy_award_found: "Real award found",
  autopsy_generated: "Autopsy preview generated",
  autopsy_signup_wall: "Autopsy signup wall shown",
  autopsy_report_viewed: "Complete autopsy viewed",
  autopsy_radar_cta: "Radar cross-sell clicked",
};

/** One anonymous draft — what the public form collects and the post-signup
 *  report regenerates from (carried in sessionStorage, never in a URL). */
export interface AutopsyDraft {
  bidTitle: string;
  agency: string;
  naicsCode: string;
  estimatedValue: string;
}

export const AUTOPSY_DRAFT_STORAGE_KEY = "contrax_autopsy_draft";

// ── First-ever-autopsy gift (the acquisition gift) ───────────────────────────

/** Self-healing schema guard — identical pattern to every other table/column
 *  guard in the repo (tracking-intake, visitor-intel, award-autopsy). Prod
 *  Neon gets the column without a manual migration run; db/migrations/030
 *  carries the same DDL for fresh environments. */
let giftedColumnReady = false;
export async function ensureFirstAutopsyGiftedColumn(): Promise<boolean> {
  if (giftedColumnReady) return true;
  try {
    const db = sql();
    await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_autopsy_gifted BOOLEAN NOT NULL DEFAULT FALSE`;
    giftedColumnReady = true;
  } catch (e) {
    console.error("[autopsy-funnel] ensureFirstAutopsyGiftedColumn failed (fail-open):", e);
  }
  return giftedColumnReady;
}

/**
 * True when this user's FIRST-ever autopsy is still ungifted AND they have no
 * prior autopsy usage in the allowance ledger (the "new user" test — a user who
 * already consumed a ledger autopsy is back to normal gating). Fail-open: any
 * DB blip returns false (never gift twice).
 */
export async function isFirstAutopsyGiftAvailable(userId: number): Promise<boolean> {
  try {
    if (!(await ensureFirstAutopsyGiftedColumn())) return false;
    const rows = (await sql()`
      SELECT first_autopsy_gifted FROM users WHERE id = ${userId} LIMIT 1
    `) as any[];
    if (!rows.length || rows[0].first_autopsy_gifted === true) return false;
    const used = (await sql()`
      SELECT 1 FROM autopsy_allowance
      WHERE user_id = ${userId} AND autopsies_used > 0
      LIMIT 1
    `) as any[];
    return used.length === 0;
  } catch (e) {
    console.error("[autopsy-funnel] isFirstAutopsyGiftAvailable failed (fail-open):", e);
    return false;
  }
}

/**
 * Atomically consume the one-time gift. Returns true ONLY when this call
 * actually flipped the flag (guarded UPDATE ... WHERE first_autopsy_gifted =
 * FALSE) — so concurrent double-renders can never double-gift.
 */
export async function consumeFirstAutopsyGift(userId: number): Promise<boolean> {
  try {
    if (!(await ensureFirstAutopsyGiftedColumn())) return false;
    const rows = (await sql()`
      UPDATE users SET first_autopsy_gifted = TRUE
      WHERE id = ${userId} AND first_autopsy_gifted = FALSE
      RETURNING id
    `) as any[];
    return rows.length > 0;
  } catch (e) {
    console.error("[autopsy-funnel] consumeFirstAutopsyGift failed (fail-open):", e);
    return false;
  }
}

export interface GiftedAutopsyResult {
  /** false when the gift is unavailable (already used) or the draft is empty. */
  gifted: boolean;
  /** true only when a real USAspending award matched AND the gift was consumed. */
  delivered: boolean;
  autopsy: AwardAutopsy | null;
  /** Honest reason when gifted is false (e.g. gift used). */
  reason: string | null;
}

/**
 * Build + deliver the one free COMPLETE autopsy to a new account. Called from
 * the /autopsy route AFTER signup (logged-in user with a draft). The full
 * Starter+ content (findings + recommendation + historical comparison) is
 * built via the existing award-autopsy lib — never fabricated. The gift is
 * consumed ONLY when a real award is found (a no-award honest fallback does
 * NOT burn the user's gift — they can retry with corrected details). The ⚡
 * Learning memory is never touched here (no bid_losses row, no banner).
 */
export async function getGiftedAutopsy(
  userId: number,
  draft: AutopsyDraft | null,
): Promise<GiftedAutopsyResult> {
  if (!draft || !draft.bidTitle.trim() || !draft.agency.trim()) {
    return { gifted: false, delivered: false, autopsy: null, reason: "missing_draft" };
  }
  if (!(await isFirstAutopsyGiftAvailable(userId))) {
    return {
      gifted: false,
      delivered: false,
      autopsy: null,
      reason:
        "Your free Award Autopsy was already used — log a loss on /losses to run your next one (Basic includes 1/month).",
    };
  }
  const { autopsy } = await buildAutopsy({
    bidTitle: draft.bidTitle.trim(),
    agency: draft.agency.trim(),
    naicsCode: draft.naicsCode.trim(),
    estimatedValue: draft.estimatedValue.trim(),
    // The gift unlocks the FULL Starter+ analysis for the first report.
    paid: true,
    deeper: false,
  });
  if (!autopsy.found) {
    // Honest no-award fallback — do NOT consume the gift; the user can retry.
    return { gifted: false, delivered: false, autopsy, reason: "no_award_found" };
  }
  const consumed = await consumeFirstAutopsyGift(userId);
  if (!consumed) {
    // Raced past the gift between the check and the flip — be honest.
    return {
      gifted: false,
      delivered: false,
      autopsy: null,
      reason:
        "Your free Award Autopsy was already used — log a loss on /losses to run your next one (Basic includes 1/month).",
    };
  }
  return { gifted: true, delivered: true, autopsy, reason: null };
}