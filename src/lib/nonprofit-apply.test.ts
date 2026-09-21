/**
 * Nonprofit Free phase 2 (unit A) — deterministic, ZERO network, ZERO database.
 *
 * WHAT THIS PROVES, in the owner's terms:
 *   • a malformed EIN writes NOTHING: no row, no decision, and the verification engine is
 *     never even called (build plan §1 step 3 — "reentry_required is form validation");
 *   • a duplicate EIN is a 409 with the neutral message and NO IRS lookup at all;
 *   • a RELEASED EIN (migration 046) is treated as unclaimed, so a different applicant may
 *     claim it, while the released row itself is never deleted;
 *   • the decision → status + `granted_at` + `reverify_due_at` + audit-column mapping is
 *     complete: every audit column the Phase-1 engine produces is written, and the writer
 *     is a single INSERT … ON CONFLICT (user_id) DO UPDATE (a re-apply updates ONE row);
 *   • the applicant-facing responses never carry the EIN, the holder's user id, the
 *     matched IRS name or a reason class;
 *   • the copy module's strings and the surfaces that render them contain none of the
 *     forbidden phrases (no urgency, no scarcity, no paid-tier nudge, no accusation);
 *   • migration 046 and its src/db/schema.sql mirror agree.
 *
 * The DB half of the phase-2 proof (the partial unique index on a real database) lives in
 * nonprofit-apply.integration.test.ts and is CI-only by opt-in.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  NONPROFIT_EIN_CLAIMED_MESSAGE as CLAIM_MESSAGE,
  NONPROFIT_FREE_PROMISE,
  evaluateNonprofitEinClaim,
} from "~/lib/nonprofit.server";
import {
  decideNonprofitVerification,
  type NonprofitVerificationOutcome,
} from "~/lib/nonprofit-verification.server";
import {
  FORBIDDEN_NONPROFIT_PATTERNS,
  FORBIDDEN_NONPROFIT_PHRASES,
  NONPROFIT_APPLY_INTRO,
  NONPROFIT_APPLY_VALIDATION,
  NONPROFIT_NOT_GRANTED_COPY,
  NONPROFIT_PROMISE,
  NONPROFIT_STATUS_PAGE_LINK_LABEL,
  nonprofitCopyStrings,
  safeNonprofitReturnPath,
  statusCopyFor,
  verificationWording,
} from "~/lib/nonprofit-copy";
import {
  applyForNonprofitFree,
  buildNonprofitApplicationColumns,
  validateNonprofitApplyFields,
  type NonprofitApplyDeps,
  type NonprofitApplicationWriteInput,
} from "~/lib/nonprofit-apply.server";

const FIXED_NOW = new Date("2026-09-21T12:00:00.000Z");

/** Code only — a doc comment may legitimately NAME the thing it forbids. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

// ── The real engine's outcomes, so the mapping is proven against the shipped rule ──
function approvedOutcome(): NonprofitVerificationOutcome {
  return decideNonprofitVerification({
    einFormat: "ok",
    ein: "010488538",
    einFound: true,
    nameTier: "A",
    submittedNameNormalized: "MAINE ASSOCIATION OF NONPROFITS",
    matchedBmfName: "MAINE ASSOCIATION OF NONPROFITS",
    bmfStatus: "01",
    bmfSubsection: "03",
    bmfGroupNo: "0000",
    bmfPostingDate: "2026-09-08",
    onRevocationList: false,
    inPub78: true,
    pub78DeductibilityCode: "PC",
    now: FIXED_NOW,
  });
}
function manualOutcome(): NonprofitVerificationOutcome {
  return decideNonprofitVerification({
    einFormat: "ok",
    ein: "142007220",
    einFound: false,
    submittedNameNormalized: "SOME NEW CHARITY",
    now: FIXED_NOW,
  });
}
function deniedOutcome(): NonprofitVerificationOutcome {
  return decideNonprofitVerification({
    einFormat: "ok",
    ein: "142007220",
    einFound: false,
    submittedNameNormalized: "SOME NEW CHARITY",
    conflicts: ["identity_contradicts_application"],
    now: FIXED_NOW,
  });
}

const VALID_BODY = {
  orgName: "Maine Association of Nonprofits",
  ein: "010488538",
  workEmail: "Director@Example.ORG ",
  website: "example.org",
  state: "me",
  contactName: "Dana Director",
  contactRole: "Executive Director",
  orgUseConfirmed: true,
};

/** The injectable dependencies, with call counters — no database, no network. */
function makeDeps(overrides: Partial<NonprofitApplyDeps> = {}) {
  const calls = { verify: 0, save: 0, findHolder: 0, notify: [] as string[] };
  let saved: { outcome: NonprofitVerificationOutcome; input: NonprofitApplicationWriteInput } | null = null;
  const deps: NonprofitApplyDeps = {
    findEinHolder: async () => {
      calls.findHolder += 1;
      return null;
    },
    verify: async () => {
      calls.verify += 1;
      return manualOutcome();
    },
    save: async (outcome, input) => {
      calls.save += 1;
      saved = { outcome, input };
      return { ok: true, applicationId: 7, status: outcome.status };
    },
    notify: async (notification) => {
      calls.notify.push(notification.kind);
    },
    now: () => FIXED_NOW,
    ...overrides,
  };
  return {
    deps,
    calls,
    saved: () => saved,
  };
}

