/**
 * Nonprofit Free phase 2 (unit B) — the admin review queue, DETERMINISTIC, ZERO network,
 * ZERO database.
 *
 * WHAT THIS PROVES, in the owner's terms:
 *   • approve moves a row to `approved` with `verification_method='manual_exception'`, a
 *     `granted_at`, a `reverify_due_at` and `reviewed_by = "user:<id> <<email>>"` — and
 *     leaves the engine's `decision`/`reason_class` alone;
 *   • deny REQUIRES a typed note; request-info keeps the row in review and sets
 *     `supporting_docs_requested`; release sets `released_at` and never invents a status;
 *   • every action is a GUARDED update whose status list is the documented one, and a
 *     0-row guard is a 409 "already actioned" that writes NO audit row;
 *   • exactly ONE append-only audit row per action, carrying the status before and after;
 *   • the SLA clock excludes weekends, the copy says "within 3 business days" and never a
 *     computed due-by date;
 *   • the reviewer projection never carries the EIN, never carries the applicant-facing
 *     `heldByUserId` shape, and the queue list never carries the EIN-conflict claimant;
 *   • migration 046's `action` CHECK carries `request_info` AND still carries `transfer`,
 *     in both 046 and the src/db/schema.sql mirror;
 *   • the reviewer surface contains no forbidden phrase, no billing token, and no
 *     `*.server` import (the build-breaking mistake Unit A hit).
 *
 * The DB half of this proof (guarded UPDATE against a real database, the partial unique
 * index, one audit row per action) lives in nonprofit-review.integration.test.ts and is
 * CI-only by opt-in: the sandbox DATABASE_URL IS production.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  FORBIDDEN_NONPROFIT_PATTERNS,
  FORBIDDEN_NONPROFIT_PHRASES,
  NONPROFIT_REVIEW_DENY_NOTE_REQUIRED,
  NONPROFIT_REVIEW_DOMAIN_LABEL,
  NONPROFIT_REVIEW_REFRESH_FLAG,
  NONPROFIT_REVIEW_SLA_WORDING,
  nonprofitCopyStrings,
  nonprofitReviewElapsedCopy,
} from "~/lib/nonprofit-copy";
import { NONPROFIT_REVERIFY_FLAG } from "~/lib/nonprofit-reverify.server";
import {
  NONPROFIT_REVIEW_ACTIONS,
  NONPROFIT_REVIEW_ACTION_GUARDS,
  NONPROFIT_REVIEW_ALREADY_ACTIONED,
  businessDaysBetween,
  buildNonprofitDecisionStatement,
  calendarDaysBetween,
  decideNonprofitApplication,
  isNonprofitQueueFilter,
  isNonprofitReviewAction,
  nonprofitReviewAge,
  planNonprofitReviewDecision,
  reviewedByFor,
  statusesForQueueFilter,
  type NonprofitReviewAuditRow,
  type NonprofitReviewDeps,
  type NonprofitReviewDetail,
  type NonprofitReviewPlan,
} from "~/lib/nonprofit-review.server";

const FIXED_NOW = new Date("2026-09-21T12:00:00.000Z"); // a Monday
const ACTOR = { id: 18, email: "minetreen@gmail.com" };

/** Code only — a doc comment may legitimately NAME the thing it forbids. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

// ── The reviewer projection, as a fixture (no database) ───────────────────────
function detailFixture(status: string): NonprofitReviewDetail {
  const base = {
    id: 1,
    orgName: "Maine Association of Nonprofits",
    workEmail: "director@example.org",
    website: "https://example.org",
    state: "ME",
    contactName: "Dana Director",
    contactRole: "Executive Director",
    status,
    decision: "manual_review",
    decisionReason: "ein_not_found",
    reasonClass: "no-match-request-docs",
    submittedNameNormalized: "MAINE ASSOCIATION OF NONPROFITS",
    matchedBmfName: null,
    bmfNameTier: null,
    bmfStatus: null,
    bmfSubsection: null,
    bmfGroupNo: null,
    bmfPostingDate: null,
    bmfSourceRef: null,
    pub78: null,
    pub78DeductibilityCode: null,
    onRevocationList: null,
    revocationDate: null,
    revocationPostingDate: null,
    reinstatementDate: null,
    decisionFlags: [] as string[],
    evidence: null,
    supportingDocsRequested: false,
    releasedAt: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    grantedAt: null,
    reverifyDueAt: null,
    createdAt: FIXED_NOW.toISOString(),
    updatedAt: FIXED_NOW.toISOString(),
    granted: status === "approved",
    age: { calendarDays: 0, businessDays: 0 },
  };
  return {
    ...base,
    irs: {
      decision: base.decision,
      decisionReason: base.decisionReason,
      reasonClass: base.reasonClass,
      decisionFlags: [],
      matchedBmfName: null,
      bmfNameTier: null,
      bmfStatus: null,
      bmfStatusMeaning: null,
      bmfSubsection: null,
      bmfSubsectionLabel: null,
      bmfGroupNo: null,
      bmfPostingDate: null,
      bmfSourceRef: null,
      pub78: null,
      pub78DeductibilityCode: null,
      onRevocationList: null,
      revocationDate: null,
      revocationPostingDate: null,
      reinstatementDate: null,
      decidedBy: "system",
      decidedAt: FIXED_NOW.toISOString(),
    },
    einClaim: null,
    refreshReverify: null,
    domainSignal: { label: NONPROFIT_REVIEW_DOMAIN_LABEL, corresponds: true, checked: "example.org", basis: "website" },
    audit: [],
  };
}

/**
 * The injected dependencies. `applyDecision` mirrors the real SQL executor's contract: it
 * returns the audit row the same statement wrote, or null when the guard matched nothing.
 */
