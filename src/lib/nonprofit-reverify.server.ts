/**
 * Nonprofit Free — the POST-REFRESH reverify pass (owner decision, RESOLVED 2026-09-21).
 *
 * THE OWNER'S RULE, in the plan's words (rev 266, owner 09-21): "reverify annually AND
 * after every IRS-data refresh — **refresh must detect status changes for already-verified
 * orgs (revoked / subsection changed) and route them to review/revocation**".
 *
 * The annual half is a date on the row (`NONPROFIT_REVERIFY_WINDOW_DAYS`, nonprofit.server.ts).
 * THIS module is the other half: the step that runs once, immediately after a new IRS extract
 * has been swapped into place, and re-checks every application that is currently `approved`
 * against the records that are now live.
 *
 * WHAT IT MAY DO: route an organization back to MANUAL REVIEW (`status = 'manual_review'`)
 * with a machine reason, the reviewer-facing message and an audit record naming the refresh
 * that changed things.
 *
 * WHAT IT MAY NEVER DO:
 *   • never revoke or deny automatically — every change goes to a human. The owner's
 *     "revocation" is a human act (spec item 5); this pass only raises the task.
 *   • never touch an organization whose record still satisfies every auto-approve signal
 *     (no churn: no UPDATE is issued at all, so `updated_at` does not move).
 *   • never run against a mirror the importer failed to prove complete — the caller
 *     (refreshIrsSource) invokes it only after a COMMITTED swap.
 *
 * ── THE OWNER'S RULE (IMPLEMENTATION LOCK, owner 2026-09-21) ─────────────────
 *
 * VERBATIM, and this module is where it is enforced:
 *
 * "A status change detected by reverification suspends the free entitlement and opens a
 * review case — it never deletes the user's account, and saved data remains intact while
 * the organization's status is reviewed (owner 09-21, implementation lock)."
 *
 * What that means in THIS file, concretely — every bullet below is pinned by a
 * regression test in src/lib/nonprofit-free.test.ts (describe: "the owner's status-change
 * rule (IMPLEMENTATION LOCK 2026-09-21): suspend, never destroy"):
 *   • the ONLY write on this path is `routeToReview` — ONE UPDATE of
 *     `nonprofit_applications`, guarded on `status = 'approved'`, moving the row to
 *     `status = 'manual_review'` (the REVIEW CASE the owner asked for);
 *   • it never reads, writes, joins or cascades to `users`: the account, the login and
 *     the organisation's identity are untouched, so a suspended org is never locked out
 *     and never has to re-register;
 *   • it never reads, writes, joins or cascades to `saved_grants`: every saved row
 *     survives the suspension untouched — and therefore also survives the re-approval
 *     that ends the review;
 *   • there is NO DELETE, no TRUNCATE and no ON DELETE CASCADE anywhere on this path, and
 *     `NonprofitReverifyStore` exposes no delete entry point at all — the pass has three
 *     methods, and none of them can destroy a row.
 *
 * SUSPENSION, NOT DELETION: a changed status weakens exactly one thing — the
 * entitlement. See the ACCESS NOTE below: the org drops from `nonprofit_free` to the
 * pending tier (`nonprofit_pending`) for as long as a human is reviewing it.
 *
 * ACCESS NOTE: routing to review is NOT the anonymous tier. `nonprofitSearchPolicy` gives
 * `manual_review` the PENDING policy (3 searches / 5 full details a day), so a nonprofit
 * under review keeps limited access while a human looks — never a silent cut to nothing.
 *
 * The module is pure apart from ONE injected store: the pass is unit-tested with a fake
 * store over the committed fixtures and ZERO network (owner's test-determinism guardrail).
 */