describe("field validation — form validation, never a decision", () => {
  test("a numeric EIN is refused as text-only (a number has lost its leading zeros)", () => {
    const result = validateNonprofitApplyFields({ ...VALID_BODY, ein: 10488538 });
    expect(result.ok).toBe(false);
    expect(result.value).toBeNull();
    expect(result.errors.ein).toContain("leading zeros");
  });

  test("an EIN of the wrong length and the test-form patterns are refused", () => {
    for (const ein of ["12345678", "1234567890", "111111111", "123456789", ""]) {
      const result = validateNonprofitApplyFields({ ...VALID_BODY, ein });
      expect(result.ok).toBe(false);
      expect(typeof result.errors.ein).toBe("string");
    }
  });

  test("a valid application normalises the EIN and lower-cases the email", () => {
    const result = validateNonprofitApplyFields(VALID_BODY);
    expect(result.ok).toBe(true);
    expect(result.value?.ein).toBe("010488538");
    expect(result.value?.workEmail).toBe("director@example.org");
    expect(result.value?.website).toBe("https://example.org");
    expect(result.value?.state).toBe("ME");
  });

  test("every other field is validated with a per-field message", () => {
    const result = validateNonprofitApplyFields({
      orgName: "x",
      ein: "010488538",
      workEmail: "not-an-email",
      website: "not a website",
      state: "ZZ",
      contactName: "",
      contactRole: "x".repeat(500),
      orgUseConfirmed: false,
    });
    expect(result.ok).toBe(false);
    for (const field of ["orgName", "workEmail", "website", "state", "contactName", "contactRole", "orgUseConfirmed"]) {
      expect(result.errors[field]).toBeTruthy();
    }
  });

  test("the authorization tick is required — an honesty field is never defaulted", () => {
    const result = validateNonprofitApplyFields({ ...VALID_BODY, orgUseConfirmed: undefined });
    expect(result.ok).toBe(false);
    expect(result.errors.orgUseConfirmed).toBe(NONPROFIT_APPLY_VALIDATION.orgUseConfirmed);
  });
});

