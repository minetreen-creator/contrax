/**
 * Nonprofit Free — phase 1 unit tests (deterministic, ZERO network).
 *
 * Every IRS byte used below is a VERBATIM extract of the real payloads downloaded on
 * 2026-09-21 (`src/lib/fixtures/irs/`, provenance in the header of this file's sibling
 * fixtures): the 2026-09-07 EO BMF region-1 CSV (8 rows, CRLF), Pub 78 (4 rows, blank
 * leading lines, a comma inside a deductibility code), the automatic revocation list
 * (7 rows, DD-MON-YYYY dates, with and without the 12th column) and a real window of
 * the EO BMF landing page's HTML (posting date + record count).
 *
 * WHAT IS PROVEN HERE
 *   • research §2.1/§2.2 normalisation — including the §2.5b worked example table.
 *   • research §2.3 tiers A/B/C, and that a domain correspondence can only move a
 *     RECOMMENDATION, never the decision.
 *   • research §2.5 every branch of the decision table (1-7), and that NO branch is an
 *     auto-reject except a malformed EIN (which is form validation).
 *   • the entitlement + per-tier search policy, and that an overdue annual reverify
 *     never removes a verified nonprofit's access.
 *   • the mirror job: real-format parsing, the completeness proof (row count vs the
 *     IRS's published record count + field-count integrity), the diff that `--verify`
 *     reports, and the staged-table swap that an import performs — with a fake store
 *     and a fake fetch, so nothing here touches the network or a database.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import {
  BMF_STATUS_AUTO_APPROVE,
  IRS_SOURCE_LABEL,
  NONPROFIT_CONFLICT_FLAGS,
  NONPROFIT_VERIFICATION_ENGINE,
  TIER_B_JACCARD_MIN,
  compareLegalNames,
  decideNonprofitVerification,
  domainCorrespondsToName,
  normalizeEin,
  normalizeOrgName,
  reasonClassFor,
  verifyNonprofitApplication,
  type IrsMirrorStore as VerificationStore,
} from "~/lib/nonprofit-verification.server";
import {
  NONPROFIT_ANONYMOUS_SEARCH_POLICY,
  NONPROFIT_APPLICATION_STATUSES,
  NONPROFIT_EIN_CLAIMED_MESSAGE,
  NONPROFIT_FREE_PROMISE,
  NONPROFIT_FREE_SEARCH_POLICY,
  NONPROFIT_PENDING_SEARCH_POLICY,
  NONPROFIT_REASON_CLASSES,
  NONPROFIT_SAVE_LIMIT,
  NONPROFIT_SUBSECTION_POLICY,
  NONPROFIT_VERIFICATION_WORDING_TEMPLATE,
  computeReverifyDueAt,
  evaluateNonprofitEinClaim,
  evaluateNonprofitEntitlement,
  isEligibleSubsection,
  isNonprofitReasonClass,
  monthNameOf,
  nonprofitFullDetailAllowance,
  nonprofitSearchAllowance,
  nonprofitSearchPolicy,
  subsectionLabel,
  verificationWording,
  verificationWordingForIrsRecordsAsOf,
  type NonprofitApplicationRow,
  type NonprofitEntitlement,
  type NonprofitSearchPolicy,
} from "~/lib/nonprofit.server";
import {
  NONPROFIT_REVERIFY_FLAG,
  NONPROFIT_REVERIFY_REASONS,
  NONPROFIT_REVERIFY_REASON_CLASS,
  decideApprovedOrgRereverification,
  emptyReverifySummary,
  runNonprofitPostRefreshReverify,
  type ApprovedNonprofitApplication,
  type NonprofitReverifyStore,
  type ReverifyMirrorRecord,
  type ReverifyRouteInput,
} from "~/lib/nonprofit-reverify.server";
import {
  IRS_BMF_LANDING_URL,
  IRS_PUB78_ZIP_MEMBER,
  iterateLines,
  iterateLinesOfText,
  openPayloadStream,
  parseBmfCsvText,
  parseBmfHeader,
  parseBmfPublication,
  parseIrsDate,
  parsePub78Text,
  parseRevocationText,
  payloadsForSource,
  readResponseBytes,
  readZipCentralDirectory,
  readZipLocalHeader,
  readZipMember,
  refreshIrsSource,
  runIrsMirrorRefresh,
  verifyBmfCompleteness,
  mirrorHashOf,
  mirrorKeyOf,
  type IrsMirrorRow,
  type IrsMirrorRunEntry,
  type IrsMirrorSource,
  type IrsMirrorStore,
} from "~/lib/irs-mirror.server";

const DIR = new URL("./fixtures/irs/", import.meta.url);
function fixture(name: string): string {
  return readFileSync(new URL(name, DIR), "utf8");
}
function fixtureBytes(name: string): Buffer {
  return readFileSync(new URL(name, DIR));
}

// ── §2.1 EIN normalisation ───────────────────────────────────────────────────
describe("EIN normalisation (research 2.1)", () => {
  test("strips separators and keeps the value a 9-char string", () => {
    expect(normalizeEin("14-2007220")).toEqual({ ok: true, ein: "142007220" });
    expect(normalizeEin("14 2007220")).toEqual({ ok: true, ein: "142007220" });
  });
  test("preserves a leading zero — the case a numeric EIN would corrupt", () => {
    const result = normalizeEin("010488538");
    expect(result).toEqual({ ok: true, ein: "010488538" });
    expect(result.ok && result.ein.length).toBe(9);
    // …and a leading-zero EIN is a REAL EIN (this exact value is the plan's own org).
    expect(normalizeEin("000003154").ok).toBe(true);
  });
  test("refuses a value that has already lost its leading zero", () => {
    expect(normalizeEin("10488538")).toMatchObject({ ok: false, reason: "format" });
    expect(normalizeEin(10488538)).toMatchObject({ ok: false, reason: "format" });
    expect(normalizeEin("1420-0722")).toMatchObject({ ok: false, reason: "format" });
  });
  test("refuses the known-bogus patterns as FORM errors", () => {
    expect(normalizeEin(null)).toMatchObject({ ok: false, reason: "missing" });
    expect(normalizeEin("000000000")).toMatchObject({ ok: false, reason: "bogus_pattern" });
    expect(normalizeEin("111111111")).toMatchObject({ ok: false, reason: "bogus_pattern" });
    expect(normalizeEin("123456789")).toMatchObject({ ok: false, reason: "bogus_pattern" });
  });
});

// ── §2.2 legal-name normalisation + §2.5b worked example ─────────────────────
describe("legal-name normalisation (research 2.2, 2.5b)", () => {
  const BMF = "MAINE ASSOCIATION OF NONPROFITS";
  test("the documented variants all normalise to the BMF NAME (Tier A)", () => {
    for (const variant of [
      "MAINE ASSOCIATION OF NONPROFITS",
      "Maine Association Of Nonprofits",
      "MAINE ASSOCIATION OF NONPROFITS Inc",
      "The MAINE ASSOCIATION OF NONPROFITS",
    ]) {
      expect(normalizeOrgName(variant).normalized).toBe(BMF);
      expect(compareLegalNames(variant, [BMF]).tier).toBe("A");
    }
  });
  test("the hyphen variant lands on Tier C — manual review, never a rejection", () => {
    const comparison = compareLegalNames("MAINE ASSOCIATION OF Non-ProfitS", [BMF]);
    expect(comparison.submittedNormalized).toBe("MAINE ASSOCIATION OF NON PROFITS");
    expect(comparison.tier).toBe("C");
  });
  test("abbreviations, accents, &, punctuation and THE are handled", () => {
    // An apostrophe is punctuation, so it becomes a space: "MARY'S" → "MARY S"
    // (conservative on purpose — it can only make a match harder, never easier).
    expect(normalizeOrgName("St. Mary's Assn. for the Arts & Sciences, Inc.").normalized).toBe(
      "ST MARY S ASSOCIATION FOR THE ARTS AND SCIENCES",
    );
    expect(normalizeOrgName("Fundación Árbol").normalized).toBe("FUNDACION ARBOL");
    expect(normalizeOrgName("Maine Assn of Nonprofits").normalized).toBe("MAINE ASSOCIATION OF NONPROFITS");
    expect(normalizeOrgName("Acme Fdn").normalized).toBe("ACME FOUNDATION");
    // VFW / PTA are deliberately left as-is.
    expect(normalizeOrgName("VFW Post 88").normalized).toBe("VFW POST 88");
  });
  test("the multiset is kept alongside the normalised string", () => {
    const normalized = normalizeOrgName("Arts Arts Council");
    expect(normalized.normalized).toBe("ARTS ARTS COUNCIL");
    expect(normalized.multiset).toEqual({ ARTS: 2, COUNCIL: 1 });
  });
});

// ── §2.3 tiers ───────────────────────────────────────────────────────────────
describe("name match tiers (research 2.3)", () => {
  test("Tier B on token-multiset equality (word order, not wording)", () => {
    const comparison = compareLegalNames("OF MAINE ASSOCIATION NONPROFITS", [
      "MAINE ASSOCIATION OF NONPROFITS",
    ]);
    expect(comparison.tier).toBe("B");
    expect(comparison.reason).toBe("token_multiset");
  });
  test("the contains + Jaccard gate: 10 of 11 tokens corresponds, 8 of 9 does not", () => {
    expect(TIER_B_JACCARD_MIN).toBe(0.9);
    expect(
      compareLegalNames("UNITED WAY OF GREATER PORTLAND AND CUMBERLAND COUNTY MAINE", [
        "UNITED WAY OF GREATER PORTLAND AND CUMBERLAND COUNTY MAINE FOUNDATION",
      ]).tier,
    ).toBe("B");
    // 8/9 = 0.889 is BELOW the gate: the longer name keeps its own tier (manual review).
    expect(
      compareLegalNames("GREATER PORTLAND COALITION OF COMMUNITY NONPROFITS AND CHARITIES", [
        "GREATER PORTLAND COALITION OF COMMUNITY NONPROFITS AND CHARITIES FOUNDATION",
      ]).tier,
    ).toBe("C");
  });
  test("a genuinely different org stays Tier C (no fuzzy matching)", () => {
    const comparison = compareLegalNames("SOCIETY OF ST VINCENT DE PAUL", ["ST VINCENTS"]);
    expect(comparison.tier).toBe("C");
    expect(comparison.reason).toBe("no_correspondence");
  });
  test("an empty submitted name is Tier C, not a crash", () => {
    expect(compareLegalNames("", ["ACME"])).toMatchObject({ tier: "C", reason: "empty_name" });
  });
  test("the SORT_NAME secondary line is usable as a second name", () => {
    expect(compareLegalNames("MAINE STATE SOCIETY", [null, "MAINE STATE SOCIETY"]).tier).toBe("A");
  });
  test("a domain correspondence is corroboration only", () => {
    expect(domainCorrespondsToName("https://www.maineassociationofnonprofits.org/donate", "MAINE ASSOCIATION OF NONPROFITS")).toBe(true);
    expect(domainCorrespondsToName("info@maineassociationofnonprofits.org", "MAINE ASSOCIATION OF NONPROFITS")).toBe(true);
    expect(domainCorrespondsToName("gmail.com", "MAINE ASSOCIATION OF NONPROFITS")).toBe(false);
    expect(domainCorrespondsToName(null, "MAINE ASSOCIATION OF NONPROFITS")).toBe(false);
  });
});

// ── §2.5 the decision table, branch by branch (pure) ─────────────────────────
describe("decision table (research 2.5)", () => {
  const autoSignals = {
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
    now: new Date("2026-09-21T15:00:00Z"),
  };
  test("1 — EIN found + name corresponds + not revoked + STATUS 01/02 → AUTO-APPROVE", () => {
    const outcome = decideNonprofitVerification(autoSignals);
    expect(outcome.decision).toBe("auto_approve");
    expect(outcome.status).toBe("approved");
    expect(outcome.method).toBe("irs_eo_bmf");
    expect(outcome.reason).toBe("auto_approved");
    expect(outcome.flags).toEqual([]);
    expect(outcome.reasonClass).toBe("clear-match");
    expect(outcome.supportingDocsRequested).toBe(false);
    expect(outcome.evidence).toMatchObject({
      source: IRS_SOURCE_LABEL,
      bmf_posting_date: "2026-09-08",
      bmf_status: "01",
      bmf_status_meaning: "Unconditional Exemption",
      pub78: true,
      decided_by: `system:${NONPROFIT_VERIFICATION_ENGINE}`,
      decided_at: "2026-09-21T15:00:00.000Z",
    });
  });
  test("1 — STATUS 02 (conditional) also auto-approves; a Tier B name does too", () => {
    expect(BMF_STATUS_AUTO_APPROVE).toEqual(["01", "02"]);
    expect(decideNonprofitVerification({ ...autoSignals, bmfStatus: "02" }).decision).toBe("auto_approve");
    expect(decideNonprofitVerification({ ...autoSignals, nameTier: "B" }).decision).toBe("auto_approve");
  });
  test("1 — absence from Pub 78 is a flag, never a gate", () => {
    const outcome = decideNonprofitVerification({ ...autoSignals, inPub78: false });
    expect(outcome.decision).toBe("auto_approve");
    expect(outcome.flags).toContain("not_in_pub78");
  });
  test("1 — a group-exemption subordinate auto-approves but is TAGGED", () => {
    const outcome = decideNonprofitVerification({ ...autoSignals, bmfGroupNo: "2347" });
    expect(outcome.decision).toBe("auto_approve");
    expect(outcome.flags).toContain("group_exemption_subordinate");
  });
  test("1 — a non-501(c)(3) subsection goes to a HUMAN under the shipped 501(c)(3)-only policy", () => {
    // Owner decision (a), RESOLVED 2026-09-21: auto-approve requires SUBSECTION='03'. The
    // 501(c)(6) business league, the 501(c)(4), the 501(c)(19) veterans' organization etc.
    // are exempt but are NOT the "charitable nonprofit" this free tier is for — reviewed by
    // a human, never auto-approved and never auto-rejected.
    expect(NONPROFIT_SUBSECTION_POLICY).toBe("501c3_only");
    const outcome = decideNonprofitVerification({ ...autoSignals, bmfSubsection: "06" });
    expect(outcome.decision).toBe("manual_review");
    expect(outcome.status).toBe("manual_review");
    expect(outcome.reason).toBe("subsection_not_501c3");
    expect(outcome.reasonClass).toBe("possible-match");
    expect(outcome.flags).toContain("subsection_not_501c3");
    expect(outcome.status).not.toBe("denied");
  });
  test("2 — revoked AND in Pub 78 → MANUAL with the reinstatement hypothesis", () => {
    const outcome = decideNonprofitVerification({
      ...autoSignals,
      onRevocationList: true,
      inPub78: true,
      revocationDate: "2012-05-15",
      revocationPostingDate: "2013-02-11",
      reinstatementDate: "2012-05-15",
    });
    expect(outcome.decision).toBe("manual_review");
    expect(outcome.status).toBe("manual_review");
    expect(outcome.reason).toBe("revoked_reinstated_looking");
    expect(outcome.recommendation).toBe("approve");
    expect(outcome.flags).toContain("revocation_reinstatement_hypothesis");
    expect(outcome.evidence).toMatchObject({
      on_revocation_list: true,
      revocation_posting_date: "2013-02-11",
      reinstatement_date: "2012-05-15",
    });
  });
  test("3 — revoked and NOT in Pub 78 → MANUAL, recommend decline, never auto-reject", () => {
    const outcome = decideNonprofitVerification({ ...autoSignals, onRevocationList: true, inPub78: false });
    expect(outcome.decision).toBe("manual_review");
    expect(outcome.recommendation).toBe("decline");
    expect(outcome.flags).toContain("revoked_and_absent_from_pub78");
    // The owner's `denied` status is the FRAUD lane only: a revoked org is reviewed.
    expect(outcome.status).toBe("manual_review");
    expect(outcome.status).not.toBe("denied");
  });
  test("4 — STATUS 12 / 25 / missing → MANUAL (a trust or a terminated org is not a charity)", () => {
    for (const status of ["12", "25", null, "09"]) {
      const outcome = decideNonprofitVerification({ ...autoSignals, bmfStatus: status });
      expect(outcome.decision).toBe("manual_review");
      expect(outcome.reason).toBe("status_not_active");
    }
    expect(decideNonprofitVerification({ ...autoSignals, bmfStatus: "12" }).evidence).toMatchObject({
      bmf_status_meaning: "Trust described in section 4947(a)(2) of the Internal Revenue Code",
    });
  });
  test("5 — name Tier C → MANUAL, and the domain only moves the recommendation", () => {
    const plain = decideNonprofitVerification({ ...autoSignals, nameTier: "C" });
    expect(plain.decision).toBe("manual_review");
    expect(plain.reason).toBe("name_mismatch");
    expect(plain.recommendation).toBeNull();
    expect(plain.flags).toContain("dba_names_absent_from_irs_file_by_design");
    const corroborated = decideNonprofitVerification({
      ...autoSignals,
      nameTier: "C",
      websiteOrEmail: "director@maineassociationofnonprofits.org",
    });
    expect(corroborated.decision).toBe("manual_review");
    expect(corroborated.recommendation).toBe("approve");
    expect(corroborated.flags).toContain("domain_corresponds");
  });
  test("6 — EIN not found → MANUAL + request supporting documentation, never a rejection", () => {
    const outcome = decideNonprofitVerification({ ...autoSignals, einFound: false, nameTier: null });
    expect(outcome.decision).toBe("manual_review");
    expect(outcome.reason).toBe("ein_not_found");
    expect(outcome.flags).toContain("ein_not_found_exception_class");
    // Owner spec item 3, verbatim: "no match → request supporting documentation".
    expect(outcome.supportingDocsRequested).toBe(true);
    expect(outcome.flags).toContain("request_supporting_documentation");
    expect(outcome.reasonClass).toBe("no-match-request-docs");
    expect(outcome.evidence).toMatchObject({ supporting_docs_requested: true });
    expect(outcome.status).toBe("manual_review");
  });
  test("7 — a malformed EIN is a re-entry, not a review and not a rejection", () => {
    const outcome = decideNonprofitVerification({ ...autoSignals, einFormat: "bad", ein: null });
    expect(outcome.decision).toBe("reentry_required");
    expect(outcome.status).toBe("pending");
    expect(outcome.reason).toBe("ein_format");
    // Form validation is NOT a verification verdict, so it files no reason class — and it
    // never asks for documents (the form just has to be corrected).
    expect(outcome.reasonClass).toBeNull();
    expect(outcome.supportingDocsRequested).toBe(false);
  });
  test("owner decision (a): flipping the subsection policy routes non-501(c)(3) to review", () => {
    expect(isEligibleSubsection("03", "501c3_only")).toBe(true);
    expect(isEligibleSubsection("06", "501c3_only")).toBe(false);
    expect(isEligibleSubsection("06", "any_bmf_record")).toBe(true);
    const narrowed = decideNonprofitVerification({
      ...autoSignals,
      bmfSubsection: "06",
      subsectionPolicy: "501c3_only",
    });
    expect(narrowed.decision).toBe("manual_review");
    expect(narrowed.reason).toBe("subsection_not_501c3");
  });
});

// ── The owner's reason taxonomy + the deny lane (spec item 3) ────────────────
describe("reason taxonomy + the deny lane (owner spec item 3)", () => {
  const autoSignals = {
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
    now: new Date("2026-09-21T15:00:00Z"),
  };
  test("every reason maps to one owner class, and only ein_format maps to none", () => {
    const expected = {
      auto_approved: "clear-match",
      ein_not_found: "no-match-request-docs",
      name_mismatch: "possible-match",
      revoked_reinstated_looking: "possible-match",
      revoked_no_reinstatement: "possible-match",
      status_not_active: "possible-match",
      subsection_not_501c3: "possible-match",
      ein_already_claimed: "possible-match",
      mirror_lookup_failed: "possible-match",
      fraud_conflict: "fraud-likely",
      ein_conflict_different_org: "fraud-likely",
      ein_format: null,
    } as const;
    for (const [reason, expected_] of Object.entries(expected)) {
      const actual = reasonClassFor(reason as keyof typeof expected);
      expect(actual).toBe(expected_);
      if (actual !== null) expect(NONPROFIT_REASON_CLASSES).toContain(actual);
    }
    expect(reasonClassFor("ein_format")).toBeNull();
  });
  test("every branch of the table carries a class; only form validation carries none", () => {
    const branches = [
      decideNonprofitVerification(autoSignals),
      decideNonprofitVerification({ ...autoSignals, einFound: false, nameTier: null }),
      decideNonprofitVerification({ ...autoSignals, nameTier: "C" }),
      decideNonprofitVerification({ ...autoSignals, onRevocationList: true, inPub78: true }),
      decideNonprofitVerification({ ...autoSignals, onRevocationList: true, inPub78: false }),
      decideNonprofitVerification({ ...autoSignals, bmfStatus: "25" }),
      decideNonprofitVerification({ ...autoSignals, conflicts: ["impersonation_reported"] }),
      decideNonprofitVerification({ ...autoSignals, einFormat: "bad", ein: null }),
    ];
    for (const outcome of branches) {
      const decided = outcome.decision !== "reentry_required";
      expect(decided ? isNonprofitReasonClass(outcome.reasonClass) : outcome.reasonClass === null).toBe(true);
      // …and whatever the class, the evidence records exactly the same value.
      expect(outcome.evidence.reason_class).toBe(outcome.reasonClass);
    }
  });
  test("a DEFINITE conflict DENIES (the owner's one automatic non-approval)", () => {
    for (const conflict of ["identity_contradicts_application", "impersonation_reported"] as const) {
      const outcome = decideNonprofitVerification({ ...autoSignals, conflicts: [conflict] });
      expect(outcome.decision).toBe("deny");
      expect(outcome.status).toBe("denied");
      expect(outcome.reason).toBe("fraud_conflict");
      expect(outcome.reasonClass).toBe("fraud-likely");
      expect(outcome.flags).toContain(NONPROFIT_CONFLICT_FLAGS[conflict]);
      expect(outcome.evidence).toMatchObject({
        decision: "deny",
        reason_class: "fraud-likely",
        conflicts: [conflict],
        decided_by: `system:${NONPROFIT_VERIFICATION_ENGINE}`,
      });
      // …and never asks for documents: a denied application is not "missing paperwork".
      expect(outcome.supportingDocsRequested).toBe(false);
    }
  });
  test("one EIN claimed by two materially DIFFERENT orgs denies as a conflict", () => {
    const outcome = decideNonprofitVerification({
      ...autoSignals,
      submittedNameNormalized: "TOTALLY DIFFERENT CHARITY",
      einClaim: { userId: 7, orgName: "MAINE ASSOCIATION OF NONPROFITS", status: "approved" },
      applicantUserId: 9,
    });
    expect(outcome.decision).toBe("deny");
    expect(outcome.status).toBe("denied");
    expect(outcome.reason).toBe("ein_conflict_different_org");
    expect(outcome.reasonClass).toBe("fraud-likely");
    expect(outcome.evidence).toMatchObject({
      ein_claim: { claimed_by_user_id: 7, claimed_org_name: "MAINE ASSOCIATION OF NONPROFITS" },
    });
  });
  test("a second account for the SAME org is a duplicate, never fraud", () => {
    const outcome = decideNonprofitVerification({
      ...autoSignals,
      einClaim: { userId: 7, orgName: "Maine Association of Nonprofits Inc", status: "approved" },
      applicantUserId: 9,
    });
    expect(outcome.decision).toBe("manual_review");
    expect(outcome.status).toBe("manual_review");
    expect(outcome.reason).toBe("ein_already_claimed");
    expect(outcome.reasonClass).toBe("possible-match");
    expect(outcome.flags).toContain("one_free_org_account_per_ein");
    expect(outcome.flags).toContain("deflect_to_existing_account");
  });
  test("the same user re-applying in its own EIN is not a claim at all", () => {
    const outcome = decideNonprofitVerification({
      ...autoSignals,
      einClaim: { userId: 7, orgName: "Maine Association of Nonprofits", status: "approved" },
      applicantUserId: 7,
    });
    expect(outcome.decision).toBe("auto_approve");
    expect(outcome.reasonClass).toBe("clear-match");
  });
  test("R1 — an UNKNOWN holder name is never the fraud lane (null einClaim.orgName → manual)", () => {
    // `einClaim.orgName` is OPTIONAL: a caller may know only the holding user id. Comparing
    // a submitted name against NULL/blank is Tier C by construction, and "differs from
    // nothing" is not evidence of two organisations — so this is a duplicate to be REVIEWED,
    // never the owner's fraud lane. The submitted name here is a different string, which is
    // exactly the case that used to deny.
    const outcome = decideNonprofitVerification({
      ...autoSignals,
      submittedNameNormalized: "SOME OTHER CHARITY",
      einClaim: { userId: 7 }, // no orgName at all
      applicantUserId: 9,
    });
    expect(outcome.decision).toBe("manual_review");
    expect(outcome.status).toBe("manual_review");
    expect(outcome.reason).toBe("ein_already_claimed");
    expect(outcome.reasonClass).toBe("possible-match");
    expect(outcome.flags).toContain("ein_claim_org_name_unknown");
    expect(outcome.evidence).toMatchObject({
      ein_claim: { claimed_by_user_id: 7, claimed_org_name: null },
      ein_claim_org_name_known: false,
      conflicts: [],
    });
    // A blank/whitespace name is the same UNKNOWN, not a difference.
    const blank = decideNonprofitVerification({
      ...autoSignals,
      submittedNameNormalized: "SOME OTHER CHARITY",
      einClaim: { userId: 7, orgName: "   " },
      applicantUserId: 9,
    });
    expect(blank.status).toBe("manual_review");
    expect(blank.reason).toBe("ein_already_claimed");
    expect(blank.reasonClass).not.toBe("fraud-likely");
    // …and the genuine conflict still denies: a NAMED, materially different org.
    const conflict = decideNonprofitVerification({
      ...autoSignals,
      submittedNameNormalized: "SOME OTHER CHARITY",
      einClaim: { userId: 7, orgName: "Maine Association of Nonprofits" },
      applicantUserId: 9,
    });
    expect(conflict.decision).toBe("deny");
    expect(conflict.reason).toBe("ein_conflict_different_org");
    expect(conflict.reasonClass).toBe("fraud-likely");
  });
  test("an ambiguous record NEVER denies — the deny lane needs a definite conflict", () => {
    // Everything uncertain still lands in manual review, whatever else looks odd.
    for (const patch of [
      { nameTier: "C" as const, websiteOrEmail: "gmail.com" },
      { einFound: false, nameTier: null },
      { onRevocationList: true, inPub78: false },
      { bmfStatus: "12" },
      { bmfStatus: null },
    ]) {
      const outcome = decideNonprofitVerification({ ...autoSignals, ...patch });
      expect(outcome.decision).toBe("manual_review");
      expect(outcome.status).not.toBe("denied");
    }
  });
});

// ── End to end on the REAL fixture bytes ─────────────────────────────────────
function mirrorVerificationStore(): VerificationStore {
  const bmf = parseBmfCsvText(fixture("eo-bmf.csv"));
  const pub78 = parsePub78Text(fixture("pub78.txt"));
  const revocations = parseRevocationText(fixture("revocations.txt"));
  const byEin = new Map(bmf.rows.map((row) => [row.ein, row]));
  const pubByEin = new Map(pub78.rows.map((row) => [row.ein, row]));
  const revByEin = new Map<string, typeof revocations.rows>();
  for (const row of revocations.rows) {
    revByEin.set(row.ein, [...(revByEin.get(row.ein) ?? []), row]);
  }
  return {
    findBmfByEin: async (ein) => byEin.get(ein) ?? null,
    findPub78ByEin: async (ein) => pubByEin.get(ein) ?? null,
    findRevocationsByEin: async (ein) => revByEin.get(ein) ?? [],
    bmfPostingDate: async () => "2026-09-08",
  };
}
describe("verification end to end on the real IRS fixtures", () => {
  const store = mirrorVerificationStore();
  test("the plan's own org auto-approves (010488538, Maine Association of Nonprofits)", async () => {
    const outcome = await verifyNonprofitApplication(
      { ein: "010488538", orgName: "Maine Association of Nonprofits" },
      store,
    );
    expect(outcome.decision).toBe("auto_approve");
    expect(outcome.signals.ein).toBe("010488538");
    expect(outcome.signals.matchedBmfName).toBe("MAINE ASSOCIATION OF NONPROFITS");
    expect(outcome.signals.nameTier).toBe("A");
    expect(outcome.signals.bmfPostingDate).toBe("2026-09-08");
    expect(outcome.flags).toEqual([]);
  });
  test("a 501(c)(6) business league is REVIEWED, never auto-approved (501(c)(3) only)", async () => {
    // Maine State Chamber of Commerce — SUBSECTION 06, STATUS 01, not revoked: every
    // signal but the subsection passes. Under owner decision (a) that is a manual review.
    const outcome = await verifyNonprofitApplication(
      { ein: "010021545", orgName: "Maine State Chamber of Commerce" },
      store,
    );
    expect(outcome.decision).toBe("manual_review");
    expect(outcome.status).toBe("manual_review");
    expect(outcome.reason).toBe("subsection_not_501c3");
    expect(outcome.reasonClass).toBe("possible-match");
    expect(outcome.flags).toContain("subsection_not_501c3");
    expect(outcome.signals.bmfSubsection).toBe("06");
    expect(outcome.signals.matchedBmfName).toBe("MAINE STATE CHAMBER OF COMMERCE");
  });
  test("a group-exemption subordinate auto-approves and is tagged", async () => {
    const outcome = await verifyNonprofitApplication(
      { ein: "010163098", orgName: "National Society United States Daughters of 1812" },
      store,
    );
    expect(outcome.decision).toBe("auto_approve");
    expect(outcome.flags).toContain("group_exemption_subordinate");
  });
  test("STATUS 12 and STATUS 25 rows go to a human", async () => {
    expect((await verifyNonprofitApplication({ ein: "010214019", orgName: "Ogunquit Memorial Library" }, store)).reason).toBe("status_not_active");
    expect((await verifyNonprofitApplication({ ein: "010261396", orgName: "Kaler-Vaill Memorial Home" }, store)).reason).toBe("status_not_active");
  });
  test("a revoked org that is back in Pub 78 → reinstatement hypothesis", async () => {
    const outcome = await verifyNonprofitApplication(
      { ein: "010011694", orgName: "Massachusetts Moderators Association Inc" },
      store,
    );
    expect(outcome.reason).toBe("revoked_reinstated_looking");
    expect(outcome.recommendation).toBe("approve");
    expect(outcome.signals.onRevocationList).toBe(true);
    expect(outcome.signals.inPub78).toBe(true);
  });
  test("a revoked org absent from Pub 78 → manual, recommend decline", async () => {
    const outcome = await verifyNonprofitApplication(
      { ein: "010116380", orgName: "Masonic Trustees of Portland" },
      store,
    );
    expect(outcome.reason).toBe("revoked_no_reinstatement");
    expect(outcome.recommendation).toBe("decline");
  });
  test("an EIN nobody knows, and a malformed EIN, never auto-reject", async () => {
    const unknown = await verifyNonprofitApplication({ ein: "999999998", orgName: "Brand New Nonprofit" }, store);
    expect(unknown.reason).toBe("ein_not_found");
    expect(unknown.status).toBe("manual_review");
    const malformed = await verifyNonprofitApplication({ ein: "123", orgName: "Typo Org" }, store);
    expect(malformed.decision).toBe("reentry_required");
  });
  test("a name mismatch is manual review even though the EIN is a clean 501(c)(3)", async () => {
    const outcome = await verifyNonprofitApplication(
      { ein: "010488538", orgName: "Totally Different Name LLC" },
      store,
    );
    expect(outcome.decision).toBe("manual_review");
    expect(outcome.reason).toBe("name_mismatch");
  });
  test("an unreadable mirror fails CLOSED into manual review", async () => {
    const broken: VerificationStore = {
      findBmfByEin: async () => {
        throw new Error("connection reset");
      },
      findPub78ByEin: async () => null,
      findRevocationsByEin: async () => [],
      bmfPostingDate: async () => null,
    };
    const outcome = await verifyNonprofitApplication({ ein: "010488538", orgName: "Maine Association of Nonprofits" }, broken);
    expect(outcome.decision).toBe("manual_review");
    expect(outcome.reason).toBe("mirror_lookup_failed");
    expect(outcome.evidence.error).toContain("connection reset");
  });
});

// ── The verification-status wording (owner 09-21, RESOLVED) ──────────────────
describe("the verification-status wording (owner decision, RESOLVED 2026-09-21)", () => {
  test("the owner's sentence, exactly — as a template, not a literal", () => {
    expect(NONPROFIT_VERIFICATION_WORDING_TEMPLATE).toBe(
      "Verified against IRS tax-exempt records updated {Month Year}",
    );
    expect(verificationWording("September", 2026)).toBe(
      "Verified against IRS tax-exempt records updated September 2026",
    );
    expect(verificationWording("January", "2027")).toBe(
      "Verified against IRS tax-exempt records updated January 2027",
    );
  });
  test("the mirror's posting date is the ONLY source of the month and the year", () => {
    const expected = "Verified against IRS tax-exempt records updated September 2026";
    // The three shapes a mirror posting date arrives in (DATE column, timestamp, Date).
    expect(verificationWordingForIrsRecordsAsOf("2026-09-08")).toBe(expected);
    expect(verificationWordingForIrsRecordsAsOf("2026-09-08T00:00:00.000Z")).toBe(expected);
    expect(verificationWordingForIrsRecordsAsOf(new Date("2026-09-08T00:00:00Z"))).toBe(expected);
    expect(verificationWordingForIrsRecordsAsOf("2026-12-31")).toBe(
      "Verified against IRS tax-exempt records updated December 2026",
    );
    // NO mirror date, NO claim — and a month is never invented.
    expect(verificationWordingForIrsRecordsAsOf(null)).toBeNull();
    expect(verificationWordingForIrsRecordsAsOf(undefined)).toBeNull();
    expect(verificationWordingForIrsRecordsAsOf("")).toBeNull();
    expect(verificationWordingForIrsRecordsAsOf("not a date")).toBeNull();
    expect(verificationWordingForIrsRecordsAsOf("2026-13-01")).toBeNull();
    expect(monthNameOf(0)).toBeNull();
    expect(monthNameOf(13)).toBeNull();
    expect(monthNameOf(9)).toBe("September");
    expect(monthNameOf(1.5)).toBeNull();
  });
});

// ── The post-refresh reverify pass (owner 09-21, RESOLVED) ───────────────────
describe("post-refresh reverify (owner decision, RESOLVED 2026-09-21)", () => {
  const approvedRow = (
    ein: string,
    userId = 1,
    extra: Partial<ApprovedNonprofitApplication> = {},
  ): ApprovedNonprofitApplication => ({
    user_id: userId,
    ein,
    org_name: "Approved Organization",
    bmf_status: "01",
    bmf_subsection: "03",
    bmf_posting_date: "2026-09-08",
    on_revocation_list: false,
    ...extra,
  });
  /** A store over an explicit NEW mirror + an injected list of approved applications. */
  function fakeReverifyStore(
    approved: ApprovedNonprofitApplication[],
    bmf: Record<string, ReverifyMirrorRecord | null>,
    revoked: string[] = [],
    options: { writes?: boolean } = {},
  ) {
    const routed: ReverifyRouteInput[] = [];
    const store: NonprofitReverifyStore = {
      mirror: {
        findBmfByEin: async (ein) => bmf[ein] ?? null,
        findPub78ByEin: async () => null,
        findRevocationsByEin: async (ein) => (revoked.includes(ein) ? [{ ein }] : []),
        bmfPostingDate: async () => null,
      },
      listApprovedApplications: async () => approved,
      routeToReview: async (route) => {
        routed.push(route);
        return options.writes !== false;
      },
    };
    return { store, routed };
  }
  const NEW_POSTING_DATE = "2026-10-08";

  test("the four reasons — and only those — send an approved org back to a human", () => {
    const base = {
      ein: "010488538",
      bmf: { ein: "010488538", status: "01", subsection: "03" },
      onRevocationList: false,
    };
    expect(decideApprovedOrgRereverification(base)).toMatchObject({ action: "keep", reason: null });
    expect(decideApprovedOrgRereverification({ ...base, onRevocationList: true })).toMatchObject({
      action: "route_to_review",
      reason: "refresh_revoked",
    });
    expect(decideApprovedOrgRereverification({ ...base, bmf: null }).reason).toBe(
      "refresh_record_missing",
    );
    expect(
      decideApprovedOrgRereverification({
        ...base,
        bmf: { ein: "010488538", status: "25", subsection: "03" },
      }).reason,
    ).toBe("refresh_status_not_active");
    expect(
      decideApprovedOrgRereverification({
        ...base,
        bmf: { ein: "010488538", status: "01", subsection: "06" },
      }).reason,
    ).toBe("refresh_subsection_not_501c3");
    // ORDER: a revoked 501(c)(3) is labelled REVOKED, not "wrong subsection".
    expect(
      decideApprovedOrgRereverification({
        ...base,
        bmf: { ein: "010488538", status: "01", subsection: "06" },
        onRevocationList: true,
      }).reason,
    ).toBe("refresh_revoked");
    // Every reason is a possible-match: an uncertain record is NEVER the fraud lane, and
    // the pass has no "deny"/"revoke" outcome at all.
    expect(NONPROFIT_REVERIFY_REASON_CLASS).toBe("possible-match");
    expect(NONPROFIT_REVERIFY_REASONS).toHaveLength(4);
  });

  test("a revocation that appears after approval routes the org to review", async () => {
    const { store, routed } = fakeReverifyStore(
      [approvedRow("010488538", 7)],
      { "010488538": { ein: "010488538", status: "01", subsection: "03" } },
      ["010488538"],
    );
    const summary = await runNonprofitPostRefreshReverify(
      { postingDate: NEW_POSTING_DATE, now: new Date("2026-10-09T00:00:00Z") },
      store,
    );
    expect(summary).toMatchObject({
      postingDate: NEW_POSTING_DATE,
      checked: 1,
      routed: 1,
      kept: 0,
      skipped: 0,
      failures: [],
    });
    expect(routed).toHaveLength(1);
    expect(routed[0]).toMatchObject({ reason: "refresh_revoked", postingDate: NEW_POSTING_DATE });
    const audit = (routed[0].evidence as { refresh_reverify: Record<string, unknown> }).refresh_reverify;
    // The audit record NAMES the refresh that caused the review (the owner's requirement).
    expect(audit).toMatchObject({
      trigger: "post_refresh_reverify",
      reason: "refresh_revoked",
      reason_class: "possible-match",
      posting_date: NEW_POSTING_DATE,
      checked_at: "2026-10-09T00:00:00.000Z",
      previous: { bmf_status: "01", bmf_subsection: "03", on_revocation_list: false },
      current: { on_revocation_list: true },
      flags: [NONPROFIT_REVERIFY_FLAG, "refresh_revoked"],
    });
    expect(routed[0].current).toMatchObject({ onRevocationList: true, bmfSubsection: "03" });
    // The row keeps what it was approved on, for the human reading the queue.
    expect(routed[0].application.org_name).toBe("Approved Organization");
  });

  test("a subsection that leaves 501(c)(3) routes the org to review", async () => {
    // Approved BEFORE the owner narrowed the scope: the new extract says 501(c)(6).
    const { store, routed } = fakeReverifyStore(
      [approvedRow("010021545", 3, { org_name: "Maine State Chamber of Commerce" })],
      { "010021545": { ein: "010021545", status: "01", subsection: "06" } },
    );
    const summary = await runNonprofitPostRefreshReverify({ postingDate: NEW_POSTING_DATE }, store);
    expect(summary).toMatchObject({ checked: 1, routed: 1, kept: 0, failures: [] });
    expect(routed[0].reason).toBe("refresh_subsection_not_501c3");
    expect(routed[0].message).toContain("501(c)(6) business league");
    expect(routed[0].current).toMatchObject({ bmfSubsection: "06" });
    // A status that left 01/02 goes the same way, with that reason.
    const status = fakeReverifyStore(
      [approvedRow("010261396", 4)],
      { "010261396": { ein: "010261396", status: "25", subsection: "03" } },
    );
    const statusSummary = await runNonprofitPostRefreshReverify(
      { postingDate: NEW_POSTING_DATE },
      status.store,
    );
    expect(statusSummary.routed).toBe(1);
    expect(status.routed[0].reason).toBe("refresh_status_not_active");
    expect(status.routed[0].message).toContain("terminated");
  });

  test("an unchanged org is left COMPLETELY alone — no write, no churn", async () => {
    const { store, routed } = fakeReverifyStore(
      [approvedRow("010488538", 1), approvedRow("010163098", 2)],
      {
        "010488538": { ein: "010488538", status: "01", subsection: "03" },
        "010163098": { ein: "010163098", status: "01", subsection: "03" },
      },
    );
    const summary = await runNonprofitPostRefreshReverify({ postingDate: NEW_POSTING_DATE }, store);
    expect(summary).toMatchObject({ checked: 2, routed: 0, kept: 2, failures: [] });
    // NOT ONE write: the row's updated_at must not move for an unchanged organization.
    expect(routed).toEqual([]);
    expect(summary.entries).toEqual([
      { user_id: 1, ein: "010488538", action: "keep", reason: null },
      { user_id: 2, ein: "010163098", action: "keep", reason: null },
    ]);
  });

  test("never a silent cut: a route that finds the row already moved is SKIPPED, not forced", async () => {
    const { store } = fakeReverifyStore(
      [approvedRow("010488538", 5)],
      { "010488538": null },
      [],
      { writes: false },
    );
    const summary = await runNonprofitPostRefreshReverify({ postingDate: NEW_POSTING_DATE }, store);
    expect(summary).toMatchObject({ checked: 1, routed: 0, kept: 0, skipped: 1, failures: [] });
  });

  test("one unreadable record does not stop the pass, and is reported", async () => {
    const approved = [approvedRow("010488538", 1), approvedRow("010116380", 2)];
    const routed: ReverifyRouteInput[] = [];
    const store: NonprofitReverifyStore = {
      mirror: {
        findBmfByEin: async (ein) => {
          if (ein === "010488538") throw new Error("connection reset");
          return { ein, status: "01", subsection: "03" };
        },
        findPub78ByEin: async () => null,
        findRevocationsByEin: async () => [],
        bmfPostingDate: async () => null,
      },
      listApprovedApplications: async () => approved,
      routeToReview: async (route) => {
        routed.push(route);
        return true;
      },
    };
    const summary = await runNonprofitPostRefreshReverify({ postingDate: NEW_POSTING_DATE }, store);
    expect(summary.checked).toBe(2);
    expect(summary.kept).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]).toContain("connection reset");
  });

  test("on the committed fixtures: the revoked org is routed, the unchanged 501(c)(3) is not", async () => {
    // The REAL fixture bytes: 010116380 (Masonic Trustees of Portland) is in the BMF AND on
    // the auto-revocation list; 010488538 (Maine Association of Nonprofits) is a clean
    // 501(c)(3)/STATUS 01 and must not be touched.
    const routed: ReverifyRouteInput[] = [];
    const store: NonprofitReverifyStore = {
      mirror: mirrorVerificationStore(),
      listApprovedApplications: async () => [
        approvedRow("010116380", 1, { org_name: "Masonic Trustees of Portland" }),
        approvedRow("010488538", 2, { org_name: "Maine Association of Nonprofits" }),
      ],
      routeToReview: async (route) => {
        routed.push(route);
        return true;
      },
    };
    const summary = await runNonprofitPostRefreshReverify({ postingDate: NEW_POSTING_DATE }, store);
    expect(summary).toMatchObject({ checked: 2, routed: 1, kept: 1, failures: [] });
    expect(routed.map((route) => route.application.ein)).toEqual(["010116380"]);
    expect(routed[0].reason).toBe("refresh_revoked");
    expect(routed[0].current).toMatchObject({ onRevocationList: true });
    expect(summary.entries).toEqual([
      { user_id: 1, ein: "010116380", action: "route_to_review", reason: "refresh_revoked" },
      { user_id: 2, ein: "010488538", action: "keep", reason: null },
    ]);
  });

  test("a store that cannot list approved orgs reports the failure instead of throwing", async () => {
    const store: NonprofitReverifyStore = {
      mirror: mirrorVerificationStore(),
      listApprovedApplications: async () => {
        throw new Error("db is down");
      },
      routeToReview: async () => true,
    };
    const summary = await runNonprofitPostRefreshReverify({ postingDate: NEW_POSTING_DATE }, store);
    expect(summary.checked).toBe(0);
    expect(summary.failures[0]).toContain("db is down");
  });

  test("the pass runs ONLY after a committed BMF import — never on a failed or verify run", async () => {
    const calls: (string | null)[] = [];
    const reverify = async (context: { postingDate: string | null }) => {
      calls.push(context.postingDate);
      return emptyReverifySummary(context.postingDate);
    };
    // (a) a COMMITTED import: the pass runs once, with the NEW posting date.
    const good = fakeMirrorStore();
    const goodFetch = fakeFetch(bmfBodies({ recordCount: 8 }));
    const committed = await refreshIrsSource(
      "eo_bmf",
      { mode: "import" },
      { store: good, fetchFn: goodFetch.fn, reverify },
    );
    expect(committed.ok).toBe(true);
    expect(good.events).toContain("commitStage:eo_bmf");
    expect(calls).toEqual(["2026-09-08"]);
    expect(committed.reverify?.postingDate).toBe("2026-09-08");
    // (b) a FAILED import: nothing is swapped, nothing is re-checked — the OLD mirror keeps
    // serving and no already-approved org is judged against data that never landed.
    calls.length = 0;
    const bad = fakeMirrorStore();
    const badFetch = fakeFetch(bmfBodies({ recordCount: 1964958 }));
    const failed = await refreshIrsSource(
      "eo_bmf",
      { mode: "import" },
      { store: bad, fetchFn: badFetch.fn, reverify },
    );
    expect(failed.ok).toBe(false);
    expect(failed.failures).toContain("published_record_count_mismatch");
    expect(calls).toEqual([]);
    expect(failed.reverify).toBeUndefined();
    expect(bad.events).toContain("abortStage:eo_bmf");
    expect(bad.events).not.toContain("commitStage:eo_bmf");
    // Rows only ever reached the STAGING table; the abort is what leaves the LIVE mirror serving.
    expect(bad.events).toContain("writeStage:eo_bmf");
    // (c) --verify swaps nothing, so the pass never runs either.
    calls.length = 0;
    const verifyOnly = fakeMirrorStore();
    const verifyFetch = fakeFetch(bmfBodies({ recordCount: 8 }));
    await refreshIrsSource("eo_bmf", { mode: "verify" }, { store: verifyOnly, fetchFn: verifyFetch.fn, reverify });
    expect(calls).toEqual([]);
    // (d) another source's import does not trigger a BMF re-check.
    calls.length = 0;
    const pub78 = fakeMirrorStore();
    const pub78Fetch = fakeFetch({
      [payloadsForSource("pub78")[0].url]: buildZip(IRS_PUB78_ZIP_MEMBER, fixture("pub78.txt")),
    });
    await refreshIrsSource("pub78", { mode: "import" }, { store: pub78, fetchFn: pub78Fetch.fn, reverify });
    expect(calls).toEqual([]);
  });

  test("a pass that throws never turns a completed import into a failed one", async () => {
    const store = fakeMirrorStore();
    const { fn } = fakeFetch(bmfBodies({ recordCount: 8 }));
    const logs: string[] = [];
    const summary = await refreshIrsSource(
      "eo_bmf",
      { mode: "import" },
      {
        store,
        fetchFn: fn,
        log: (message) => logs.push(message),
        reverify: async () => {
          throw new Error("reverify store unreachable");
        },
      },
    );
    expect(summary.ok).toBe(true);
    expect(summary.failures).toEqual([]);
    expect(store.events).toContain("commitStage:eo_bmf");
    expect(summary.reverify?.failures[0]).toContain("reverify store unreachable");
    expect(logs.join("\n")).toContain("reverify pass FAILED");
  });

  test("a BMF import with no runner wired SAYS SO in the log", async () => {
    const store = fakeMirrorStore();
    const { fn } = fakeFetch(bmfBodies({ recordCount: 8 }));
    const logs: string[] = [];
    const summary = await runIrsMirrorRefresh(
      { mode: "import", sources: ["eo_bmf"] },
      { store, fetchFn: fn, log: (message) => logs.push(message) },
    );
    expect(summary.ok).toBe(true);
    expect(logs.join("\n")).toContain("no post-refresh reverify runner wired");
  });
});