import { sql } from "~/db";
import {
  NONPROFIT_501C3_SUBSECTION,
  NONPROFIT_SUBSECTION_POLICY,
  isEligibleSubsection,
  subsectionLabel,
  type NonprofitReasonClass,
  type NonprofitSubsectionPolicy,
} from "~/lib/nonprofit.server";
import {
  BMF_STATUS_AUTO_APPROVE,
  IRS_SOURCE_LABEL,
  NONPROFIT_VERIFICATION_ENGINE,
  bmfStatusMeaning,
  neonIrsMirrorStore,
  type IrsMirrorStore,
} from "~/lib/nonprofit-verification.server";

// ── The reasons a verified org can be sent back to a human ────────────────────
export const NONPROFIT_REVERIFY_REASONS = [
  /** The new revocation list carries the EIN (the strongest signal — checked first). */
  "refresh_revoked",
  /** The EIN is gone from the new extract entirely. */
  "refresh_record_missing",
  /** The new extract's STATUS is neither 01 nor 02. */
  "refresh_status_not_active",
  /** The new extract's SUBSECTION is not 501(c)(3) under the shipped policy. */
  "refresh_subsection_not_501c3",
] as const;
export type NonprofitReverifyReason = (typeof NONPROFIT_REVERIFY_REASONS)[number];
/** Carried by every refresh-driven review, so the queue can filter the pass. */
export const NONPROFIT_REVERIFY_FLAG = "reverify_after_irs_refresh";
/** Refresh-driven reviews are uncertain cases, never fraud. */
export const NONPROFIT_REVERIFY_REASON_CLASS: NonprofitReasonClass = "possible-match";

// ── The pure decision: does this org still qualify? ───────────────────────────
/** The slice of the NEW mirror row the re-check reads. */
export interface ReverifyMirrorRecord {
  ein: string;
  status?: string | null;
  subsection?: string | null;
  posting_date?: string | null;
}
export interface ReverifySignals {
  ein: string;
  /** The new mirror's BMF row, or NULL when the new extract no longer carries the EIN. */
  bmf: ReverifyMirrorRecord | null;
  /** TRUE when the new revocation list carries this EIN. */
  onRevocationList: boolean;
  /** Owner decision (a). Defaults to the shipped policy (501(c)(3) only). */
  subsectionPolicy?: NonprofitSubsectionPolicy;
}
export interface ReverifyDecision {
  action: "keep" | "route_to_review";
  reason: NonprofitReverifyReason | null;
  /** Reviewer-facing sentence (stored as `review_notes` and in the audit evidence). */
  message: string;
}
/**
 * The re-check itself. Total and pure: every input returns either "keep" (nothing about the
 * org changed) or "route_to_review" with one machine reason — there is no third outcome and
 * NO automatic revocation.
 *
 * ORDER MATTERS. A revocation entry is the strongest signal and is checked first; then a
 * vanished EIN (its status is unknowable); then STATUS; then the 501(c)(3) policy. The
 * policy check is last on purpose: a 501(c)(3) that became revoked must be labelled revoked,
 * not merely "wrong subsection".
 */
export function decideApprovedOrgRereverification(signals: ReverifySignals): ReverifyDecision {
  const policy = signals.subsectionPolicy ?? NONPROFIT_SUBSECTION_POLICY;
  if (signals.onRevocationList) {
    return {
      action: "route_to_review",
      reason: "refresh_revoked",
      message:
        "The IRS automatic-revocation list now carries this EIN, so the organization's exemption may have been revoked after it was approved.",
    };
  }
  if (signals.bmf == null) {
    return {
      action: "route_to_review",
      reason: "refresh_record_missing",
      message: "The new IRS extract no longer lists this EIN at all.",
    };
  }
  const status = signals.bmf.status ?? null;
  if (!BMF_STATUS_AUTO_APPROVE.includes(String(status ?? ""))) {
    const meaning = bmfStatusMeaning(status);
    return {
      action: "route_to_review",
      reason: "refresh_status_not_active",
      message:
        `The new IRS extract shows exemption status ${status ?? "(none)"}` +
        `${meaning ? ` (${meaning})` : ""} — only status 01 or 02 can be verified automatically.`,
    };
  }
  if (!isEligibleSubsection(signals.bmf.subsection, policy)) {
    const subsection = signals.bmf.subsection ?? null;
    const label = subsectionLabel(subsection);
    return {
      action: "route_to_review",
      reason: "refresh_subsection_not_501c3",
      message:
        `The new IRS extract lists subsection ${subsection ?? "(none)"}${label ? ` (${label})` : ""}` +
        ` — Nonprofit Free auto-approves 501(c)(3) organizations only (subsection ${NONPROFIT_501C3_SUBSECTION}).`,
    };
  }
  return {
    action: "keep",
    reason: null,
    message: "The new IRS extract still satisfies every auto-approve signal — unchanged.",
  };
}