function harness(options: { status?: string; guardMatches?: boolean } = {}) {
  const applied: NonprofitReviewPlan[] = [];
  const audit: NonprofitReviewAuditRow[] = [];
  const deps: NonprofitReviewDeps = {
    loadApplication: async (id: number) => (id === 1 ? detailFixture(options.status ?? "manual_review") : null),
    applyDecision: async (plan) => {
      applied.push(plan);
      if (options.guardMatches === false) return null;
      const row: NonprofitReviewAuditRow = {
        applicationId: plan.applicationId,
        action: plan.action,
        actorUserId: plan.actorUserId,
        actorEmail: plan.actorEmail,
        reasonCode: null,
        internalNote: plan.reviewNotes,
        priorStatus: options.status ?? "manual_review",
        newStatus: plan.newStatus,
        createdAt: plan.reviewedAt,
      };
      audit.push(row);
      return row;
    },
    now: () => FIXED_NOW,
  };
  return { deps, applied, audit };
}

// ── The transitions ───────────────────────────────────────────────────────────
describe("the reviewer's four transitions (owner lock 2026-09-21)", () => {
  test("approve grants the tier: manual_exception, a grant clock and the immutable reviewer id", () => {
    const planned = planNonprofitReviewDecision({
      applicationId: 1,
      action: "approve",
      note: "checked the IRS record",
      actor: ACTOR,
      currentStatus: "manual_review",
      now: FIXED_NOW,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const plan = planned.plan;
    expect(plan.newStatus).toBe("approved");
    expect(plan.verificationMethod).toBe("manual_exception");
    expect(plan.grantsIfMissing).toBe(true);
    expect(plan.reviewedBy).toBe(`user:18 <minetreen@gmail.com>`);
    expect(plan.reviewedAt).toBe(FIXED_NOW.toISOString());
    expect(plan.reverifyDueAt).toBe(new Date(FIXED_NOW.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString());
    // The engine's verdict is NOT overwritten by a human decision: the plan has no field
    // for `decision` or `reason_class` at all.
    expect(Object.keys(plan)).not.toContain("decision");
    expect(Object.keys(plan)).not.toContain("reasonClass");
  });

  test("deny requires a TYPED note, and refuses without one", () => {
    const refused = planNonprofitReviewDecision({
      applicationId: 1,
      action: "deny",
      note: "   ",
      actor: ACTOR,
      currentStatus: "pending",
      now: FIXED_NOW,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.status).toBe(400);
    expect(refused.error).toBe(NONPROFIT_REVIEW_DENY_NOTE_REQUIRED);

    const planned = planNonprofitReviewDecision({
      applicationId: 1,
      action: "deny",
      note: "identity contradicts the application",
      actor: ACTOR,
      currentStatus: "manual_review",
      now: FIXED_NOW,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.newStatus).toBe("denied");
    expect(planned.plan.reviewNotes).toBe("identity contradicts the application");
    expect(planned.plan.verificationMethod).toBeNull();
    expect(planned.plan.grantsIfMissing).toBe(false);
    expect(planned.plan.reverifyDueAt).toBeNull();
  });

  test("request-info keeps the row in review, sets the doc flag, and cannot double-apply", () => {
    const planned = planNonprofitReviewDecision({
      applicationId: 1,
      action: "request_info",
      note: "asked for the IRS determination letter",
      actor: ACTOR,
      currentStatus: "pending",
      now: FIXED_NOW,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.newStatus).toBe("manual_review");
    expect(planned.plan.setsSupportingDocsRequested).toBe(true);
    expect(planned.plan.grantsIfMissing).toBe(false);
    // Without this guard a replay would match again (the status does not change) and file a
    // second audit row for one decision.
    expect(planned.plan.requireNoOutstandingDocRequest).toBe(true);
  });

  test("release sets released_at, keeps the status, and only applies to a held EIN", () => {
    const planned = planNonprofitReviewDecision({
      applicationId: 1,
      action: "release",
      actor: ACTOR,
      currentStatus: "denied",
      now: FIXED_NOW,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    // No invented 'released' status: 045's CHECK has none, and the owner's lock is an EIN
    // release, not a status change.
    expect(planned.plan.setsStatus).toBe(false);
    expect(planned.plan.newStatus).toBe("denied");
    expect(planned.plan.releasedAt).toBe(FIXED_NOW.toISOString());
    expect(planned.plan.requireReleasedAtNull).toBe(true);
  });

  test("each action's guard is the documented status list", () => {
    expect(NONPROFIT_REVIEW_ACTION_GUARDS.approve).toEqual(["pending", "manual_review"]);
    expect(NONPROFIT_REVIEW_ACTION_GUARDS.deny).toEqual(["pending", "manual_review"]);
    expect(NONPROFIT_REVIEW_ACTION_GUARDS.request_info).toEqual(["pending", "manual_review"]);
    expect(NONPROFIT_REVIEW_ACTION_GUARDS.release).toEqual(["denied", "revoked"]);
  });

  test("transfer is not dispatchable, and the action validator is strict", () => {
    expect(NONPROFIT_REVIEW_ACTIONS).toEqual(["approve", "deny", "request_info", "release"]);
    expect(isNonprofitReviewAction("approve")).toBe(true);
    expect(isNonprofitReviewAction("transfer")).toBe(false);
    expect(isNonprofitReviewAction("suspend")).toBe(false);
    expect(isNonprofitReviewAction("")).toBe(false);
    expect(isNonprofitReviewAction(null)).toBe(false);
  });

  test("the reviewer identity is the immutable id + email pair", () => {
    expect(reviewedByFor({ id: 7, email: "a@b.org" })).toBe("user:7 <a@b.org>");
  });
});

// ── The guarded statement ─────────────────────────────────────────────────────
describe("the guarded UPDATE + audit INSERT statement", () => {
  const plan = (action: NonprofitReviewPlan["action"], status = "manual_review"): NonprofitReviewPlan => {
    const planned = planNonprofitReviewDecision({
      applicationId: 42,
      action,
      note: "note",
      actor: ACTOR,
      currentStatus: status as NonprofitReviewPlan["newStatus"],
      now: FIXED_NOW,
    });
    if (!planned.ok) throw new Error("plan refused");
    return planned.plan;
  };

  test("every action is ONE parameterized statement, guarded by the status list", () => {
    for (const action of NONPROFIT_REVIEW_ACTIONS) {
      const statement = buildNonprofitDecisionStatement(plan(action, action === "release" ? "denied" : "manual_review"));
      expect(statement.text).toContain("UPDATE nonprofit_applications");
      expect(statement.text).toContain("status = ANY(");
      expect(statement.text).toContain("::text[]");
      expect(statement.text).toContain("INSERT INTO nonprofit_application_reviews");
      // One statement: the driver rejects multi-statement text, and the audit row must be
      // written by the SAME statement as the update.
      expect(statement.text.split(";").length).toBe(1);
      expect(statement.text).not.toContain("NOW()");
      // The action value is a bound parameter, never interpolated text.
      expect(statement.params).toContain(action);
    }
  });

  test("release never writes status; approve writes the manual exception and the clock", () => {
    const release = buildNonprofitDecisionStatement(plan("release", "denied"));
    expect(release.text).not.toContain("status = $");
    expect(release.text).toContain("released_at = $");
    expect(release.text).toContain("released_at IS NULL");

    const approve = buildNonprofitDecisionStatement(plan("approve"));
    expect(approve.text).toContain("status = $");
    expect(approve.text).toContain("verification_method = $");
    expect(approve.text).toContain("granted_at = COALESCE(granted_at, $");
    expect(approve.text).toContain("reverify_due_at = $");
    // The engine's columns are never in the SET list.
    expect(approve.text).not.toMatch(/SET[\s\S]*\bdecision = /);
    expect(approve.text).not.toMatch(/\breason_class = /);
  });

  test("the doc-request guard is only on request-info", () => {
    expect(buildNonprofitDecisionStatement(plan("request_info")).text).toContain("supporting_docs_requested = FALSE");
    expect(buildNonprofitDecisionStatement(plan("approve")).text).not.toContain("supporting_docs_requested = FALSE");
  });
});

// ── The endpoint's behaviour, with the database injected out ──────────────────
describe("decideNonprofitApplication (injected deps: no database, no clock)", () => {
  test("an approval writes exactly ONE audit row carrying the status before and after", async () => {
    const { deps, applied, audit } = harness({ status: "manual_review" });
    const result = await decideNonprofitApplication(
      { applicationId: 1, action: "approve", note: "ok", actor: ACTOR },
      deps,
    );
    expect(result.status).toBe(200);
    expect(result.body.newStatus).toBe("approved");
    expect(result.body.priorStatus).toBe("manual_review");
    expect(result.body.reviewedBy).toBe("user:18 <minetreen@gmail.com>");
    expect(applied).toHaveLength(1);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("approve");
    expect(audit[0]!.priorStatus).toBe("manual_review");
    expect(audit[0]!.newStatus).toBe("approved");
  });

  test("a 0-row guard is a 409 and writes NOTHING (already actioned)", async () => {
    const { deps, applied, audit } = harness({ status: "manual_review", guardMatches: false });
    const result = await decideNonprofitApplication(
      { applicationId: 1, action: "approve", actor: ACTOR },
      deps,
    );
    expect(result.status).toBe(409);
    expect(result.body.error).toBe(NONPROFIT_REVIEW_ALREADY_ACTIONED);
    // The UPDATE ran (and matched nothing), so no audit row can exist for an action that
    // never happened.
    expect(applied).toHaveLength(1);
    expect(audit).toHaveLength(0);
  });

  test("a deny without a note is a 400 and applies nothing at all", async () => {
    const { deps, applied, audit } = harness();
    const result = await decideNonprofitApplication({ applicationId: 1, action: "deny", actor: ACTOR }, deps);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe(NONPROFIT_REVIEW_DENY_NOTE_REQUIRED);
    expect(applied).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  test("an unknown action and a missing id are 400; an unknown application is 404", async () => {
    const { deps, applied } = harness();
    expect((await decideNonprofitApplication({ applicationId: 1, action: "archive", actor: ACTOR }, deps)).status).toBe(400);
    expect((await decideNonprofitApplication({ applicationId: 0, action: "approve", actor: ACTOR }, deps)).status).toBe(400);
    expect((await decideNonprofitApplication({ applicationId: 99, action: "approve", actor: ACTOR }, deps)).status).toBe(404);
    expect(applied).toHaveLength(0);
  });

  test("request-info reports the open doc request and leaves the status in review", async () => {
    const { deps, audit } = harness({ status: "pending" });
    const result = await decideNonprofitApplication(
      { applicationId: 1, action: "request_info", note: "need the determination letter", actor: ACTOR },
      deps,
    );
    expect(result.status).toBe(200);
    expect(result.body.newStatus).toBe("manual_review");
    expect(result.body.supportingDocsRequested).toBe(true);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("request_info");
    expect(audit[0]!.priorStatus).toBe("pending");
    expect(audit[0]!.newStatus).toBe("manual_review");
  });

  test("release reports the release and keeps the status in the response", async () => {
    const { deps, audit } = harness({ status: "denied" });
    const result = await decideNonprofitApplication({ applicationId: 1, action: "release", actor: ACTOR }, deps);
    expect(result.status).toBe(200);
    expect(result.body.newStatus).toBe("denied");
    expect(result.body.releasedAt).toBe(FIXED_NOW.toISOString());
    expect(audit).toHaveLength(1);
    expect(audit[0]!.priorStatus).toBe("denied");
    expect(audit[0]!.newStatus).toBe("denied");
  });
});

// ── The SLA clock and its copy ────────────────────────────────────────────────
describe("the SLA clock (weekends excluded, public holidays NOT modelled)", () => {
  test("the same day is zero, and a weekend adds nothing", () => {
    // 2026-09-18 is a Friday; 2026-09-21 the following Monday.
    expect(businessDaysBetween("2026-09-18T09:00:00.000Z", "2026-09-18T17:00:00.000Z")).toBe(0);
    expect(businessDaysBetween("2026-09-18T09:00:00.000Z", "2026-09-19T09:00:00.000Z")).toBe(0);
    expect(businessDaysBetween("2026-09-18T09:00:00.000Z", "2026-09-20T09:00:00.000Z")).toBe(0);
    expect(businessDaysBetween("2026-09-18T09:00:00.000Z", "2026-09-21T09:00:00.000Z")).toBe(1);
    expect(businessDaysBetween("2026-09-18T09:00:00.000Z", "2026-09-22T09:00:00.000Z")).toBe(2);
  });

  test("a full working week is five business days but seven calendar days", () => {
    expect(businessDaysBetween("2026-09-14T09:00:00.000Z", "2026-09-21T09:00:00.000Z")).toBe(5);
    expect(calendarDaysBetween("2026-09-14T09:00:00.000Z", "2026-09-21T09:00:00.000Z")).toBe(7);
    // A later `to` is not a negative age.
    expect(calendarDaysBetween("2026-09-21T09:00:00.000Z", "2026-09-14T09:00:00.000Z")).toBe(0);
  });

  test("the age object pairs the calendar and business counts", () => {
    const age = nonprofitReviewAge("2026-09-16T12:00:00.000Z", FIXED_NOW);
    expect(age.calendarDays).toBe(5);
    expect(age.businessDays).toBe(3);
    expect(nonprofitReviewElapsedCopy(age.businessDays)).toBe("3 business days elapsed");
    expect(nonprofitReviewElapsedCopy(1)).toBe("1 business day elapsed");
    expect(nonprofitReviewElapsedCopy(0)).toBe("received today");
  });

  test("the copied SLA is the owner's wording — never a date, never a promise of instant", () => {
    const strings = nonprofitCopyStrings();
    const sla = strings.filter((entry) => entry.includes("business day"));
    expect(sla.length).toBeGreaterThan(0);
    expect(NONPROFIT_REVIEW_SLA_WORDING).toBe("within 3 business days");
    expect(strings.join(" \n ")).toContain(NONPROFIT_REVIEW_SLA_WORDING);
    for (const entry of strings) {
      // No computed due-by date and no "instant" claim (holidays are not modelled).
      expect(entry).not.toMatch(/\bdue (by|on)\b/i);
      expect(entry).not.toMatch(/\binstant/i);
      expect(entry).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    }
  });
});

// ── The queue filters ─────────────────────────────────────────────────────────
describe("the queue's default view and the tab that makes release reachable", () => {
  test("the default view is the two open statuses", () => {
    expect(statusesForQueueFilter("queue")).toEqual(["pending", "manual_review"]);
  });
  test("denied & revoked is a first-class, reachable view", () => {
    expect(statusesForQueueFilter("denied_revoked")).toEqual(["denied", "revoked"]);
    expect(statusesForQueueFilter("approved")).toEqual(["approved"]);
    expect(statusesForQueueFilter("all")).toBeNull();
  });
  test("the filter validator is strict", () => {
    expect(isNonprofitQueueFilter("denied_revoked")).toBe(true);
    expect(isNonprofitQueueFilter("denied")).toBe(false);
    expect(isNonprofitQueueFilter(undefined)).toBe(false);
  });
});

// ── The reviewer surface's rules ──────────────────────────────────────────────
const MODULE = read("./nonprofit-review.server.ts");
const PAGE = read("../routes/admin/nonprofits.tsx");
const API_LIST = read("../routes/api/admin/nonprofit-applications.ts");
const API_DECIDE = read("../routes/api/admin/nonprofit-decide.ts");
const UNIT_TEST = read("./nonprofit-review.test.ts");
const INTEGRATION_TEST = read("./nonprofit-review.integration.test.ts");
const MIGRATION_046 = read("../../db/migrations/046_nonprofit_reviews.sql");
const SCHEMA = read("../db/schema.sql");

describe("no forbidden phrase on the reviewer surface (the owner's wall, extended to unit B)", () => {
  test("the copy strings, the module, the routes, the page and both suites are clean", () => {
    // The DB suite names the `sessions` expiry COLUMN — an identifier, not copy — so that one
    // token is neutralised before the wall scans it (and asserted to really be the column).
    const neutralise = (source: string) => stripComments(source).replace(/expire[s]_at/g, " column ");
    // A bound SQL placeholder (`$1`, `$2`) is an identifier too, and the dollar-figure pattern
    // is about PRICES in copy: the placeholders are neutralised for the pattern scan.
    const neutraliseSql = (source: string) => neutralise(source).replace(/\$[0-9]/g, " param ");
    expect((INTEGRATION_TEST.match(/expire[s]_at/g) ?? []).length).toBeGreaterThan(0);
    const surfaces = [
      ...nonprofitCopyStrings(),
      ...[PAGE, API_LIST, API_DECIDE].map(stripComments),
      neutraliseSql(MODULE),
      neutralise(UNIT_TEST),
      neutralise(INTEGRATION_TEST),
    ];
    for (const text of surfaces) {
      for (const phrase of FORBIDDEN_NONPROFIT_PHRASES) {
        if (text.includes("FORBIDDEN_NONPROFIT_PHRASES")) continue;
        expect(`${phrase}:${text.toLowerCase().includes(phrase)}`).toBe(`${phrase}:false`);
      }
      for (const pattern of FORBIDDEN_NONPROFIT_PATTERNS) {
        expect(pattern.test(text)).toBe(false);
      }
    }
  });

  test("the domain signal carries the owner's label verbatim", () => {
    expect(NONPROFIT_REVIEW_DOMAIN_LABEL).toBe("secondary signal — never a verdict");
    expect(MODULE).toContain("NONPROFIT_REVIEW_DOMAIN_LABEL");
    expect(PAGE).toContain("NONPROFIT_REVIEW_DOMAIN_LABEL");
    expect(PAGE).not.toMatch(/domainCorrespondsToName/);
  });

  test("the refresh flag and the reverify pass agree", () => {
    expect(NONPROFIT_REVIEW_REFRESH_FLAG).toBe(NONPROFIT_REVERIFY_FLAG);
    expect(PAGE).toContain("NONPROFIT_REVIEW_REFRESH_FLAG");
  });
});

describe("no billing surface anywhere in the review queue", () => {
  test("the new CODE never mentions a billing, card or subscription token", () => {
    // The two suites are excluded for the obvious reason: an assertion that names a token
    // has to contain it (Unit A's scan draws the same line).
    for (const [path, source] of [
      ["./nonprofit-review.server.ts", MODULE],
      ["../routes/api/admin/nonprofit-applications.ts", API_LIST],
      ["../routes/api/admin/nonprofit-decide.ts", API_DECIDE],
      ["../routes/admin/nonprofits.tsx", PAGE],
    ] as const) {
      const code = stripComments(source);
      expect(`${path}:${/\bstripe\b/i.test(code)}`).toBe(`${path}:false`);
      expect(`${path}:${/\bbilling\b/i.test(code)}`).toBe(`${path}:false`);
      expect(`${path}:${/\bprice\b|\bpricing\b/i.test(code)}`).toBe(`${path}:false`);
      expect(`${path}:${/\bplan_tier\b|\bplanTier\b/i.test(code)}`).toBe(`${path}:false`);
      expect(`${path}:${/\bsubscription\b/i.test(code)}`).toBe(`${path}:false`);
      expect(`${path}:${/\bcard\b/i.test(code)}`).toBe(`${path}:false`);
      expect(`${path}:${/\bcheckout\b/i.test(code)}`).toBe(`${path}:false`);
    }
  });
});

describe("the audit trail is append-only and the reviewer projection is minimal", () => {
  test("nothing in the new code updates or deletes the reviews table", () => {
    for (const source of [MODULE, API_LIST, API_DECIDE, PAGE]) {
      const code = stripComments(source);
      expect(/UPDATE\s+nonprofit_application_reviews/i.test(code)).toBe(false);
      expect(/DELETE\s+FROM\s+nonprofit_application_reviews/i.test(code)).toBe(false);
      expect(/\bTRUNCATE\s+TABLE\b/i.test(code)).toBe(false);
    }
    // ...and the only write is the INSERT, in the same statement as the guarded update.
    expect(MODULE).toContain("INSERT INTO nonprofit_application_reviews");
  });

  test("the EIN is never selected, and the claimant is a detail-only field", () => {
    // Neither the queue nor the detail SELECTs the EIN column (owner rule: never displayed).
    const columns = stripComments(
      MODULE.slice(MODULE.indexOf("const APPLICATION_COLUMNS"), MODULE.indexOf("function isoOrNull")),
    );
    expect(columns).not.toMatch(/\bein\b/i);
    // The conflict claimant is never exposed under the applicant-facing identifier.
    for (const source of [MODULE, API_LIST, API_DECIDE, PAGE]) {
      expect(source).not.toContain("heldByUserId");
      expect(source).not.toContain("held_by_user_id");
    }
    // The applicant-facing read has no path to it either.
    const applicantStatus = read("../routes/api/nonprofit/status.ts");
    const applicantApply = read("../routes/api/nonprofit/apply.ts");
    for (const source of [applicantStatus, applicantApply]) {
      expect(source).not.toContain("claimedByUserId");
      expect(source).not.toContain("einClaim");
    }
    // The list projection is an explicit pick with no evidence blob and no claim.
    const projector = MODULE.slice(
      MODULE.indexOf("function toQueueRow"),
      MODULE.indexOf("export async function listNonprofitApplications"),
    );
    expect(projector).not.toContain("evidence");
    expect(projector).not.toContain("einClaim");
  });

  test("the reviewer page is admin-only chrome that imports no server module", () => {
    expect(PAGE).toContain('createFileRoute("/admin/nonprofits")');
    expect(PAGE).toContain('content: "noindex, nofollow"');
    expect(PAGE).toContain("getCurrentUser()");
    expect(PAGE).toContain('throw redirect({ to: "/login" })');
    expect(PAGE).toContain("/dashboard?notice=admin-only");
    expect(PAGE).not.toMatch(/from "~\/lib\/nonprofit-review\.server"/);
    expect(PAGE).not.toMatch(/from "~\/lib\/[a-z.-]*\.server"/);
    // The routes re-derive the admin gate on every request (the loader guard is UX only).
    expect(API_LIST).toContain("user.is_admin");
    expect(API_DECIDE).toContain("user.is_admin");
    expect(API_LIST).toContain('status: 401');
    expect(API_LIST).toContain('status: 403');
    expect(API_DECIDE).toContain('status: 401');
    expect(API_DECIDE).toContain('status: 403');
    // The four actions, and no transfer route.
    expect(API_DECIDE).toContain("isNonprofitReviewAction");
    // The doc comment legitimately NAMES the deferred action to explain why it is absent;
    // what must not exist is a transfer route or a transfer branch in the code.
    const decideCode = stripComments(API_DECIDE);
    expect(decideCode).not.toContain("transfer");
    expect(stripComments(MODULE)).not.toContain('"transfer"');
  });

  test("the queue page renders the SLA wording and the reachable release tab", () => {
    expect(PAGE).toContain("NONPROFIT_REVIEW_SLA_WORDING");
    expect(PAGE).toContain('label: "Denied & revoked"');
    expect(PAGE).toContain("nonprofitReviewElapsedCopy");
    expect(PAGE).toContain("/api/admin/nonprofit-decide");
    expect(PAGE).toContain("NONPROFIT_REVIEW_DENY_NOTE_LABEL");
  });
});

describe("migration 046's amended CHECK and the schema.sql mirror", () => {
  const EXPECTED = "action TEXT NOT NULL CHECK (action IN ('approve', 'deny', 'request_info', 'suspend', 'release', 'transfer'))";
  test("request_info is a valid action, and transfer stays schema-ready, in BOTH files", () => {
    for (const [name, sql] of [
      ["046_nonprofit_reviews.sql", MIGRATION_046],
      ["schema.sql", SCHEMA],
    ] as const) {
      expect(`${name}:${sql.includes(EXPECTED)}`).toBe(`${name}:true`);
      expect(sql).toContain("'transfer'");
      expect(sql).toContain("'request_info'");
    }
  });

  test("046 stays splittable and free of generated-DDL escapes", () => {
    const statements = MIGRATION_046.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements.length).toBeGreaterThanOrEqual(8);
    for (const statement of statements) expect(statement).not.toContain("$$");
    // Still no second migration and no numeric literal that could collide with it.
    expect(MIGRATION_046).toContain("CREATE TABLE IF NOT EXISTS nonprofit_application_reviews");
  });
});