describe("the apply flow's order of operations", () => {
  test("a malformed EIN returns 400 and writes NOTHING — the engine is never called", async () => {
    const harness = makeDeps();
    const result = await applyForNonprofitFree(
      { userId: 42, body: { ...VALID_BODY, ein: "111111111" } },
      harness.deps,
    );
    expect(result.status).toBe(400);
    expect(harness.calls.verify).toBe(0);
    expect(harness.calls.save).toBe(0);
    expect(harness.saved()).toBeNull();
  });

  test("a duplicate EIN is a 409 with the neutral message and NO IRS lookup", async () => {
    const harness = makeDeps({
      findEinHolder: async () => ({ user_id: 99, status: "approved", org_name: "Another Org", released_at: null }),
    });
    const result = await applyForNonprofitFree({ userId: 42, body: VALID_BODY }, harness.deps);
    expect(result.status).toBe(409);
    expect(result.body.error).toBe(CLAIM_MESSAGE);
    expect(harness.calls.verify).toBe(0);
    expect(harness.calls.save).toBe(0);
  });

  test("a RELEASED EIN is claimable — the released row is never deleted or reused", async () => {
    const harness = makeDeps({
      findEinHolder: async () => ({
        user_id: 99,
        status: "denied",
        org_name: "Previously Denied Org",
        released_at: "2026-09-20T00:00:00.000Z",
      }),
      verify: async () => {
        harness.calls.verify += 1;
        return approvedOutcome();
      },
    });
    const result = await applyForNonprofitFree({ userId: 42, body: VALID_BODY }, harness.deps);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("approved");
    expect(harness.calls.verify).toBe(1);
    expect(harness.calls.save).toBe(1);
    // The new applicant writes THEIR OWN row for THEIR OWN account.
    expect(harness.saved()?.input.userId).toBe(42);
  });

  test("a RELEASED EIN's new applicant is judged on its OWN merits — the released row is never fed to the engine (QA §0)", async () => {
    // The normal case for a released EIN: an administrator released the previous row, and a
    // DIFFERENT organization then legitimately claims the EIN. Its name is therefore
    // materially different from the released holder's — Tier C to the engine.
    const RELEASED_HOLDER = {
      user_id: 99,
      status: "denied",
      org_name: "Previously Denied Org",
      released_at: "2026-09-20T00:00:00.000Z",
    };
    // A live 501(c)(3) whose legal name corresponds to THIS applicant (the auto-approve shape).
    const BMF_MATCH = {
      einFormat: "ok" as const,
      ein: "010488538",
      einFound: true,
      nameTier: "A" as const,
      submittedNameNormalized: "MAINE ASSOCIATION OF NONPROFITS",
      matchedBmfName: "MAINE ASSOCIATION OF NONPROFITS",
      bmfStatus: "01",
      bmfSubsection: "03",
      bmfGroupNo: "0000",
      bmfPostingDate: "2026-09-08",
      onRevocationList: false,
      inPub78: true,
      pub78DeductibilityCode: "PC",
    };
    const harness = makeDeps({
      findEinHolder: async () => RELEASED_HOLDER,
      // The verdict is NOT stubbed: whatever `einClaim` the apply flow produced is handed
      // straight to the REAL engine, so this test fails the moment a released row reaches it
      // as a claim (the pre-fix `einClaim: holder ? {…} : null`).
      verify: async (input) => {
        harness.calls.verify += 1;
        return decideNonprofitVerification({
          ...BMF_MATCH,
          ein: input.ein,
          einClaim: input.einClaim ?? null,
          applicantUserId: input.applicantUserId ?? null,
          now: FIXED_NOW,
        });
      },
    });

    const result = await applyForNonprofitFree({ userId: 42, body: VALID_BODY }, harness.deps);
    expect(result.body.status).toBe("approved");
    expect(harness.saved()?.outcome.decision).toBe("auto_approve");
    expect(harness.saved()?.outcome.reasonClass).toBe("clear-match");
    expect(harness.saved()?.outcome.status).toBe("approved");
    expect(harness.calls.notify).toEqual(["approved"]);
    // ...and the new applicant wrote THEIR OWN row.
    expect(harness.saved()?.input.userId).toBe(42);

    // CONTROL — the regression this fix removes, pinned. Had the released row been passed as
    // a claim (the pre-fix behaviour), the Tier-C name comparison would have routed an
    // innocent applicant into the owner's DENY lane and filed a fraud class against them.
    const poisoned = decideNonprofitVerification({
      ...BMF_MATCH,
      einClaim: {
        userId: RELEASED_HOLDER.user_id,
        orgName: RELEASED_HOLDER.org_name,
        status: RELEASED_HOLDER.status,
      },
      applicantUserId: 42,
      now: FIXED_NOW,
    });
    expect(poisoned.decision).toBe("deny");
    expect(poisoned.status).toBe("denied");
    expect(poisoned.reason).toBe("ein_conflict_different_org");
    expect(poisoned.reasonClass).toBe("fraud-likely");
  });

  test("an approval returns the owner's wording built from the mirror's posting date", async () => {
    const harness = makeDeps({
      verify: async () => {
        harness.calls.verify += 1;
        return approvedOutcome();
      },
    });
    const result = await applyForNonprofitFree({ userId: 42, body: VALID_BODY }, harness.deps);
    expect(result.status).toBe(200);
    expect(result.body.verificationWording).toBe(
      "Verified against IRS tax-exempt records updated September 2026",
    );
    expect(result.body.statusLabel).toBe("Verified");
    expect(harness.calls.notify).toEqual(["approved"]);
  });

  test("no NON-approved outcome ever carries the verification wording (QA §1.32)", async () => {
    // Both verdicts are given a mirror POSTING DATE, so the wording genuinely exists — the
    // only reason it must not appear in the response is the status. Nothing renders it today;
    // gating it on `approved` means no future consumer can show a verification claim to an
    // unverified applicant.
    const manualWithDate = decideNonprofitVerification({
      einFormat: "ok",
      ein: "142007220",
      einFound: false,
      submittedNameNormalized: "SOME NEW CHARITY",
      bmfPostingDate: "2026-09-08",
      now: FIXED_NOW,
    });
    const deniedWithDate = decideNonprofitVerification({
      einFormat: "ok",
      ein: "010488538",
      einFound: true,
      nameTier: "A",
      submittedNameNormalized: "MAINE ASSOCIATION OF NONPROFITS",
      matchedBmfName: "MAINE ASSOCIATION OF NONPROFITS",
      bmfStatus: "01",
      bmfSubsection: "03",
      bmfPostingDate: "2026-09-08",
      conflicts: ["identity_contradicts_application"],
      now: FIXED_NOW,
    });
    expect(manualWithDate.status).toBe("manual_review");
    expect(deniedWithDate.status).toBe("denied");
    for (const outcome of [manualWithDate, deniedWithDate]) {
      expect(outcome.signals.bmfPostingDate).toBe("2026-09-08");
      // The wording the pre-fix code would have returned for this outcome:
      expect(verificationWording(outcome.signals.bmfPostingDate)).not.toBeNull();
      const result = await applyForNonprofitFree(
        { userId: 42, body: VALID_BODY },
        makeDeps({ verify: async () => outcome }).deps,
      );
      expect(result.body.status).not.toBe("approved");
      expect(result.body.verificationWording).toBeNull();
      expect(result.body.statusLabel).not.toBe("Verified");
    }
    // The approved branch is the ONLY one that carries it (the pairing test above).
  });

  test("a denial returns the neutral, appealable copy — never the reason or the class", async () => {
    const harness = makeDeps({
      verify: async () => {
        harness.calls.verify += 1;
        return deniedOutcome();
      },
    });
    const result = await applyForNonprofitFree({ userId: 42, body: VALID_BODY }, harness.deps);
    expect(result.status).toBe(200);
    expect(result.body.message).toBe(NONPROFIT_NOT_GRANTED_COPY);
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("fraud-likely");
    expect(serialized).not.toContain("identity_contradicts_application");
    expect(serialized).not.toMatch(/fraud|suspicious|invalid|rejected/i);
    expect(serialized).toContain("hello@contrax.company");
    expect(harness.calls.notify).toEqual(["denied"]);
  });

  test("a 23505 from the database is reported as the SAME neutral 409", async () => {
    const harness = makeDeps({
      save: async () => ({ ok: false, reason: "ein_claimed", message: CLAIM_MESSAGE }),
    });
    const result = await applyForNonprofitFree({ userId: 42, body: VALID_BODY }, harness.deps);
    expect(result.status).toBe(409);
    expect(result.body.error).toBe(CLAIM_MESSAGE);
  });

  test("a reentry_required verdict can never create a row (belt and braces)", async () => {
    const harness = makeDeps({
      verify: async () => decideNonprofitVerification({ einFormat: "bad", ein: null, now: FIXED_NOW }),
    });
    const result = await applyForNonprofitFree({ userId: 42, body: VALID_BODY }, harness.deps);
    expect(result.status).toBe(400);
    expect(harness.calls.save).toBe(0);
  });

  test("a mail failure never changes the applicant's outcome (fail-open)", async () => {
    const harness = makeDeps({
      verify: async () => {
        harness.calls.verify += 1;
        return approvedOutcome();
      },
      notify: async () => {
        throw new Error("resend down");
      },
    });
    const result = await applyForNonprofitFree({ userId: 42, body: VALID_BODY }, harness.deps);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("approved");
  });

  test("NO response body ever carries the EIN, the holder id or the reason class", async () => {
    const harness = makeDeps({
      findEinHolder: async () => ({ user_id: 99, status: "approved", org_name: "X", released_at: null }),
    });
    const claimed = await applyForNonprofitFree({ userId: 42, body: VALID_BODY }, harness.deps);
    const ok = await applyForNonprofitFree(
      { userId: 42, body: VALID_BODY },
      makeDeps({ verify: async () => approvedOutcome() }).deps,
    );
    for (const response of [claimed, ok]) {
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain("010488538");
      expect(serialized).not.toContain("heldByUserId");
      expect(serialized).not.toContain('"ein"');
      expect(Object.keys(response.body)).not.toContain("ein");
      expect(Object.keys(response.body)).not.toContain("decision");
      expect(Object.keys(response.body)).not.toContain("reasonClass");
    }
  });
});