// ── The pass over every approved application ─────────────────────────────────
/** One application as the pass reads it (the "before" side of the audit record). */
export interface ApprovedNonprofitApplication {
  user_id: number;
  ein: string;
  org_name: string | null;
  bmf_status: string | null;
  bmf_subsection: string | null;
  bmf_posting_date: string | null;
  on_revocation_list: boolean | null;
}
/** What the NEW mirror says about the org (the "after" side). */
export interface ReverifyCurrentRecord {
  bmfStatus: string | null;
  bmfSubsection: string | null;
  bmfPostingDate: string | null;
  onRevocationList: boolean;
}
/** Everything one routed application needs written, decided in TypeScript, not SQL. */
export interface ReverifyRouteInput {
  application: ApprovedNonprofitApplication;
  reason: NonprofitReverifyReason;
  message: string;
  /** The POSTING DATE OF THE NEW EXTRACT — the audit anchor ("which refresh changed this"). */
  postingDate: string | null;
  current: ReverifyCurrentRecord;
  /** The full `evidence` payload (jsonb) to merge onto the row. */
  evidence: Record<string, unknown>;
}
export interface NonprofitReverifyStore {
  /** The IRS read side: the SAME local lookups the verification engine uses. */
  mirror: IrsMirrorStore;
  /** Every application whose status is `approved` right now. */
  listApprovedApplications(): Promise<ApprovedNonprofitApplication[]>;
  /**
   * Route one approved organization back to manual review. MUST be guarded on
   * `status = 'approved'` so a human decision made concurrently is never overwritten.
   * Returns TRUE when a row was written, FALSE when the row was no longer approved.
   */
  routeToReview(route: ReverifyRouteInput): Promise<boolean>;
}
export interface ReverifyEntry {
  user_id: number;
  ein: string;
  action: "keep" | "route_to_review";
  reason: NonprofitReverifyReason | null;
}
export interface NonprofitReverifySummary {
  /** The posting date of the refresh that ran the pass (null when unknown). */
  postingDate: string | null;
  /** Applications examined. */
  checked: number;
  kept: number;
  routed: number;
  /** Route attempts that found the row was no longer `approved` (a human got there first). */
  skipped: number;
  /** Per-application problems. Never fatal, never an approval. */
  failures: string[];
  entries: ReverifyEntry[];
}
export interface NonprofitReverifyContext {
  /** The posting date of the import that just swapped into place. */
  postingDate: string | null;
  /** Owner decision (a) override (tests). Defaults to the shipped policy. */
  subsectionPolicy?: NonprofitSubsectionPolicy;
  /** Injectable clock for deterministic evidence. */
  now?: Date;
  log?: (message: string) => void;
}
/** The shape `refreshIrsSource` injects (and `main()` wires to Neon). */
export type NonprofitReverifyRunner = (
  context: NonprofitReverifyContext,
) => Promise<NonprofitReverifySummary>;

function errorMessage(error: unknown): string {
  return ((error as Error)?.message ?? String(error)).slice(0, 300);
}
export function emptyReverifySummary(
  postingDate: string | null,
  failure?: string,
): NonprofitReverifySummary {
  return {
    postingDate,
    checked: 0,
    kept: 0,
    routed: 0,
    skipped: 0,
    failures: failure ? [failure] : [],
    entries: [],
  };
}
/**
 * The audit record written to `nonprofit_applications.evidence` (jsonb). It is built HERE,
 * not in SQL, so a unit test can prove the refresh posting date is on it: the owner's rule
 * is that a refresh-driven review is traceable to the extract that caused it.
 */