// ── Entitlement + search policy ──────────────────────────────────────────────
describe("entitlement and search policy", () => {
  const row = (status: string | null, extra: Partial<NonprofitApplicationRow> = {}): NonprofitApplicationRow => ({
    user_id: 1,
    status,
    verification_method: status === "approved" ? "irs_eo_bmf" : null,
    bmf_subsection: "03",
    bmf_posting_date: "2026-09-08",
    granted_at: "2026-09-21T00:00:00.000Z",
    reverify_due_at: "2027-09-21T00:00:00.000Z",
    ...extra,
  });
  test("no application, and every non-approved status", () => {
    expect(evaluateNonprofitEntitlement(null).verified).toBe(false);
    for (const status of ["pending", "manual_review", "denied", "revoked"]) {
      const entitlement = evaluateNonprofitEntitlement(row(status));
      expect(entitlement.verified).toBe(false);
      expect(entitlement.status).toBe(status);
      expect(entitlement.irsRecordsAsOf).toBeNull();
    }
  });
  test("an approved application is verified, labelled and dated", () => {
    const entitlement = evaluateNonprofitEntitlement(row("approved"));
    expect(entitlement).toMatchObject({
      verified: true,
      status: "approved",
      method: "irs_eo_bmf",
      subsectionLabel: "501(c)(3) charitable organization",
      subsectionEligible: true,
      irsRecordsAsOf: "2026-09-08",
      reverifyDue: false,
    });
  });
  test("the exact owner wording rides on the entitlement, from the mirror date only", () => {
    // Owner 2026-09-21, verbatim: "Verified against IRS tax-exempt records updated
    // [Month Year]" — and the month/year comes from the MIRROR's posting date, never a
    // literal typed into a page.
    expect(evaluateNonprofitEntitlement(row("approved")).verificationWording).toBe(
      "Verified against IRS tax-exempt records updated September 2026",
    );
    // No mirror date → no claim (the mirror-never-imported case).
    expect(
      evaluateNonprofitEntitlement(row("approved", { bmf_posting_date: null })).verificationWording,
    ).toBeNull();
    // Only a VERIFIED org carries the sentence.
    for (const status of ["pending", "manual_review", "denied", "revoked"]) {
      expect(evaluateNonprofitEntitlement(row(status)).verificationWording).toBeNull();
    }
    expect(evaluateNonprofitEntitlement(null).verificationWording).toBeNull();
  });
  test("the annual reverify is a queue flag — it NEVER removes the free access", () => {
    const overdue = evaluateNonprofitEntitlement(row("approved"), new Date("2028-01-01T00:00:00Z"));
    expect(overdue.reverifyDue).toBe(true);
    expect(overdue.verified).toBe(true);
    expect(nonprofitSearchPolicy(overdue)).toEqual(NONPROFIT_FREE_SEARCH_POLICY);
    expect(computeReverifyDueAt("2026-09-21T00:00:00.000Z")).toBe("2027-09-21T00:00:00.000Z");
  });
  test("verified → the owner's spec item 2 promise, exactly", () => {
    const policy = nonprofitSearchPolicy(evaluateNonprofitEntitlement(row("approved")));
    expect(policy).toEqual(NONPROFIT_FREE_SEARCH_POLICY);
    expect(policy).toMatchObject({
      tier: "nonprofit_free",
      searchesPerDay: "unlimited",
      previewLimit: "unlimited",
      fullDetailsPerDay: "unlimited",
      fullDescriptions: true,
      eligibilityDetail: true,
      officialLinks: true,
      // Owner spec item 2 lists BASIC filters for the verified tier; advanced filters stay
      // in the paid upgrades.
      basicFilters: true,
      canSave: true,
      saveLimit: 10,
      includesStateGrants: true,
      weeklyDeadlineEmail: true,
      teamMembers: 1,
      creditCardRequired: false,
      includesPaidUpgrades: false,
    });
    expect(NONPROFIT_SAVE_LIMIT).toBe(10);
    expect(policy.surfaces).not.toContain("radar");
    expect(NONPROFIT_FREE_PROMISE).toContain("No credit card required");
  });
  test("pending and manual_review → the owner's exact pending numbers", () => {
    for (const status of ["pending", "manual_review"]) {
      expect(nonprofitSearchPolicy(evaluateNonprofitEntitlement(row(status)))).toEqual(
        NONPROFIT_PENDING_SEARCH_POLICY,
      );
    }
    // Owner spec item 2, verbatim: 3 grant searches/day · full details for 5 results/day ·
    // official application links · no saved grants or alerts yet.
    expect(NONPROFIT_PENDING_SEARCH_POLICY).toMatchObject({
      tier: "nonprofit_pending",
      searchesPerDay: 3,
      fullDetailsPerDay: 5,
      previewLimit: 5,
      officialLinks: true,
      basicFilters: false,
      canSave: false,
      saveLimit: 0,
      weeklyDeadlineEmail: false,
      creditCardRequired: false,
    });
  });
  test("the two allowances are INDEPENDENT: 3 searches can unlock 5 full results", () => {
    const pending: NonprofitSearchPolicy = NONPROFIT_PENDING_SEARCH_POLICY;
    // Search #1..#3 are allowed, #4 is not — and each one still carries rows.
    expect(nonprofitSearchAllowance(pending, 0)).toEqual({ allowed: true, remaining: 3 });
    expect(nonprofitSearchAllowance(pending, 2)).toEqual({ allowed: true, remaining: 1 });
    expect(nonprofitSearchAllowance(pending, 3)).toEqual({ allowed: false, remaining: 0 });
    // Full detail runs out after FIVE results across ALL of those searches — the number a
    // policy with only `previewLimit` could not express.
    expect(nonprofitFullDetailAllowance(pending, 0)).toEqual({
      remaining: 5,
      canUnlock: true,
      fallback: "truncated_preview",
    });
    expect(nonprofitFullDetailAllowance(pending, 4)).toEqual({
      remaining: 1,
      canUnlock: true,
      fallback: "truncated_preview",
    });
    expect(nonprofitFullDetailAllowance(pending, 5)).toEqual({
      remaining: 0,
      canUnlock: false,
      fallback: "truncated_preview",
    });
    // A search is still allowed while the full-detail budget is spent: the two limits are
    // separate promises, and neither silently becomes the other.
    expect(nonprofitSearchAllowance(pending, 0).allowed).toBe(true);
    expect(nonprofitFullDetailAllowance(pending, 5).canUnlock).toBe(false);
  });
  test("the verified tier has no allowance wall, and the anonymous tier has no full rows", () => {
    expect(nonprofitSearchAllowance(NONPROFIT_FREE_SEARCH_POLICY, 10_000)).toEqual({
      allowed: true,
      remaining: Infinity,
    });
    expect(nonprofitFullDetailAllowance(NONPROFIT_FREE_SEARCH_POLICY, 10_000).canUnlock).toBe(true);
    expect(nonprofitSearchAllowance(NONPROFIT_ANONYMOUS_SEARCH_POLICY, 0)).toEqual({
      allowed: true,
      remaining: 1,
    });
    expect(nonprofitSearchAllowance(NONPROFIT_ANONYMOUS_SEARCH_POLICY, 1)).toEqual({
      allowed: false,
      remaining: 0,
    });
    expect(nonprofitFullDetailAllowance(NONPROFIT_ANONYMOUS_SEARCH_POLICY, 0)).toEqual({
      remaining: 0,
      canUnlock: false,
      fallback: "truncated_preview",
    });
  });
  test("no application, denied or revoked → today's anonymous behaviour", () => {
    expect(nonprofitSearchPolicy(evaluateNonprofitEntitlement(null))).toEqual(NONPROFIT_ANONYMOUS_SEARCH_POLICY);
    for (const status of ["denied", "revoked"]) {
      const entitlement: NonprofitEntitlement = evaluateNonprofitEntitlement(row(status));
      expect(nonprofitSearchPolicy(entitlement).tier).toBe("anonymous");
    }
    expect(NONPROFIT_ANONYMOUS_SEARCH_POLICY.searchesPerDay).toBe(1);
  });
  test("one free org account per EIN: the apply-time claim check (owner spec item 6)", () => {
    // Nobody holds the EIN yet.
    expect(evaluateNonprofitEinClaim({ userId: 42, existing: null })).toEqual({
      allowed: true,
      outcome: "available",
      message: null,
      heldByUserId: null,
    });
    // The SAME user re-applying updates its own row — never a second account.
    expect(evaluateNonprofitEinClaim({ userId: 42, existing: { user_id: 42, status: "manual_review" } })).toEqual({
      allowed: true,
      outcome: "reapply_same_user",
      message: null,
      heldByUserId: 42,
    });
    // ANOTHER user, same EIN → deflected with a clear message, never silently allowed.
    const claimed = evaluateNonprofitEinClaim({
      userId: 43,
      existing: { user_id: 42, status: "approved" },
    });
    expect(claimed.allowed).toBe(false);
    expect(claimed.outcome).toBe("ein_already_claimed");
    expect(claimed.message).toBe(NONPROFIT_EIN_CLAIMED_MESSAGE);
    expect(claimed.heldByUserId).toBe(42);
    // Fail closed: a row we cannot attribute to a user is still a claim.
    expect(evaluateNonprofitEinClaim({ userId: 43, existing: { user_id: null, status: "pending" } }).allowed).toBe(
      false,
    );
  });
  test("subsection labels are the official ones, never invented", () => {
    expect(subsectionLabel("03")).toBe("501(c)(3) charitable organization");
    expect(subsectionLabel("19")).toBe("501(c)(19) veterans' organization");
    expect(subsectionLabel("77")).toBe("77");
    expect(subsectionLabel(null)).toBeNull();
  });
});