describe("the released-EIN claim semantics", () => {
  test("a released row counts as UNCLAIMED and exposes no holder", () => {
    const decision = evaluateNonprofitEinClaim({
      userId: 43,
      existing: { user_id: 99, status: "revoked", released_at: "2026-09-20T00:00:00.000Z" },
    });
    expect(decision.allowed).toBe(true);
    expect(decision.outcome).toBe("released_claimable");
    expect(decision.heldByUserId).toBeNull();
  });

  test("an attached row still reports the holder (reviewer-only) and blocks the claim", () => {
    const decision = evaluateNonprofitEinClaim({
      userId: 43,
      existing: { user_id: 99, status: "denied", released_at: null },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.outcome).toBe("ein_already_claimed");
    expect(decision.heldByUserId).toBe(99);
  });

  test("the holder id is never in an apply response, only in the decision object", async () => {
    const harness = makeDeps({
      findEinHolder: async () => ({ user_id: 777, status: "approved", org_name: "X", released_at: null }),
    });
    const result = await applyForNonprofitFree({ userId: 42, body: VALID_BODY }, harness.deps);
    expect(JSON.stringify(result.body)).not.toContain("777");
  });
});

describe("the apply page's ?next= return path and its link copy (QA §1.30 / §1.31 / §1.41)", () => {
  const APPLY_PAGE = readFileSync(new URL("../routes/nonprofit/apply.tsx", import.meta.url), "utf8");

  test("a same-site path is honoured, and an off-site one can never be reached", () => {
    expect(safeNonprofitReturnPath("/nonprofit/status")).toBe("/nonprofit/status");
    expect(safeNonprofitReturnPath("/grants")).toBe("/grants");
    // THE OPEN REDIRECT (the finding): `//evil.com` is PROTOCOL-RELATIVE, so
    // window.location.assign() would have sent a successful applicant to an external host.
    expect(safeNonprofitReturnPath("//evil.com")).toBeNull();
    expect(safeNonprofitReturnPath("///evil.com")).toBeNull();
    expect(safeNonprofitReturnPath("/\\evil.com")).toBeNull();
    expect(safeNonprofitReturnPath("\\evil.com")).toBeNull();
    expect(safeNonprofitReturnPath("//evil.com/nonprofit/status")).toBeNull();
    expect(safeNonprofitReturnPath("https://evil.com")).toBeNull();
    expect(safeNonprofitReturnPath("http://evil.com")).toBeNull();
    expect(safeNonprofitReturnPath("javascript:alert(1)")).toBeNull();
    expect(safeNonprofitReturnPath("nonprofit/status")).toBeNull();
    expect(safeNonprofitReturnPath("")).toBeNull();
    expect(safeNonprofitReturnPath(null)).toBeNull();
    expect(safeNonprofitReturnPath(undefined)).toBeNull();
  });

  test("the page routes ?next= through the guard, and the guard rejects the payload", () => {
    // The page must not carry its own regex any more: the rule lives in one tested place.
    expect(APPLY_PAGE).toContain("safeNonprofitReturnPath(params.get(\"next\"))");
    expect(APPLY_PAGE).not.toContain("/^\\/[A-Za-z0-9");
    expect(APPLY_PAGE).toContain("window.location.assign(returnPath)");
  });

  test("the already-applied panel links to the status page with the STATUS label", () => {
    expect(NONPROFIT_STATUS_PAGE_LINK_LABEL).toBe("View your application status");
    expect(APPLY_PAGE).toContain('href="/nonprofit/status"');
    expect(APPLY_PAGE).toContain("{NONPROFIT_STATUS_PAGE_LINK_LABEL}");
    // The finding: the panel asked an applicant to "Apply for Nonprofit Free →" while
    // pointing at /nonprofit/status.
    expect(APPLY_PAGE).not.toContain("NONPROFIT_STATUS_APPLY_LINK_LABEL");
  });

  test("no real EIN example is exposed on the public apply page (QA §1.41)", () => {
    // 010488538 is the Maine Association of Nonprofits' real EIN (used in fixtures and in the
    // DB suite as a documented real record). A public form must not print it.
    expect(APPLY_PAGE).not.toContain("010488538");
    expect(APPLY_PAGE).toContain("for example 01-2345678");
    // ...and the synthetic example is one the form itself accepts (not a bogus pattern).
    expect(validateNonprofitApplyFields({ ...VALID_BODY, ein: "01-2345678" }).ok).toBe(true);
  });
});

describe("the single audited writer's column mapping", () => {
  const AUDIT_COLUMNS = [
    "submitted_name_normalized",
    "matched_bmf_name",
    "bmf_name_tier",
    "bmf_status",
    "bmf_subsection",
    "bmf_group_no",
    "bmf_posting_date",
    "bmf_source_ref",
    "pub78",
    "pub78_deductibility_code",
    "on_revocation_list",
    "revocation_date",
    "revocation_posting_date",
    "reinstatement_date",
    "decision",
    "decision_reason",
    "reason_class",
    "supporting_docs_requested",
    "decision_flags",
    "evidence",
  ] as const;

  test("every audit column is written on an approval, with the grant clock", () => {
    const columns = buildNonprofitApplicationColumns(approvedOutcome(), { now: FIXED_NOW });
    for (const column of AUDIT_COLUMNS) expect(column in columns).toBe(true);
    expect(columns.status).toBe("approved");
    expect(columns.verification_method).toBe("irs_eo_bmf");
    expect(columns.decision).toBe("auto_approve");
    expect(columns.decision_reason).toBe("auto_approved");
    expect(columns.reason_class).toBe("clear-match");
    expect(columns.supporting_docs_requested).toBe(false);
    expect(columns.bmf_source_ref).toBe("irs_eo_bmf@2026-09-08");
    expect(columns.matched_bmf_name).toBe("MAINE ASSOCIATION OF NONPROFITS");
    expect(columns.evidence).toContain("irs_eo_bmf_v1");
    expect(columns.granted_at).toBe(FIXED_NOW.toISOString());
    expect(columns.reverify_due_at).toBe(
      new Date(FIXED_NOW.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  test("a manual review writes no method, no grant date and no reverify clock", () => {
    const columns = buildNonprofitApplicationColumns(manualOutcome(), { now: FIXED_NOW });
    expect(columns.status).toBe("manual_review");
    expect(columns.decision).toBe("manual_review");
    expect(columns.reason_class).toBe("no-match-request-docs");
    expect(columns.supporting_docs_requested).toBe(true);
    expect(columns.verification_method).toBeNull();
    expect(columns.granted_at).toBeNull();
    expect(columns.reverify_due_at).toBeNull();
  });

  test("a denial is the fraud lane's 'denied' status, and still audited", () => {
    const columns = buildNonprofitApplicationColumns(deniedOutcome(), { now: FIXED_NOW });
    expect(columns.status).toBe("denied");
    expect(columns.decision).toBe("deny");
    expect(columns.reason_class).toBe("fraud-likely");
    expect(columns.granted_at).toBeNull();
    expect(columns.decision_flags).toContain("identity_contradicts_application");
  });

  test("the writer's SQL names every audit column and updates ONE row per user", () => {
    const source = readFileSync(new URL("./nonprofit-apply.server.ts", import.meta.url), "utf8");
    for (const column of AUDIT_COLUMNS) expect(source).toContain(column);
    // Re-apply updates the SAME row: the conflict target is the user, never the EIN.
    expect(source).toContain("ON CONFLICT (user_id) DO UPDATE");
    expect(source).not.toContain("ON CONFLICT (ein)");
    // The historical first-grant date survives a later verdict...
    expect(source).toContain("granted_at = COALESCE(EXCLUDED.granted_at, nonprofit_applications.granted_at)");
    // ...and a re-apply re-attaches the applicant's own EIN (release is an admin act).
    expect(source).toContain("released_at = NULL");
  });
});

describe("no billing surface anywhere in the apply flow", () => {
  const FILES = [
    "./nonprofit-apply.server.ts",
    "../routes/api/nonprofit/apply.ts",
    "../routes/api/nonprofit/status.ts",
  ];
  test("the flow's CODE never mentions Stripe, billing, a price, a plan tier, a card field or checkout", () => {
    for (const path of FILES) {
      // Comments are stripped: a doc comment explaining "no Stripe here" is not a billing
      // surface. What is scanned is the code that would actually run.
      const source = stripComments(readFileSync(new URL(path, import.meta.url), "utf8"));
      expect(`${path}:${/\bstripe\b/i.test(source)}`).toBe(`${path}:false`);
      expect(`${path}:${/\bbilling\b/i.test(source)}`).toBe(`${path}:false`);
      expect(`${path}:${/\bprice\b|\bpricing\b/i.test(source)}`).toBe(`${path}:false`);
      expect(`${path}:${/\bplan_tier\b|\bplanTier\b/i.test(source)}`).toBe(`${path}:false`);
      expect(`${path}:${/\bsubscription\b/i.test(source)}`).toBe(`${path}:false`);
      expect(`${path}:${/\bcard\b/i.test(source)}`).toBe(`${path}:false`);
      expect(`${path}:${/\bcheckout\b/i.test(source)}`).toBe(`${path}:false`);
    }
  });
});

describe("copy module rules (build plan §6)", () => {
  test("verificationWording(null) === null — no date, no claim", () => {
    expect(verificationWording(null)).toBeNull();
    expect(verificationWording(undefined)).toBeNull();
    expect(verificationWording("not a date")).toBeNull();
    expect(verificationWording("2026-09-08")).toBe(
      "Verified against IRS tax-exempt records updated September 2026",
    );
  });

  test("the promise is a single constant, re-exported — no surface re-types it", () => {
    expect(NONPROFIT_PROMISE).toBe(NONPROFIT_FREE_PROMISE);
    expect(NONPROFIT_APPLY_INTRO).toBe(NONPROFIT_FREE_PROMISE);
    const files = [
      "./nonprofit.server.ts",
      "./nonprofit-copy.ts",
      "../routes/nonprofit/apply.tsx",
      "../routes/nonprofit/status.tsx",
      "../routes/grants.tsx",
    ];
    const hits = files.filter((path) =>
      readFileSync(new URL(path, import.meta.url), "utf8").includes(
        "Government grant search—free for verified nonprofit organizations",
      ),
    );
    // Exactly one file holds the literal, and it is the serving surface (the landing
    // banner strings live in the copy module as constants built from it, not re-typed).
    // The literal is defined in the copy module (client-safe) and in nonprofit.server.ts,
    // and the two are asserted byte-identical: the extraction is programmatic, so a page
    // can never state a promise the server does not hold.
    expect([...hits].sort()).toEqual(["./nonprofit-copy.ts", "./nonprofit.server.ts"]);
  });

  test("no surface contains a forbidden phrase or pattern", () => {
    const copySurfaces = [
      "./nonprofit-copy.ts",
      "../routes/nonprofit/apply.tsx",
      "../routes/nonprofit/status.tsx",
    ];
    // QA §1.39: the wall also covers the SERVER half of the flow, the /grants nonprofit
    // banner and both applicant emails — previously only the copy module and the two pages
    // were scanned, so the strings the API and the mailer actually send were unchecked.
    // Doc comments are stripped for the code files (a comment may legitimately NAME the
    // thing it forbids); applicant-facing text is scanned verdict-verbatim.
    const codeSurfaces = [
      "./nonprofit-apply.server.ts",
      "../routes/api/nonprofit/apply.ts",
      "../routes/api/nonprofit/status.ts",
    ];
    const grantsPage = readFileSync(new URL("../routes/grants.tsx", import.meta.url), "utf8");
    const grantsBanner = grantsPage.slice(
      grantsPage.indexOf("Nonprofit Free door"),
      grantsPage.indexOf("checkoutDone &&"),
    );
    const emailSource = readFileSync(new URL("./email.ts", import.meta.url), "utf8");
    const emailHelpers = emailSource.indexOf("// ── Helpers");
    expect(emailHelpers).toBeGreaterThan(0);
    const applicantEmails = emailSource.slice(
      emailSource.indexOf("sendNonprofitApprovedEmail"),
      emailHelpers,
    );
    // A renamed marker would silently widen or empty a slice, disabling the check.
    expect(grantsBanner.length).toBeGreaterThan(200);
    expect(applicantEmails.length).toBeGreaterThan(200);

    const strings = [
      ...nonprofitCopyStrings(),
      ...copySurfaces.map((path) => readFileSync(new URL(path, import.meta.url), "utf8")),
      ...codeSurfaces.map((path) =>
        stripComments(readFileSync(new URL(path, import.meta.url), "utf8")),
      ),
      grantsBanner,
      applicantEmails,
    ];
    for (const text of strings) {
      for (const phrase of FORBIDDEN_NONPROFIT_PHRASES) {
        // The copy module has to NAME the forbidden words to forbid them — its constant
        // list is the only exemption, and it is not part of `nonprofitCopyStrings()`.
        if (text.includes("FORBIDDEN_NONPROFIT_PHRASES")) continue;
        expect(text.toLowerCase()).not.toContain(phrase);
      }
      for (const pattern of FORBIDDEN_NONPROFIT_PATTERNS) {
        expect(text).not.toMatch(pattern);
      }
    }
  });

  test("every application status has applicant-facing copy", () => {
    for (const status of ["pending", "approved", "manual_review", "denied", "revoked"]) {
      expect(statusCopyFor(status)?.label).toBeTruthy();
      expect(statusCopyFor(status)?.detail).toBeTruthy();
    }
    expect(statusCopyFor("not_a_status")).toBeNull();
    expect(statusCopyFor(null)).toBeNull();
  });

  test("the not-granted copy is neutral and carries the appeal path", () => {
    expect(NONPROFIT_NOT_GRANTED_COPY).toContain("hello@contrax.company");
    expect(NONPROFIT_NOT_GRANTED_COPY).not.toMatch(/fraud|suspicious|invalid|rejected/i);
  });

  test("the applicant emails carry no urgency and the right appeal path", () => {
    const source = readFileSync(new URL("./email.ts", import.meta.url), "utf8");
    const start = source.indexOf("sendNonprofitApprovedEmail");
    const end = source.indexOf("// ── Helpers");
    expect(start).toBeGreaterThan(0);
    const senders = source.slice(start, end);
    for (const phrase of ["limited time", "ends soon", "urgent", "act now", "final notice"]) {
      expect(senders.toLowerCase()).not.toContain(phrase);
    }
    expect(senders).toContain("hello@contrax.company");
    expect(senders).not.toMatch(/\$\s?\d/);
  });
});

describe("migration 046 and the src/db/schema.sql mirror", () => {
  const MIGRATION_046 = readFileSync(
    new URL("../../db/migrations/046_nonprofit_reviews.sql", import.meta.url),
    "utf8",
  );
  const SCHEMA = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  const FILES: [string, string][] = [
    ["046_nonprofit_reviews.sql", MIGRATION_046],
    ["schema.sql", SCHEMA],
  ];

  test("the EIN unique index is PARTIAL in both files (released EINs are claimable)", () => {
    for (const [name, sql] of FILES) {
      expect(`${name}:${sql.includes("ON nonprofit_applications (ein) WHERE released_at IS NULL")}`).toBe(
        `${name}:true`,
      );
      expect(sql).toContain("WHERE released_at IS NULL");
    }
  });

  test("the release and digest columns exist in both files", () => {
    for (const [name, sql] of FILES) {
      for (const column of [
        "released_at TIMESTAMPTZ",
        "digest_opt_out_at TIMESTAMPTZ",
        "digest_unsubscribe_token_hash TEXT",
        "digest_last_sent_at TIMESTAMPTZ",
      ]) {
        expect(`${name}:${sql.includes(column)}`).toBe(`${name}:true`);
      }
    }
  });

  test("the review table is append-only, with the owner's five actions and both statuses", () => {
    for (const [name, sql] of FILES) {
      expect(`${name}:${sql.includes("nonprofit_application_reviews")}`).toBe(`${name}:true`);
      expect(sql).toContain(
        "action TEXT NOT NULL CHECK (action IN ('approve', 'deny', 'suspend', 'release', 'transfer'))",
      );
      expect(sql).toContain("actor_user_id INTEGER NOT NULL REFERENCES users (id)");
      expect(sql).toContain("actor_email TEXT NOT NULL");
      expect(sql).toContain("prior_status TEXT NOT NULL");
      expect(sql).toContain("new_status TEXT NOT NULL");
      expect(sql).toContain(
        "ON nonprofit_application_reviews (application_id, created_at)",
      );
    }
  });

  test("046 is splittable by the shared runner (no semicolon inside a statement)", () => {
    // The runner splits on `;` and drops whole-line comments; a statement must therefore
    // never contain one. A DO $$ block or a `;`-bearing literal would break the runner.
    const statements = MIGRATION_046.split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements.length).toBeGreaterThanOrEqual(8);
    for (const statement of statements) {
      expect(statement).not.toContain("$$");
    }
    // The runner is hand-run only: no test, workflow or schedule may reference it.
    const buildCheck = readFileSync(
      new URL("../../.github/workflows/build-check.yml", import.meta.url),
      "utf8",
    );
    expect(buildCheck).not.toContain("run-046");
  });
});