export function buildReverifyEvidence(input: {
  reason: NonprofitReverifyReason;
  message: string;
  postingDate: string | null;
  previous: ReverifyCurrentRecord;
  current: ReverifyCurrentRecord;
  checkedAt: string;
}): Record<string, unknown> {
  return {
    // Nested so the merge (`evidence || …`) can never clobber the original decision record.
    refresh_reverify: {
      engine: NONPROFIT_VERIFICATION_ENGINE,
      source: IRS_SOURCE_LABEL,
      trigger: "post_refresh_reverify",
      reason: input.reason,
      reason_class: NONPROFIT_REVERIFY_REASON_CLASS,
      message: input.message,
      // WHICH refresh caused this — the audit anchor the owner asked for.
      posting_date: input.postingDate,
      checked_at: input.checkedAt,
      previous: {
        bmf_status: input.previous.bmfStatus,
        bmf_subsection: input.previous.bmfSubsection,
        bmf_posting_date: input.previous.bmfPostingDate,
        on_revocation_list: input.previous.onRevocationList,
      },
      current: {
        bmf_status: input.current.bmfStatus,
        bmf_subsection: input.current.bmfSubsection,
        bmf_posting_date: input.current.bmfPostingDate,
        on_revocation_list: input.current.onRevocationList,
      },
      flags: [NONPROFIT_REVERIFY_FLAG, input.reason],
    },
  };
}
/**
 * Run the pass: every `approved` application, re-checked against the NEW mirror.
 *
 * FAIL-SOFT BY DESIGN: one unreadable record (or one failed write) is recorded in
 * `failures` and the pass carries on with the next organization. It never throws on a
 * per-application problem, because the caller's mirror has already swapped successfully and
 * an outage in this pass must not be reported as a failed import. Nothing is retried within
 * one pass — the NEXT refresh re-reads the same live mirror and re-detects anything that
 * still differs, so the pass is idempotent.
 */
export async function runNonprofitPostRefreshReverify(
  context: NonprofitReverifyContext,
  store: NonprofitReverifyStore = neonNonprofitReverifyStore,
): Promise<NonprofitReverifySummary> {
  const summary = emptyReverifySummary(context.postingDate);
  const checkedAt = (context.now ?? new Date()).toISOString();
  let applications: ApprovedNonprofitApplication[];
  try {
    applications = await store.listApprovedApplications();
  } catch (error) {
    summary.failures.push(`list_approved_applications_failed:${errorMessage(error)}`);
    context.log?.(
      `[nonprofit-reverify] could not read approved applications — ${errorMessage(error)}`,
    );
    return summary;
  }
  for (const application of applications) {
    summary.checked += 1;
    try {
      const [bmf, revocations] = await Promise.all([
        store.mirror.findBmfByEin(application.ein),
        store.mirror.findRevocationsByEin(application.ein),
      ]);
      const current: ReverifyCurrentRecord = {
        bmfStatus: bmf?.status ?? null,
        bmfSubsection: bmf?.subsection ?? null,
        bmfPostingDate: bmf?.posting_date ?? null,
        onRevocationList: revocations.length > 0,
      };
      const decision = decideApprovedOrgRereverification({
        ein: application.ein,
        bmf: bmf ? { ein: bmf.ein, status: bmf.status, subsection: bmf.subsection } : null,
        onRevocationList: current.onRevocationList,
        subsectionPolicy: context.subsectionPolicy,
      });
      if (decision.action === "keep" || decision.reason == null) {
        summary.kept += 1;
        summary.entries.push({
          user_id: application.user_id,
          ein: application.ein,
          action: "keep",
          reason: null,
        });
        continue;
      }
      const route: ReverifyRouteInput = {
        application,
        reason: decision.reason,
        message: decision.message,
        postingDate: context.postingDate,
        current,
        evidence: buildReverifyEvidence({
          reason: decision.reason,
          message: decision.message,
          postingDate: context.postingDate,
          previous: {
            bmfStatus: application.bmf_status,
            bmfSubsection: application.bmf_subsection,
            bmfPostingDate: application.bmf_posting_date,
            onRevocationList: application.on_revocation_list === true,
          },
          current,
          checkedAt,
        }),
      };
      const written = await store.routeToReview(route);
      if (written) {
        summary.routed += 1;
        summary.entries.push({
          user_id: application.user_id,
          ein: application.ein,
          action: "route_to_review",
          reason: decision.reason,
        });
        context.log?.(
          `[nonprofit-reverify] user=${application.user_id} ein=${application.ein} ` +
            `→ manual_review (${decision.reason}, refresh ${context.postingDate ?? "unknown"})`,
        );
      } else {
        // Someone (a human) already moved this row off `approved` — leave it alone.
        summary.skipped += 1;
        summary.entries.push({
          user_id: application.user_id,
          ein: application.ein,
          action: "keep",
          reason: decision.reason,
        });
      }
    } catch (error) {
      summary.failures.push(`reverify_failed:user=${application.user_id}:${errorMessage(error)}`);
    }
  }
  return summary;
}