// ── The mirror job ───────────────────────────────────────────────────────────
describe("IRS payload parsing (real byte formats)", () => {
  test("the EO BMF fixture parses: 28 fields, CRLF, zero-padded EIN, header verified", () => {
    const { rows, stats, header } = parseBmfCsvText(fixture("eo-bmf.csv"));
    expect(header.ok).toBe(true);
    expect(rows.length).toBe(8);
    expect(stats.rowCount).toBe(8);
    expect(stats.quarantined).toHaveLength(0);
    expect(stats.distinctEinCount).toBe(8);
    const maine = rows.find((row) => row.ein === "010488538");
    expect(maine).toMatchObject({
      name: "MAINE ASSOCIATION OF NONPROFITS",
      state: "ME",
      subsection: "03",
      status: "01",
      group_no: "0000",
      ntee: "S50",
      sort_name: null,
    });
    expect(maine?.ein).toBe("010488538"); // the leading zero survived
    expect(rows.every((row) => !row.name.includes("\r"))).toBe(true);
  });
  test("a reordered header is a hard failure (fields would mis-map)", () => {
    expect(parseBmfHeader("NAME,EIN,ICO").ok).toBe(false);
    const swapped = readFileSync(new URL("eo-bmf.csv", DIR), "utf8")
      .split("\r\n")[0]
      .replace("EIN,NAME", "NAME,EIN");
    expect(parseBmfHeader(swapped).ok).toBe(false);
  });
  test("a malformed row is quarantined, never silently fixed", () => {
    const { rows, stats } = parseBmfCsvText(`${fixture("eo-bmf.csv")}010488538,SHORT,ROW\r\n`);
    expect(rows.length).toBe(8);
    expect(stats.quarantined).toHaveLength(1);
    expect(stats.quarantined[0].fields).toBe(3);
  });
  test("Pub 78: 6 pipe fields, blank leading lines, commas inside the code", () => {
    const { rows, stats } = parsePub78Text(fixture("pub78.txt"));
    expect(rows.length).toBe(4);
    expect(stats.lineCount).toBe(4);
    expect(stats.quarantined).toHaveLength(0);
    expect(rows.find((row) => row.ein === "010488538")?.deductibility_code).toBe("PC");
    expect(rows.find((row) => row.ein === "010019709")?.deductibility_code).toBe("EO,LODGE");
  });
  test("the revocation list: 12 fields, DD-MON-YYYY dates, an EIN can repeat", () => {
    const { rows, stats } = parseRevocationText(fixture("revocations.txt"));
    expect(rows.length).toBe(7);
    expect(stats.quarantined).toHaveLength(0);
    const reinstated = rows.find((row) => row.ein === "001037180");
    expect(reinstated).toMatchObject({
      revocation_date: "2013-06-15",
      revocation_posting_date: "2013-10-21",
      reinstatement_date: "2013-06-15",
    });
    const plain = rows.find((row) => row.ein === "000003154");
    expect(plain).toMatchObject({ revocation_date: "2017-11-15", revocation_posting_date: "2018-03-12", reinstatement_date: null });
    expect(parseIrsDate("15-NOV-2017")).toBe("2017-11-15");
    expect(parseIrsDate("")).toBeNull();
    expect(parseIrsDate("2018-03-12")).toBeNull();
  });
  test("the published posting date + record count come off the real page markup", () => {
    const publication = parseBmfPublication(fixture("eo-bmf-landing-window.html"));
    expect(publication).toEqual({ recordCount: 1964958, postingDate: "2026-09-08" });
  });
  test("the completeness proof fails loudly on any disagreement", () => {
    const { stats } = parseBmfCsvText(fixture("eo-bmf.csv"));
    const openStats = { ...stats, distinctEinCount: 8 };
    expect(
      verifyBmfCompleteness({
        regionRowCounts: [8],
        published: { recordCount: 8, postingDate: "2026-09-08" },
        stats: openStats,
        headerOk: true,
      }).ok,
    ).toBe(true);
    const mismatch = verifyBmfCompleteness({
      regionRowCounts: [8],
      published: { recordCount: 1964958, postingDate: "2026-09-08" },
      stats: openStats,
      headerOk: true,
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.failures).toContain("published_record_count_mismatch");
    expect(
      verifyBmfCompleteness({
        regionRowCounts: [8],
        published: { recordCount: null, postingDate: null },
        stats: openStats,
        headerOk: true,
      }).failures,
    ).toContain("published_record_count_unavailable");
    expect(
      verifyBmfCompleteness({
        regionRowCounts: [8],
        published: { recordCount: 8, postingDate: null },
        stats: { ...openStats, distinctEinCount: 7 },
        headerOk: true,
      }).failures,
    ).toContain("duplicate_eins");
  });
  test("identities: the BMF key is the EIN, a revocation's key is its row content", () => {
    const bmf = parseBmfCsvText(fixture("eo-bmf.csv")).rows[0];
    expect(mirrorKeyOf("eo_bmf", bmf)).toBe(bmf.ein);
    expect(mirrorHashOf("eo_bmf", bmf)).toBe(bmf.content_hash);
    const revocation = parseRevocationText(fixture("revocations.txt")).rows[0];
    expect(mirrorKeyOf("revocations", revocation)).toBe(revocation.row_hash);
    expect(mirrorHashOf("revocations", revocation)).toBe(revocation.row_hash);
    expect(mirrorKeyOf("pub78", parsePub78Text(fixture("pub78.txt")).rows[0])).toBe("010488538");
  });
  test("the content hash ignores nothing that matters and is stable", () => {
    const rows = parseBmfCsvText(fixture("eo-bmf.csv")).rows;
    const again = parseBmfCsvText(fixture("eo-bmf.csv")).rows;
    expect(rows.map((r) => r.content_hash)).toEqual(again.map((r) => r.content_hash));
    expect(new Set(rows.map((r) => r.content_hash)).size).toBe(8);
  });
});

// ── The zip reader (real layout + a hand-built member) ────────────────────────
function buildZip(memberName: string, content: string): Buffer {
  const nameBytes = Buffer.from(memberName, "utf8");
  const data = Buffer.from(content, "utf8");
  const deflated = deflateRawSync(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const centralSize = central.length + nameBytes.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(local.length + nameBytes.length + deflated.length, 16);
  return Buffer.concat([local, nameBytes, deflated, central, nameBytes, eocd]);
}
describe("zip reading (no dependency)", () => {
  test("the real pub78.zip's first bytes parse as a local file header", () => {
    const header = readZipLocalHeader(fixtureBytes("pub78-zip-head.bin"), 0);
    expect(header?.name).toBe(IRS_PUB78_ZIP_MEMBER);
    expect(header?.method).toBe(8);
  });
  test("a deflated member round-trips through the reader", () => {
    const text = fixture("pub78.txt");
    const zip = buildZip(IRS_PUB78_ZIP_MEMBER, text);
    expect(readZipCentralDirectory(zip).map((entry) => entry.name)).toEqual([IRS_PUB78_ZIP_MEMBER]);
    expect(readZipMember(zip, IRS_PUB78_ZIP_MEMBER).toString("utf8")).toBe(text);
    expect(() => readZipMember(zip, "nope.txt")).toThrow(/not found/);
  });
  test("the payload list is the 4 region CSVs for the BMF and one zip member each otherwise", () => {
    expect(payloadsForSource("eo_bmf").map((payload) => payload.label)).toEqual([
      "eo1.csv",
      "eo2.csv",
      "eo3.csv",
      "eo4.csv",
    ]);
    expect(payloadsForSource("pub78")).toHaveLength(1);
    expect(payloadsForSource("revocations")[0].url).toContain("revocation.zip");
  });
});

// ── The orchestration: verify writes nothing, import swaps ────────────────────
interface FakeMirrorStore extends IrsMirrorStore {
  events: string[];
  written: IrsMirrorRow[];
  runs: IrsMirrorRunEntry[];
}
function fakeMirrorStore(options: {
  existing?: Partial<Record<IrsMirrorSource, Map<string, string>>>;
  counts?: Partial<Record<IrsMirrorSource, number>>;
} = {}): FakeMirrorStore {
  const events: string[] = [];
  const written: IrsMirrorRow[] = [];
  const runs: IrsMirrorRunEntry[] = [];
  return {
    events,
    written,
    runs,
    async countRows(source) {
      return options.counts?.[source] ?? 0;
    },
    async fetchExistingHashes(source, keys) {
      const live = options.existing?.[source] ?? new Map<string, string>();
      const found = new Map<string, string>();
      for (const key of keys) {
        const hash = live.get(key);
        if (hash !== undefined) found.set(key, hash);
      }
      return found;
    },
    async beginStage(source) {
      events.push(`beginStage:${source}`);
    },
    async writeStage(source, rows) {
      events.push(`writeStage:${source}`);
      written.push(...rows);
    },
    async commitStage(source) {
      events.push(`commitStage:${source}`);
    },
    async abortStage(source) {
      events.push(`abortStage:${source}`);
    },
    async upsertBatch(source) {
      events.push(`upsertBatch:${source}`);
    },
    async recordRun(entry) {
      runs.push(entry);
    },
  };
}
function fakeFetch(bodies: Record<string, string | Buffer>) {
  const calls: string[] = [];
  const fn = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const body = bodies[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body as unknown as BodyInit);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const BMF_URLS = payloadsForSource("eo_bmf").map((payload) => payload.url);
function bmfBodies(options: { recordCount: number }): Record<string, string | Buffer> {
  const csv = fixture("eo-bmf.csv");
  const headerOnly = csv.split("\r\n")[0];
  return {
    [BMF_URLS[0]]: csv,
    [BMF_URLS[1]]: headerOnly,
    [BMF_URLS[2]]: headerOnly,
    [BMF_URLS[3]]: headerOnly,
    [IRS_BMF_LANDING_URL]: `<p>Updated data posting date:&nbsp;<strong>9/8/2026</strong></p><p>Record count:&nbsp;<strong>${options.recordCount.toLocaleString("en-US")}</strong></p>`,
  };
}
describe("mirror refresh orchestration", () => {
  test("--verify proves completeness, reports the plan and writes NOTHING", async () => {
    const store = fakeMirrorStore();
    const { fn } = fakeFetch(bmfBodies({ recordCount: 8 }));
    const summary = await refreshIrsSource("eo_bmf", { mode: "verify", batchSize: 4 }, { store, fetchFn: fn });
    expect(summary.ok).toBe(true);
    expect(summary.rowCount).toBe(8);
    expect(summary.diff.inserted).toBe(8);
    expect(summary.diff.quarantined).toBe(0);
    expect(summary.postingDate).toBe("2026-09-08");
    expect(summary.publication?.recordCount).toBe(8);
    // NOTHING was staged, swapped or upserted:
    expect(store.events).toEqual([]);
    expect(store.written).toEqual([]);
    // …but the run is on the record, in verify mode.
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({ source: "eo_bmf", mode: "verify", status: "ok", rowCount: 8 });
  });
  test("a published record count that disagrees with the rows FAILS the run and swaps nothing", async () => {
    const store = fakeMirrorStore();
    const { fn } = fakeFetch(bmfBodies({ recordCount: 1964958 }));
    const summary = await refreshIrsSource("eo_bmf", { mode: "import" }, { store, fetchFn: fn });
    expect(summary.ok).toBe(false);
    expect(summary.failures).toContain("published_record_count_mismatch");
    expect(store.events).toContain("beginStage:eo_bmf");
    expect(store.events).toContain("abortStage:eo_bmf");
    expect(store.events).not.toContain("commitStage:eo_bmf");
    expect(store.runs[0]).toMatchObject({ mode: "import", status: "error" });
  });
  test("an unreadable publication page is a failed run, never an empty mirror", async () => {
    const store = fakeMirrorStore();
    const bodies = bmfBodies({ recordCount: 8 });
    delete bodies[IRS_BMF_LANDING_URL];
    const { fn } = fakeFetch(bodies);
    const summary = await refreshIrsSource("eo_bmf", { mode: "verify" }, { store, fetchFn: fn });
    expect(summary.ok).toBe(false);
    expect(summary.failures).toContain("publication_unavailable");
    expect(summary.failures).toContain("published_record_count_unavailable");
    expect(store.runs[0].status).toBe("error");
  });
  test("import: staged rows, an exact diff, and the swap — one insert per row, no rewrites", async () => {
    const pub78Text = fixture("pub78.txt");
    const parsed = parsePub78Text(pub78Text);
    const existing = new Map([[parsed.rows[0].ein, parsed.rows[0].content_hash]]);
    const store = fakeMirrorStore({
      existing: { pub78: existing },
      counts: { pub78: 1 },
    });
    const { fn } = fakeFetch({ [payloadsForSource("pub78")[0].url]: buildZip(IRS_PUB78_ZIP_MEMBER, pub78Text) });
    const summary = await refreshIrsSource("pub78", { mode: "import", batchSize: 2 }, { store, fetchFn: fn });
    expect(summary.failures).toEqual([]);
    expect(summary.rowCount).toBe(4);
    expect(summary.diff).toMatchObject({ liveRowCount: 1, inserted: 3, updated: 0, unchanged: 1, pruned: 0 });
    expect(store.events[0]).toBe("beginStage:pub78");
    expect(store.events.at(-1)).toBe("commitStage:pub78");
    expect(store.written).toHaveLength(4);
    expect(store.events).not.toContain("abortStage:pub78");
    expect(store.runs[0]).toMatchObject({ source: "pub78", mode: "import", status: "ok", insertedCount: 3, unchangedCount: 1 });
  });
  test("import: a row the source no longer publishes is counted as a prune", async () => {
    // 9 rows live in the mirror, of which ONE is still republished (unchanged) — the other
    // 8 are rows the source has dropped, and the 6 remaining payload rows are new.
    const live = parseRevocationText(fixture("revocations.txt")).rows[0];
    const store = fakeMirrorStore({
      existing: { revocations: new Map([[live.row_hash, live.row_hash]]) },
      counts: { revocations: 9 },
    });
    const { fn } = fakeFetch({ [payloadsForSource("revocations")[0].url]: buildZip("data-download-revocation.txt", fixture("revocations.txt")) });
    const summary = await refreshIrsSource("revocations", { mode: "import" }, { store, fetchFn: fn });
    expect(summary.failures).toEqual([]);
    expect(summary.rowCount).toBe(7);
    expect(summary.diff).toMatchObject({ liveRowCount: 9, inserted: 6, unchanged: 1, pruned: 8 });
  });
  test("a bounded smoke run can never import and says so", async () => {
    const store = fakeMirrorStore();
    const { fn } = fakeFetch(bmfBodies({ recordCount: 8 }));
    const summary = await refreshIrsSource("eo_bmf", { mode: "import", maxRows: 3 }, { store, fetchFn: fn });
    expect(summary.failures).toContain("bounded_run");
    expect(store.events).toEqual([]);
  });
  test("one source's fetch failure does not stop the run, and is recorded as an error", async () => {
    const store = fakeMirrorStore();
    const { fn } = fakeFetch(bmfBodies({ recordCount: 8 }));
    const summary = await runIrsMirrorRefresh(
      { mode: "verify", sources: ["eo_bmf", "revocations"] },
      { store, fetchFn: fn },
    );
    expect(summary.sources).toHaveLength(2);
    expect(summary.sources[0].ok).toBe(true);
    expect(summary.sources[1].ok).toBe(false);
    expect(summary.sources[1].failures).toContain("fetch_or_parse_error");
    expect(summary.ok).toBe(false);
    expect(store.runs.map((run) => run.status)).toEqual(["ok", "error"]);
  });
});

// ── Zip payloads over HTTP (regression: the ARCHIVE must never be parsed as text) ──
describe("zip payloads over HTTP", () => {
  test("a fetched zip is inflated to its member — the rows are the member's text", async () => {
    const text = fixture("pub78.txt");
    const payload = payloadsForSource("pub78")[0];
    expect(payload.zipMember).toBe(IRS_PUB78_ZIP_MEMBER);
    const { fn } = fakeFetch({ [payload.url]: buildZip(IRS_PUB78_ZIP_MEMBER, text) });
    const stream = await openPayloadStream(payload, {}, { fetchFn: fn });
    const lines: string[] = [];
    for await (const line of iterateLines(stream)) lines.push(line);
    // Exactly the member's non-empty lines (CRLF stripped), NOT a line of binary zip.
    const expected = Array.from(iterateLinesOfText(text)).filter((line) => line.length > 0);
    expect(lines.filter((line) => line.length > 0)).toEqual(expected);
    expect(expected).toHaveLength(4); // the 2 blank leading lines in the fixture are blank
    expect(lines.filter((line) => line.split("|").length === 6)).toHaveLength(4);
  });
  test("a body larger than the archive cap is refused instead of buffered", async () => {
    const payload = payloadsForSource("pub78")[0];
    await expect(readResponseBytes(new Response("x".repeat(100)), payload, 50)).rejects.toThrow(
      /exceeds 50 bytes/,
    );
    expect((await readResponseBytes(new Response("abc"), payload, 50)).toString("utf8")).toBe("abc");
  });
});

// ── Migration 045 ↔ src/db/schema.sql (the owner's spec, enforced on the DDL) ──
describe("migration 045 and the schema.sql mirror", () => {
  const MIGRATION_045_SQL = readFileSync(
    new URL("../../db/migrations/045_nonprofit_free.sql", import.meta.url),
    "utf8",
  );
  const SCHEMA_SQL = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
  const FILES: [string, string][] = [
    ["migration 045", MIGRATION_045_SQL],
    ["schema.sql", SCHEMA_SQL],
  ];
  /** Every "file: what" pair that is MISSING — so a failure names the file and the rule. */
  function missing(predicate: (sql: string) => boolean): string[] {
    return FILES.filter(([, sql]) => !predicate(sql)).map(([name]) => name);
  }
  test("one free org account per EIN is a UNIQUE constraint in BOTH files", () => {
    expect(missing((sql) => sql.includes("nonprofit_applications_ein_key ON nonprofit_applications (ein)"))).toEqual(
      [],
    );
  });
  test("the status list is the owner's taxonomy — 'rejected' is gone, 'denied' is in", () => {
    const expected = `CHECK (status IN (${NONPROFIT_APPLICATION_STATUSES.map((s) => `'${s}'`).join(", ")}))`;
    expect(missing((sql) => sql.includes(expected))).toEqual([]);
    // The old value must not survive anywhere in either file.
    expect(missing((sql) => sql.includes("'rejected'"))).toEqual(FILES.map(([name]) => name));
    expect(NONPROFIT_APPLICATION_STATUSES).toContain("denied");
  });
  test("the decision list carries 'deny', and the four reason classes are all allowed", () => {
    const decisionCheck =
      "CHECK (decision IS NULL OR decision IN ('auto_approve', 'manual_review', 'deny', 'reentry_required'))";
    expect(missing((sql) => sql.includes(decisionCheck))).toEqual([]);
    for (const reasonClass of NONPROFIT_REASON_CLASSES) {
      expect(missing((sql) => sql.includes(`'${reasonClass}'`))).toEqual([]);
    }
    expect(missing((sql) => sql.includes("supporting_docs_requested BOOLEAN NOT NULL DEFAULT FALSE"))).toEqual([]);
    // The engine's reason-class union and the DDL's CHECK list are the same four strings.
    expect(NONPROFIT_REASON_CLASSES).toHaveLength(4);
  });
  test("every CREATE statement in the migration appears verbatim in the mirror", () => {
    const ddl = MIGRATION_045_SQL.split("\n").filter((line) => line.startsWith("CREATE "));
    expect(ddl.length).toBeGreaterThan(10);
    for (const statement of ddl) {
      // MIGRATION 046 SUPERSESSION (owner decision, 2026-09-21). The unconditional UNIQUE
      // index on `ein` is replaced by the PARTIAL one (`WHERE released_at IS NULL`) so an
      // EIN an administrator has released becomes claimable by a different applicant. That
      // single statement is the only 045 DDL the mirror no longer carries verbatim, and the
      // replacement keeps the SAME index name — so the per-EIN uniqueness assertion above
      // still holds in both files, and 046's own suite asserts the partial definition.
      if (statement.includes("nonprofit_applications_ein_key")) {
        expect(SCHEMA_SQL).toContain(
          "CREATE UNIQUE INDEX IF NOT EXISTS nonprofit_applications_ein_key ON nonprofit_applications (ein) WHERE released_at IS NULL",
        );
        continue;
      }
      expect(SCHEMA_SQL).toContain(statement);
    }
  });
});

// ── The owner's status-change rule (IMPLEMENTATION LOCK 2026-09-21) ────────────
/**
 * THE OWNER'S RULE, recorded verbatim (plan rev 267, implementation lock):
 *
 * "A status change detected by reverification suspends the free entitlement and opens a
 * review case — it never deletes the user's account, and saved data remains intact while
 * the organization's status is reviewed."
 *
 * The pass itself (nonprofit-reverify.server.ts) already routes a changed organization to
 * `manual_review` — that IS the review case. What this block pins is the other half of the
 * rule: that the suspension is NON-DESTRUCTIVE. Each test runs the REAL pass against an
 * injected store carrying the whole migration-045 picture for one organization — its
 * `nonprofit_applications` row, its `users` row and its `saved_grants` rows — and asserts
 * that after a refresh detects a changed status: the review case is open, the entitlement
 * is the suspended (pending) tier rather than a deletion or the anonymous tier, every row
 * of user data is byte-identical to what it was, and not one destructive statement was
 * issued. The store journals every statement it would have run, which is the spy behind
 * "no DELETE anywhere". ZERO network, ZERO database (the sandbox DATABASE_URL is prod).
 */
describe("the owner's status-change rule (IMPLEMENTATION LOCK 2026-09-21): suspend, never destroy", () => {
  /** The refresh whose posting date is the audit anchor for the suspension. */
  const REFRESH_POSTING_DATE = "2026-10-08";
  /** The moment the pass runs (injected clock — the audit record must be deterministic). */
  const REVIEWED_AT = "2026-10-12T12:00:00.000Z";

  interface LifecycleUserRow {
    id: number;
    email: string;
    created_at: string;
  }
  /** nonprofit_applications (migration 045) — only the columns this lifecycle moves. */
  interface LifecycleApplicationRow {
    user_id: number;
    org_name: string;
    work_email: string;
    ein: string;
    status: string;
    verification_method: string | null;
    decision: string | null;
    decision_reason: string | null;
    reason_class: string | null;
    decision_flags: string[];
    supporting_docs_requested: boolean;
    bmf_status: string | null;
    bmf_subsection: string | null;
    bmf_posting_date: string | null;
    on_revocation_list: boolean | null;
    review_notes: string | null;
    reviewed_at: string | null;
    evidence: Record<string, unknown>;
    granted_at: string | null;
    reverify_due_at: string | null;
    created_at: string;
    updated_at: string;
  }
  /** saved_grants (migration 045): `opportunity_id` is TEXT and the snapshot is kept. */
  interface LifecycleSavedGrantRow {
    id: number;
    user_id: number;
    opportunity_id: string;
    source: string;
    title: string;
    agency: string | null;
    status: string | null;
    closing_date: string | null;
    award_display: string | null;
    official_url: string | null;
    snapshot: Record<string, unknown>;
    created_at: string;
  }
  interface LifecycleDb {
    users: LifecycleUserRow[];
    applications: LifecycleApplicationRow[];
    savedGrants: LifecycleSavedGrantRow[];
    /** EVERY statement the fake issued — the spy behind "no delete anywhere". */
    journal: string[];
  }
  /** Deep copy, so a snapshot cannot be mutated by the code under test. */
  function lifecycleClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
  /** An organization that was AUTO-APPROVED before the refresh (the row the pass reads). */
  function lifecycleApprovedApplication(
    overrides: Partial<LifecycleApplicationRow> = {},
  ): LifecycleApplicationRow {
    return {
      user_id: 7,
      org_name: "Masonic Trustees of Portland",
      work_email: "grants@portland-lodge.example.org",
      ein: "010116380",
      status: "approved",
      verification_method: "irs_eo_bmf",
      decision: "auto_approve",
      decision_reason: "clear_match",
      reason_class: "clear-match",
      decision_flags: [],
      supporting_docs_requested: false,
      bmf_status: "01",
      bmf_subsection: "03",
      bmf_posting_date: "2026-09-08",
      on_revocation_list: false,
      review_notes: null,
      reviewed_at: null,
      evidence: {
        auto_approve: {
          engine: NONPROFIT_VERIFICATION_ENGINE,
          source: IRS_SOURCE_LABEL,
          posting_date: "2026-09-08",
        },
      },
      granted_at: "2026-09-21T00:00:00.000Z",
      reverify_due_at: "2027-09-21T00:00:00.000Z",
      created_at: "2026-09-21T00:00:00.000Z",
      updated_at: "2026-09-21T00:00:00.000Z",
      ...overrides,
    };
  }
  /** The org's `users` row — the account the owner's rule protects. */
  function lifecycleUser(id = 7, email = "grants@portland-lodge.example.org"): LifecycleUserRow {
    return { id, email, created_at: "2026-09-21T00:00:00.000Z" };
  }
  /** N = 3 saved grants, in the migration-045 shapes (federal, a state grant, one with no deadline). */
  function lifecycleSavedGrants(userId = 7): LifecycleSavedGrantRow[] {
    return [
      {
        id: 501,
        user_id: userId,
        opportunity_id: "360331",
        source: "grants_gov",
        title: "Rural Community Facilities Grant",
        agency: "USDA Rural Development",
        status: "posted",
        closing_date: "2026-11-05",
        award_display: "$150,000",
        official_url: "https://www.grants.gov/search-results-detail/360331",
        snapshot: { opportunityNumber: "USDA-RCF-2026", syncedAt: "2026-09-22T10:00:00.000Z" },
        created_at: "2026-09-22T10:00:00.000Z",
      },
      {
        id: 502,
        user_id: userId,
        opportunity_id: "ME-DHHS-CHEF-07",
        source: "state:ME",
        title: "Community Health Equity Fund",
        agency: "Maine Department of Health and Human Services",
        status: "posted",
        closing_date: "2026-12-01",
        award_display: "$75,000",
        official_url: "https://www.maine.gov/dhhs/grants/chef",
        snapshot: { state: "ME", jurisdiction: "ME" },
        created_at: "2026-09-22T10:05:00.000Z",
      },
      {
        id: 503,
        user_id: userId,
        opportunity_id: "345901",
        source: "grants_gov",
        title: "Youth Workforce Development Initiative",
        agency: "Department of Labor",
        status: "forecasted",
        closing_date: null,
        award_display: "Not disclosed",
        official_url: "https://www.grants.gov/search-results-detail/345901",
        snapshot: { opportunityNumber: "DOL-YWDI-2026" },
        created_at: "2026-09-22T10:09:00.000Z",
      },
    ];
  }
  /**
   * The injected store: the REAL fixtures for the IRS read side, plus an in-memory
   * application/users/saved_grants picture that journals every statement. `routeToReview`
   * performs the SAME guarded UPDATE the Neon store does (it is the stand-in for it), and
   * the store exposes no delete entry point of any kind — the pass literally cannot ask it
   * to destroy a row. The admin's re-approval writer is returned SEPARATELY (`admin`), so
   * the pass has no way to approve anything either.
   */
  function lifecycleStore(options: {
    applications: LifecycleApplicationRow[];
    users?: LifecycleUserRow[];
    savedGrants?: LifecycleSavedGrantRow[];
  }) {
    const db: LifecycleDb = {
      users: options.users ?? [],
      applications: options.applications,
      savedGrants: options.savedGrants ?? [],
      journal: [],
    };
    const fixtures = mirrorVerificationStore();
    const store: NonprofitReverifyStore = {
      mirror: {
        async findBmfByEin(ein) {
          db.journal.push(`SELECT irs_eo_bmf ein=${ein}`);
          return fixtures.findBmfByEin(ein);
        },
        async findPub78ByEin(ein) {
          db.journal.push(`SELECT irs_pub78 ein=${ein}`);
          return fixtures.findPub78ByEin(ein);
        },
        async findRevocationsByEin(ein) {
          db.journal.push(`SELECT irs_revocations ein=${ein}`);
          return fixtures.findRevocationsByEin(ein);
        },
        async bmfPostingDate() {
          return fixtures.bmfPostingDate();
        },
      },
      async listApprovedApplications() {
        db.journal.push("SELECT nonprofit_applications WHERE status = 'approved'");
        return db.applications
          .filter((application) => application.status === "approved")
          .map((application) => ({
            user_id: application.user_id,
            ein: application.ein,
            org_name: application.org_name,
            bmf_status: application.bmf_status,
            bmf_subsection: application.bmf_subsection,
            bmf_posting_date: application.bmf_posting_date,
            on_revocation_list: application.on_revocation_list,
          }));
      },
      async routeToReview(route) {
        const row = db.applications.find(
          (application) =>
            application.user_id === route.application.user_id && application.status === "approved",
        );
        if (!row) {
          db.journal.push(
            `UPDATE nonprofit_applications SKIPPED (not approved) user_id=${route.application.user_id}`,
          );
          return false;
        }
        db.journal.push(
          `UPDATE nonprofit_applications SET status = 'manual_review' WHERE user_id = ${row.user_id} AND status = 'approved'`,
        );
        row.status = "manual_review";
        row.decision = "manual_review";
        row.decision_reason = route.reason;
        row.reason_class = NONPROFIT_REVERIFY_REASON_CLASS;
        row.supporting_docs_requested = false;
        row.decision_flags = [...row.decision_flags, NONPROFIT_REVERIFY_FLAG, route.reason];
        row.bmf_status = route.current.bmfStatus;
        row.bmf_subsection = route.current.bmfSubsection;
        row.bmf_posting_date = route.current.bmfPostingDate;
        row.on_revocation_list = route.current.onRevocationList;
        row.review_notes = route.message;
        // MERGE, exactly like the Neon store: the original approval record must survive.
        row.evidence = { ...row.evidence, ...route.evidence };
        row.updated_at = REVIEWED_AT;
        return true;
      },
    };
    /**
     * Phase 2's review-queue writer, modelled so the "data survives the whole review" half
     * of the owner's rule is testable. Guarded on `status = 'manual_review'`, so it can
     * neither double-write nor touch a row that is not under review.
     */
    const admin = {
      async approveAfterReview(userId: number): Promise<boolean> {
        const row = db.applications.find(
          (application) =>
            application.user_id === userId && application.status === "manual_review",
        );
        if (!row) return false;
        db.journal.push(
          `UPDATE nonprofit_applications SET status = 'approved' WHERE user_id = ${userId} AND status = 'manual_review'`,
        );
        row.status = "approved";
        row.verification_method = "manual_exception";
        row.review_notes = "Reviewed after the IRS refresh: status confirmed, free access restored.";
        row.reviewed_at = REVIEWED_AT;
        row.evidence = {
          ...row.evidence,
          manual_review_approval: {
            reviewed_by: "agent-lead",
            reviewed_at: REVIEWED_AT,
            posting_date: REFRESH_POSTING_DATE,
          },
        };
        row.updated_at = REVIEWED_AT;
        return true;
      },
    };
    return { db, store, admin };
  }
  /** Run the REAL pass over that store, for one organization whose status changed. */
  async function runSuspension() {
    const application = lifecycleApprovedApplication();
    const savedGrants = lifecycleSavedGrants(application.user_id);
    const users = [lifecycleUser(application.user_id, application.work_email)];
    const lifecycle = lifecycleStore({ applications: [application], users, savedGrants });
    const summary = await runNonprofitPostRefreshReverify(
      { postingDate: REFRESH_POSTING_DATE, now: new Date(REVIEWED_AT) },
      lifecycle.store,
    );
    return { ...lifecycle, summary };
  }

  test("a refresh-detected status change opens the review case, deletes nothing, and leaves every saved grant intact", async () => {
    const application = lifecycleApprovedApplication();
    const savedGrants = lifecycleSavedGrants(application.user_id);
    const users = [lifecycleUser(application.user_id, application.work_email)];
    const { db, store } = lifecycleStore({ applications: [application], users, savedGrants });
    const before = {
      users: lifecycleClone(db.users),
      savedGrants: lifecycleClone(db.savedGrants),
    };
    const summary = await runNonprofitPostRefreshReverify(
      { postingDate: REFRESH_POSTING_DATE, now: new Date(REVIEWED_AT) },
      store,
    );

    // (a) THE REVIEW CASE IS OPEN — `manual_review`, never revoked/denied/deleted — and the
    // audit record NAMES the refresh that caused it.
    const row = db.applications[0];
    expect(summary).toMatchObject({
      postingDate: REFRESH_POSTING_DATE,
      checked: 1,
      routed: 1,
      kept: 0,
      skipped: 0,
      failures: [],
    });
    expect(row.status).toBe("manual_review");
    expect(row.decision).toBe("manual_review");
    expect(row.decision_reason).toBe("refresh_revoked");
    expect(row.reason_class).toBe("possible-match");
    expect(row.supporting_docs_requested).toBe(false);
    expect(row.decision_flags).toContain(NONPROFIT_REVERIFY_FLAG);
    expect(row.review_notes).toContain("automatic-revocation list");
    expect(row.evidence.refresh_reverify).toMatchObject({
      trigger: "post_refresh_reverify",
      reason: "refresh_revoked",
      reason_class: "possible-match",
      posting_date: REFRESH_POSTING_DATE,
      checked_at: REVIEWED_AT,
    });
    // The ORIGINAL auto-approve record is still on the row: a review is a new chapter, not
    // a rewrite of the history (the evidence payload is MERGED, never replaced).
    expect(row.evidence.auto_approve).toEqual({
      engine: NONPROFIT_VERIFICATION_ENGINE,
      source: IRS_SOURCE_LABEL,
      posting_date: "2026-09-08",
    });

    // (b) EVERY saved grant survives: same count, same content, same ids and timestamps.
    expect(db.savedGrants).toHaveLength(3);
    expect(db.savedGrants).toEqual(before.savedGrants);
    expect(db.savedGrants.map((grant) => grant.id)).toEqual([501, 502, 503]);
    expect(db.savedGrants.map((grant) => grant.opportunity_id)).toEqual([
      "360331",
      "ME-DHHS-CHEF-07",
      "345901",
    ]);

    // (c) The account itself is still there, unchanged.
    expect(db.users).toEqual(before.users);
    expect(db.applications).toHaveLength(1);

    // (d) NOT ONE destructive statement was issued. The fake journals every statement it
    // would have run: the whole journal is the pass's reads plus one guarded UPDATE.
    expect(db.journal.filter((entry) => /DELETE|TRUNCATE|DROP/i.test(entry))).toEqual([]);
    expect(db.journal.filter((entry) => /users|saved_grants/.test(entry))).toEqual([]);
    expect(db.journal.filter((entry) => entry.startsWith("UPDATE"))).toEqual([
      "UPDATE nonprofit_applications SET status = 'manual_review' WHERE user_id = 7 AND status = 'approved'",
    ]);
    expect([...db.journal].sort()).toEqual(
      [
        "SELECT irs_eo_bmf ein=010116380",
        "SELECT irs_revocations ein=010116380",
        "SELECT nonprofit_applications WHERE status = 'approved'",
        "UPDATE nonprofit_applications SET status = 'manual_review' WHERE user_id = 7 AND status = 'approved'",
      ].sort(),
    );

    // ...and the pass's ENTIRE store surface is three methods, none of them a delete.
    expect(Object.keys(store).sort()).toEqual([
      "listApprovedApplications",
      "mirror",
      "routeToReview",
    ]);
  });

  test("after the suspension the free entitlement is SUSPENDED — pending tier, not anonymous, not deleted", async () => {
    const { db, summary } = await runSuspension();
    expect(summary.routed).toBe(1);
    // The row the entitlement is read from: suspended, and still there.
    const application = db.applications[0];
    const entitlement = evaluateNonprofitEntitlement(application, new Date("2026-10-12T00:00:00Z"));
    expect(entitlement.verified).toBe(false);
    expect(entitlement.status).toBe("manual_review");

    const policy = nonprofitSearchPolicy(entitlement);
    // 1) The suspension is the PENDING tier — limited access, not a cut to nothing.
    expect(policy.tier).toBe("nonprofit_pending");
    expect(policy).toEqual(NONPROFIT_PENDING_SEARCH_POLICY);
    expect(policy.searchesPerDay).toBe(3);
    expect(policy.fullDetailsPerDay).toBe(5);
    expect(policy.previewLimit).toBe(5);
    // 2) NOT the anonymous tier: an org under review still gets more than a stranger.
    expect(policy.tier).not.toBe("anonymous");
    expect(NONPROFIT_ANONYMOUS_SEARCH_POLICY.searchesPerDay).toBe(1);
    expect(policy.searchesPerDay).not.toBe(NONPROFIT_ANONYMOUS_SEARCH_POLICY.searchesPerDay);
    // 3) NOT the revoked/denied lane either: a refresh-detected change is never an
    // automatic revocation (that is a human act — the plan's "owner's right to revoke").
    expect(entitlement.status).not.toBe("revoked");
    // 4) The VERIFIED perks are off — that IS the suspension: no saved-grant writes, no
    // weekly digest, no basic filters, and the day's allowance is finite again.
    expect(policy.canSave).toBe(false);
    expect(policy.saveLimit).toBe(0);
    expect(policy.weeklyDeadlineEmail).toBe(false);
    expect(policy.basicFilters).toBe(false);
    expect(nonprofitSearchAllowance(policy, 3)).toEqual({ allowed: false, remaining: 0 });
    // 5) The staleness claim is withdrawn while the org is under review (it is no longer
    // "verified") — suspension is visible, and honest.
    expect(entitlement.verificationWording).toBeNull();

    // 6) And the guarantee a policy object cannot express lives on the ROWS: suspension is
    // a status, never a deletion. Account, saved data and the review case all still exist.
    expect(db.applications).toHaveLength(1);
    expect(db.users).toHaveLength(1);
    expect(db.users[0].email).toBe("grants@portland-lodge.example.org");
    expect(db.savedGrants).toHaveLength(3);
    expect(db.journal.filter((entry) => /DELETE|TRUNCATE|DROP/i.test(entry))).toEqual([]);
  });

  test("an unchanged organization keeps its approved row AND its saved grants — the pass writes nothing", async () => {
    const changed = lifecycleApprovedApplication();
    const unchanged = lifecycleApprovedApplication({
      user_id: 11,
      org_name: "Maine Association of Nonprofits",
      work_email: "hello@mainenonprofits.example.org",
      ein: "010488538",
      updated_at: "2026-09-22T09:00:00.000Z",
    });
    const savedGrants = [
      ...lifecycleSavedGrants(7),
      ...lifecycleSavedGrants(11).map((grant) => ({ ...grant, id: grant.id + 100 })),
    ];
    const users = [lifecycleUser(7), lifecycleUser(11, "hello@mainenonprofits.example.org")];
    const { db, store } = lifecycleStore({ applications: [changed, unchanged], users, savedGrants });
    const before = {
      users: lifecycleClone(db.users),
      savedGrants: lifecycleClone(db.savedGrants),
      unchangedApplication: lifecycleClone(unchanged),
    };
    const summary = await runNonprofitPostRefreshReverify(
      { postingDate: REFRESH_POSTING_DATE },
      store,
    );
    expect(summary).toMatchObject({ checked: 2, routed: 1, kept: 1, failures: [] });
    expect(summary.entries).toEqual([
      { user_id: 7, ein: "010116380", action: "route_to_review", reason: "refresh_revoked" },
      { user_id: 11, ein: "010488538", action: "keep", reason: null },
    ]);
    // The unchanged org's application row is COMPLETELY untouched — updated_at has not
    // moved, so there is no tuple rewrite and no churn (the zero-writes rule, now carried
    // across the whole lifecycle picture instead of the application row alone).
    expect(db.applications.find((application) => application.user_id === 11)).toEqual(
      before.unchangedApplication,
    );
    // Every saved grant of BOTH organizations is untouched — the pass has no business in
    // `saved_grants` for any org, changed or unchanged: the changed org's saves survive the
    // suspension, and the unchanged org's are never even looked at.
    expect(db.savedGrants).toEqual(before.savedGrants);
    expect(db.savedGrants).toHaveLength(6);
    expect(db.users).toEqual(before.users);
    expect(db.journal.filter((entry) => entry.startsWith("UPDATE"))).toEqual([
      "UPDATE nonprofit_applications SET status = 'manual_review' WHERE user_id = 7 AND status = 'approved'",
    ]);
    expect(db.journal.filter((entry) => /saved_grants/.test(entry))).toEqual([]);
  });

  test("a later re-approval restores the free entitlement with the SAME saved data — the review lifecycle is data-safe end to end", async () => {
    const { db, admin } = await runSuspension();
    const savedBeforeReview = lifecycleClone(db.savedGrants);
    const usersBeforeReview = lifecycleClone(db.users);
    expect(db.applications[0].status).toBe("manual_review");
    // While the status is being reviewed the org keeps the pending tier (never a delete).
    expect(nonprofitSearchPolicy(evaluateNonprofitEntitlement(db.applications[0])).tier).toBe(
      "nonprofit_pending",
    );

    // The human re-approves (phase 2's queue writer; guarded on status = 'manual_review').
    const reviewedAt = new Date("2026-10-14T00:00:00.000Z");
    expect(await admin.approveAfterReview(7)).toBe(true);
    expect(db.applications[0].status).toBe("approved");

    // The entitlement is fully restored...
    const entitlement = evaluateNonprofitEntitlement(db.applications[0], reviewedAt);
    expect(entitlement.verified).toBe(true);
    expect(entitlement.status).toBe("approved");
    expect(nonprofitSearchPolicy(entitlement)).toEqual(NONPROFIT_FREE_SEARCH_POLICY);
    expect(nonprofitSearchPolicy(entitlement).tier).toBe("nonprofit_free");
    expect(nonprofitSearchPolicy(entitlement).canSave).toBe(true);
    expect(nonprofitSearchPolicy(entitlement).saveLimit).toBe(NONPROFIT_SAVE_LIMIT);

    // ...and the data it was suspended with is byte-identical: NOTHING was lost while the
    // organization's status was under review.
    expect(db.savedGrants).toEqual(savedBeforeReview);
    expect(db.savedGrants.map((grant) => grant.id)).toEqual([501, 502, 503]);
    expect(db.savedGrants.map((grant) => grant.created_at)).toEqual([
      "2026-09-22T10:00:00.000Z",
      "2026-09-22T10:05:00.000Z",
      "2026-09-22T10:09:00.000Z",
    ]);
    expect(db.users).toEqual(usersBeforeReview);

    // The whole audit trail survives too: the original approval, the refresh-driven review
    // and the review's outcome.
    expect(Object.keys(db.applications[0].evidence).sort()).toEqual([
      "auto_approve",
      "manual_review_approval",
      "refresh_reverify",
    ]);
    // The guarded UPDATE cannot double-write, nor touch a row that is not under review.
    expect(await admin.approveAfterReview(7)).toBe(false);
    expect(await admin.approveAfterReview(999)).toBe(false);
    expect(db.journal.filter((entry) => /DELETE|TRUNCATE/i.test(entry))).toEqual([]);
  });

  // ── The static half: the PRODUCTION path has no destructive statement at all ──
  const REVERIFY_SOURCE = readFileSync(
    new URL("./nonprofit-reverify.server.ts", import.meta.url),
    "utf8",
  );
  test("the production status-change path issues exactly two statements, both on nonprofit_applications, and no DELETE", () => {
    // Every statement the module issues, straight out of the source that ships.
    const statements = [...REVERIFY_SOURCE.matchAll(/sql\(\)`([\s\S]*?)`/g)].map(
      (match) => match[1],
    );
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement).toContain("nonprofit_applications");
      expect(statement).not.toMatch(/saved_grants/);
      expect(statement).not.toMatch(/\busers\b/);
      expect(statement).not.toMatch(/\b(DELETE|TRUNCATE|DROP)\b/);
      expect(statement).not.toMatch(/CASCADE/i);
      expect(statement).not.toMatch(/\b(INSERT|ALTER)\b/);
    }
    // Exactly ONE of them writes, it moves the row to the review case, and it is guarded on
    // the previous state so a human decision made concurrently is never overwritten.
    const writes = statements.filter((statement) => /\bUPDATE\b/.test(statement));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("SET status = 'manual_review'");
    expect(writes[0]).toContain("AND status = 'approved'");
    // The pass's store contract has three methods — none of them can destroy a row.
    const shape = REVERIFY_SOURCE.match(/export interface NonprofitReverifyStore \{([\s\S]*?)\n\}/);
    expect(shape).not.toBeNull();
    expect(shape?.[1]).toContain("listApprovedApplications");
    expect(shape?.[1]).toContain("routeToReview");
    expect(shape?.[1]).not.toMatch(/delete|truncate|purge/i);
  });

  test("the owner's rule is recorded verbatim where the pass is defined, and manual_review → pending IS the suspension", () => {
    // The doc block the owner's implementation lock requires, on the module that runs the
    // pass (whitespace/comment-prefix normalised, so a re-wrap does not hide it).
    const prose = REVERIFY_SOURCE.replace(/^[ \t]*\*[ \t]?/gm, " ").replace(/\s+/g, " ");
    expect(prose).toContain(
      "A status change detected by reverification suspends the free entitlement and opens a review case — " +
        "it never deletes the user's account, and saved data remains intact while the organization's status is reviewed " +
        "(owner 09-21, implementation lock).",
    );
    // The entitlement mapping that IS the suspension: `manual_review` gets the PENDING tier.
    // A future edit that quietly rerouted under-review orgs to `anonymous` (or to nothing)
    // would fail here.
    const server = readFileSync(new URL("./nonprofit.server.ts", import.meta.url), "utf8");
    const branch = server.match(
      /if \(entitlement\.status === "pending" \|\| entitlement\.status === "manual_review"\) \{([\s\S]*?)\}/,
    );
    expect(branch).not.toBeNull();
    expect(branch?.[1]).toContain("return NONPROFIT_PENDING_SEARCH_POLICY;");
  });
});