// ── The production store (Neon) ──────────────────────────────────────────────
export const neonNonprofitReverifyStore: NonprofitReverifyStore = {
  mirror: neonIrsMirrorStore,
  async listApprovedApplications() {
    const rows = (await sql()`
      SELECT user_id, ein, org_name, bmf_status, bmf_subsection,
             bmf_posting_date::text AS bmf_posting_date, on_revocation_list
      FROM nonprofit_applications
      WHERE status = 'approved'
      ORDER BY user_id
    `) as {
      user_id: number;
      ein: string;
      org_name: string | null;
      bmf_status: string | null;
      bmf_subsection: string | null;
      bmf_posting_date: string | null;
      on_revocation_list: boolean | null;
    }[];
    return rows.map((row) => ({ ...row, ein: String(row.ein).padStart(9, "0") }));
  },
  async routeToReview(route) {
    // THE ONLY MUTATION ON THE STATUS-CHANGE PATH (the owner's implementation lock,
    // 2026-09-21): ONE UPDATE of `nonprofit_applications`, GUARDED on
    // `status = 'approved'` so a human's decision made concurrently is never overwritten.
    // There is NO DELETE and NO cascade here — not of this application row, and nothing at
    // all against `users` or `saved_grants`. An org whose IRS status changed keeps its
    // account, its login and every saved grant while a human reviews it; it loses only the
    // VERIFIED entitlement (it drops to the pending tier — see nonprofitSearchPolicy in
    // nonprofit.server.ts). Suspension is a status change on this one row, never a delete.
    //
    // The row keeps its history: `evidence` is MERGED (never replaced), so the original
    // auto-approve record and this refresh-driven review both survive; the previous BMF
    // values also live inside the new audit block.
    const rows = (await sql()`
      UPDATE nonprofit_applications
      SET status = 'manual_review',
          decision = 'manual_review',
          decision_reason = ${route.reason},
          reason_class = ${NONPROFIT_REVERIFY_REASON_CLASS},
          supporting_docs_requested = FALSE,
          decision_flags = array_append(
            array_append(decision_flags, ${NONPROFIT_REVERIFY_FLAG}::text),
            ${route.reason}::text
          ),
          bmf_status = ${route.current.bmfStatus},
          bmf_subsection = ${route.current.bmfSubsection},
          bmf_posting_date = ${route.current.bmfPostingDate},
          on_revocation_list = ${route.current.onRevocationList},
          review_notes = ${route.message},
          evidence = evidence || ${JSON.stringify(route.evidence)}::jsonb,
          updated_at = NOW()
      WHERE user_id = ${route.application.user_id}
        AND status = 'approved'
      RETURNING user_id
    `) as { user_id: number }[];
    return rows.length > 0;
  },
};
