/**
 * Nonprofit Free — the IRS EIN + legal-name verification engine.
 *
 * IMPLEMENTS, EXACTLY: /home/team/shared/nonprofit-free-teos-research-2026-09-21.md
 *   §2.1 EIN normalisation      → normalizeEin()
 *   §2.2 legal-name normalisation → normalizeOrgName()
 *   §2.3 match tiers A/B/C       → compareLegalNames()
 *   §2.4 revocation handling     → the revoked_* branches of the decision table
 *   §2.5 decision table (rows 1-7) → decideNonprofitVerification()
 *   §3   refresh strategy        → the read side is a LOCAL DB lookup, never a call to
 *        irs.gov (the importer in irs-mirror.server.ts is what talks to the network)
 *
 * WHY THE THREE-SIGNAL RULE. Presence in the BMF alone is NOT verification: 159,713
 * auto-revoked EINs are still in the BMF (99.96 % of them with STATUS '01'). So the
 * ONLY auto-approve branch requires all three — the EIN is in the mirror, the submitted
 * legal name corresponds, and the EIN is not on the auto-revocation list.
 *
 * NOTHING HERE IS EVER AN AUTO-REJECT. EIN-not-found (newly approved orgs, churches
 * exempt under IRC 508(c)(1)(A), government entities, fiscal-sponsorship projects,
 * group-exemption subordinates whose own row is missing), a name mismatch (DBA/trade
 * names are absent from the IRS file BY DESIGN — the IRS says so on its own page) and a
 * non-01/02 STATUS all route to MANUAL REVIEW. The only "go away and fix it" outcome is
 * a malformed EIN, which is form validation, not a verdict.
 *
 * The engine is pure apart from one injected store: `bun test` proves every branch with
 * an in-memory fake and no database.
 */
import { sql } from "~/db";
import {
  NONPROFIT_SUBSECTION_POLICY,
  NONPROFIT_501C3_SUBSECTION,
  isEligibleSubsection,
  type NonprofitReasonClass,
  type NonprofitStatus,
  type NonprofitSubsectionPolicy,
  type NonprofitVerificationMethod,
} from "~/lib/nonprofit.server";

// ── Source labelling (research §1.b: never say "the IRS TEOS website") ────────
/**
 * The honest product-facing name of the source. The TEOS *web app* is WAF-blocked and
 * has no public API; we mirror the SAME records from the official bulk extracts, so
 * the copy says "IRS tax-exempt records (EO BMF)".
 */
export const IRS_SOURCE_LABEL = "IRS tax-exempt records (EO BMF)";
/** The engine identity recorded on every decision (`evidence.engine`). */
export const NONPROFIT_VERIFICATION_ENGINE = "irs_eo_bmf_v1";

// ── §2.1 EIN normalisation ────────────────────────────────────────────────────
export const EIN_DIGITS = 9;
export type EinNormalization =
  | { ok: true; ein: string }
  | { ok: false; reason: "missing" | "format" | "bogus_pattern"; message: string };

/**
 * `14-2007220` / `14 2007220` → `142007220`; zero-pad to EXACTLY 9 characters as a
 * STRING (3.0 % of the 1,964,958 real EINs begin with `0` — `010488538`, the Maine
 * Association of Nonprofits, is one of them, and 59,076 rows in total).
 *
 * A numeric input is refused rather than padded: a number that has already travelled
 * through JSON/ProPublica has silently lost its leading zero, and padding 10488538 to
 * 010488538 would be a GUESS about which org the applicant means. The form must submit
 * text; the reviewer never sees a fabricated EIN.
 *
 * Known-bogus patterns: a repeated digit (000000000 … 999999999) and the sequential
 * 123456789 — the values people type when testing a form. NOT bogus: a leading `00`
 * (000003154 is a real revoked EIN in our own fixture). All of these are FORM errors
 * (research §2.5 row 7), never a review and never a rejection.
 */
export function normalizeEin(raw: string | number | null | undefined): EinNormalization {
  if (raw == null) {
    return { ok: false, reason: "missing", message: "Enter the organization's 9-digit EIN." };
  }
  if (typeof raw === "number") {
    return {
      ok: false,
      reason: "format",
      message:
        "The EIN must be submitted as text with its leading zeros — a number has already lost them.",
    };
  }
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length !== EIN_DIGITS) {
    return {
      ok: false,
      reason: "format",
      message: "An EIN is exactly 9 digits, e.g. 14-2007220.",
    };
  }
  if (/^(\d)\1{8}$/.test(digits) || digits === "123456789") {
    return {
      ok: false,
      reason: "bogus_pattern",
      message: "That does not look like a real EIN — check the 9 digits and try again.",
    };
  }
  return { ok: true, ein: digits.padStart(EIN_DIGITS, "0") };
}

// ── §2.2 legal-name normalisation ────────────────────────────────────────────
/**
 * Entity-form tokens neutralised for COMPARISON only (never for display). Stored
 * exactly as the research lists them.
 *
 * `NON-PROFIT` is kept in the list for completeness even though step 4 has already
 * replaced the hyphen with a space, so it can never match a token. That is deliberate
 * and load-bearing: the research's own worked example — `MAINE ASSOCIATION OF
 * Non-ProfitS` → `MAINE ASSOCIATION OF NON PROFITS` → **Tier C, manual review** — only
 * comes out that way because the hyphenated spelling is NOT neutralised.
 */
export const ORG_NAME_ENTITY_TOKENS: readonly string[] = [
  "INC",
  "INCORPORATED",
  "CORP",
  "CORPORATION",
  "CO",
  "COMPANY",
  "LTD",
  "LIMITED",
  "LLC",
  "LLP",
  "PC",
  "PA",
  "PLLC",
  "NONPROFIT",
  "NON-PROFIT",
  "INTEGRATED",
];
/** The highest-frequency abbreviations (§2.2 step 8). VFW / PTA / PTO are left as-is. */
export const ORG_NAME_ABBREVIATIONS: Readonly<Record<string, string>> = {
  ASSN: "ASSOCIATION",
  ASSOC: "ASSOCIATION",
  DEPT: "DEPARTMENT",
  CTR: "CENTER",
  MTG: "MEETING",
  SOC: "SOCIETY",
  FNDN: "FOUNDATION",
  FDN: "FOUNDATION",
};
export interface NormalizedOrgName {
  /** The applicant-facing input, untouched. */
  input: string;
  /** The comparison string: NFKD, upper, `&`→AND, punctuation→space, THE/entity tokens dropped. */
  normalized: string;
  /** The tokens of `normalized`, in order. */
  tokens: string[];
  /** The token MULTISET (§2.2 step 9): token → count, so "A A B" ≠ "A B". */
  multiset: Record<string, number>;
}
/**
 * Applied identically to the SUBMITTED name and to the BMF `NAME` — that symmetry is
 * what makes the comparison meaningful.
 *
 * Deliberate conservatism: no stemming, no fuzzy matching, no edit distance. Any
 * character that is not A-Z/0-9 AFTER NFKD becomes a separator, which can only make a
 * match HARDER (a name containing `Ø` or `Ł`, which do not decompose, loses that letter
 * → falls to Tier C → manual review). Failing toward a human is the right direction:
 * the owner's rules are "never auto-reject" and "never trust the domain alone".
 */
export function normalizeOrgName(raw: string | null | undefined): NormalizedOrgName {
  const input = String(raw ?? "");
  const folded = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let tokens = folded.length > 0 ? folded.split(" ") : [];
  // §2.2 step 6 — a LEADING article only ("THE ARTS COUNCIL OF THE SOUTH" keeps its second THE).
  if (tokens[0] === "THE") tokens = tokens.slice(1);
  // §2.2 steps 7 + 8. The two steps commute for these lists (no abbreviation maps onto
  // an entity token), so the order below is the research's own order.
  const entityTokens = new Set(ORG_NAME_ENTITY_TOKENS);
  const multiset: Record<string, number> = {};
  const kept: string[] = [];
  for (const token of tokens) {
    if (entityTokens.has(token)) continue;
    const canonical = ORG_NAME_ABBREVIATIONS[token] ?? token;
    kept.push(canonical);
    multiset[canonical] = (multiset[canonical] ?? 0) + 1;
  }
  return { input, normalized: kept.join(" "), tokens: kept, multiset };
}

// ── §2.3 match tiers ─────────────────────────────────────────────────────────
export type NameTier = "A" | "B" | "C";
/** Tier B's correspondence threshold (§2.3). */
export const TIER_B_JACCARD_MIN = 0.9;
export type NameMatchReason =
  | "exact"
  | "token_multiset"
  | "contains_jaccard"
  | "no_correspondence"
  | "empty_name";
export interface NameComparison {
  tier: NameTier;
  submitted: NormalizedOrgName;
  submittedNormalized: string;
  /** The candidate (BMF NAME or SORT_NAME) that produced the best tier, verbatim. */
  matchedName: string | null;
  matchedNormalized: string | null;
  /** Token-set Jaccard against the best candidate, for the reviewer's eye. */
  jaccard: number | null;
  reason: NameMatchReason;
}
/** Token-SET Jaccard (sets, not multisets — the contains test uses sets, §2.3). */
export function jaccard(setA: Iterable<string>, setB: Iterable<string>): number {
  const a = new Set(setA);
  const b = new Set(setB);
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
/** Token MULTISET equality: order-insensitive, count-sensitive. */
export function multisetEquals(a: NormalizedOrgName, b: NormalizedOrgName): boolean {
  const keysA = Object.keys(a.multiset);
  const keysB = Object.keys(b.multiset);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a.multiset[key] === b.multiset[key]);
}
/**
 * The name criterion, against every name the BMF row offers (its `NAME` and, when
 * present, the `SORT_NAME` "secondary name line"). Tier A wins outright; otherwise the
 * best Tier B is kept; anything else is Tier C.
 */
export function compareLegalNames(
  submittedRaw: string | null | undefined,
  candidates: readonly (string | null | undefined)[],
): NameComparison {
  const submitted = normalizeOrgName(submittedRaw);
  const base: NameComparison = {
    tier: "C",
    submitted,
    submittedNormalized: submitted.normalized,
    matchedName: null,
    matchedNormalized: null,
    jaccard: null,
    reason: "empty_name",
  };
  if (submitted.normalized.length === 0) return base;
  let best: NameComparison | null = null;
  let bestJaccard = -1;
  for (const candidateRaw of candidates) {
    const candidate = normalizeOrgName(candidateRaw);
    if (candidate.normalized.length === 0) continue;
    const score = jaccard(submitted.tokens, candidate.tokens);
    if (submitted.normalized === candidate.normalized) {
      return {
        tier: "A",
        submitted,
        submittedNormalized: submitted.normalized,
        matchedName: String(candidateRaw),
        matchedNormalized: candidate.normalized,
        jaccard: score,
        reason: "exact",
      };
    }
    const multisetMatch = multisetEquals(submitted, candidate);
    const contains =
      submitted.normalized.includes(candidate.normalized) ||
      candidate.normalized.includes(submitted.normalized);
    if (multisetMatch || (contains && score >= TIER_B_JACCARD_MIN)) {
      const candidateResult: NameComparison = {
        tier: "B",
        submitted,
        submittedNormalized: submitted.normalized,
        matchedName: String(candidateRaw),
        matchedNormalized: candidate.normalized,
        jaccard: score,
        reason: multisetMatch ? "token_multiset" : "contains_jaccard",
      };
      if (!best || best.tier === "C") best = candidateResult;
      continue;
    }
    if (!best && score > bestJaccard) {
      bestJaccard = score;
      best = {
        ...base,
        matchedName: String(candidateRaw),
        matchedNormalized: candidate.normalized,
        jaccard: score,
        reason: "no_correspondence",
      };
    }
  }
  return best ?? base;
}

// ── Domain corroboration (§2.3, additional accept-signal) ────────────────────
/**
 * "the submitted website/email domain contains the normalised root name". Used ONLY to
 * turn a Tier-C manual review's recommendation favourable — NEVER to auto-approve. This
 * is the owner's "never trust the domain alone" rule, encoded.
 */
export function domainCorrespondsToName(
  websiteOrEmail: string | null | undefined,
  normalizedName: string,
): boolean {
  if (!websiteOrEmail) return false;
  const host = String(websiteOrEmail)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .split("@")
    .pop();
  if (!host) return false;
  const labels = host.split(".").filter((label) => label.length > 0);
  if (labels.length === 0) return false;
  // Drop the public suffix labels; keep the registrable-ish remainder.
  const suffix = new Set(["com", "org", "net", "edu", "gov", "us", "info", "io", "co", "biz"]);
  const root = labels.filter((label) => !suffix.has(label)).join("");
  // Both sides are compared case-insensitively: the host is lower-cased above and the
  // normalised name is upper-cased by normalizeOrgName().
  const nameLetters = normalizedName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (root.length < 4 || nameLetters.length < 4) return false;
  return (
    nameLetters.includes(root) ||
    root.includes(nameLetters) ||
    (root.length >= 6 && nameLetters.slice(0, 6) === root.slice(0, 6))
  );
}

// ── §2.4 / §2.5 the decision table ───────────────────────────────────────────
/** The ONLY BMF STATUS codes that can auto-approve (research §1.a, §2.4). */
export const BMF_STATUS_AUTO_APPROVE: readonly string[] = ["01", "02"];
/**
 * Official meanings, read out of the IRS information sheet (`eo-info.pdf`). NOTE: the
 * `25` cell is truncated in our text extract (research §5) — the builder must confirm
 * its full wording against the source PDF before any copy publishes it.
 */
export const BMF_STATUS_MEANINGS: Readonly<Record<string, string>> = {
  "01": "Unconditional Exemption",
  "02": "Conditional Exemption",
  "12": "Trust described in section 4947(a)(2) of the Internal Revenue Code",
  "25": "Organization terminated (wording pending confirmation against eo-info.pdf)",
};
export function bmfStatusMeaning(status: string | null | undefined): string | null {
  if (!status) return null;
  return BMF_STATUS_MEANINGS[status] ?? status;
}
/** A BMF `GROUP` value other than 0000 means "subordinate under a group exemption". */
export function isGroupExemptionSubordinate(groupNo: string | null | undefined): boolean {
  if (groupNo == null) return false;
  return /[1-9]/.test(String(groupNo));
}
export type NonprofitDecision =
  | "auto_approve"
  | "manual_review"
  | "deny"
  | "reentry_required";
/** Machine-readable reason codes; the number in the comment is the §2.5 table row. */
export type NonprofitDecisionReason =
  | "ein_format" // 7
  | "ein_not_found" // 6
  | "name_mismatch" // 5
  | "revoked_reinstated_looking" // 2
  | "revoked_no_reinstatement" // 3
  | "status_not_active" // 4
  | "subsection_not_501c3" // owner decision (a), if narrowed
  | "auto_approved" // 1
  | "fraud_conflict" // owner spec item 3: obvious fraud/conflicting info → DENY
  | "ein_conflict_different_org" // one EIN, two different org names → DENY
  | "ein_already_claimed" // one free account per EIN (never a silent second account)
  | "mirror_lookup_failed"; // fail-closed: unknown state is never an approval

/**
 * THE OWNER'S REASON CLASS, for every decision (spec item 3). This map is deliberately
 * total over `NonprofitDecisionReason`, so a new reason cannot be added without deciding
 * which class the admin queue files it under. `null` exists for exactly ONE reason:
 * `ein_format` is form validation, not a verification verdict — nothing has been decided,
 * so there is no class to file.
 */
const REASON_CLASS_BY_REASON: Readonly<Record<NonprofitDecisionReason, NonprofitReasonClass | null>> = {
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
};
export function reasonClassFor(reason: NonprofitDecisionReason): NonprofitReasonClass | null {
  return REASON_CLASS_BY_REASON[reason];
}

/**
 * THE DENY LANE (owner spec item 3: "obvious fraud/conflicting info → deny"). This is the
 * only automatic path that ends without a human, so it may fire ONLY on a conflict that
 * is definite. Anything merely unclear belongs in `manual_review` — never here.
 */
export type NonprofitConflictKind =
  | "ein_claimed_by_different_org" // two different organisations claiming one EIN
  | "identity_contradicts_application" // the submitted identity contradicts itself
  | "impersonation_reported"; // the organisation says nobody there applied
/** The one place the owner's flag wording for the deny lane lives. */
export const NONPROFIT_CONFLICT_FLAGS: Readonly<Record<NonprofitConflictKind, string>> = {
  ein_claimed_by_different_org: "ein_claimed_by_different_org",
  identity_contradicts_application: "identity_contradicts_application",
  impersonation_reported: "impersonation_reported",
};
/** The account that already holds an EIN, as the apply route found it. */
export interface NonprofitEinClaimSignal {
  /** The user that holds the EIN. Equal to `applicantUserId` ⇒ a re-apply, NOT a conflict. */
  userId?: number | null;
  /** The legal name on the account that holds the EIN. */
  orgName?: string | null;
  status?: string | null;
}

export interface BmfIdentity {
  ein: string;
  name: string;
  sort_name?: string | null;
  state?: string | null;
  subsection?: string | null;
  status?: string | null;
  group_no?: string | null;
  ruling_year?: string | null;
  ntee?: string | null;
  posting_date?: string | null;
}
export interface Pub78Identity {
  ein: string;
  deductibility_code?: string | null;
  posting_date?: string | null;
}
export interface RevocationIdentity {
  ein: string;
  revocation_date?: string | null;
  revocation_posting_date?: string | null;
  reinstatement_date?: string | null;
}
export interface NonprofitVerificationSignals {
  /** "bad" is the §2.5 row-7 form error. */
  einFormat: "ok" | "bad";
  ein: string | null;
  einFound: boolean;
  nameTier: NameTier | null;
  submittedNameNormalized: string | null;
  matchedBmfName: string | null;
  bmfStatus: string | null;
  bmfSubsection: string | null;
  bmfGroupNo: string | null;
  bmfPostingDate: string | null;
  onRevocationList: boolean;
  inPub78: boolean;
  pub78DeductibilityCode: string | null;
  revocationDate: string | null;
  revocationPostingDate: string | null;
  reinstatementDate: string | null;
}
export interface NonprofitVerificationOutcome {
  decision: NonprofitDecision;
  /** The value the application row's `status` takes (migration 045 CHECK list). */
  status: NonprofitStatus;
  method: NonprofitVerificationMethod | null;
  reason: NonprofitDecisionReason;
  /**
   * The owner's four-class taxonomy for this decision (spec item 3), written to
   * `nonprofit_applications.reason_class` so the admin queue filters on one column.
   * `null` ONLY for `reentry_required` — a malformed EIN is form validation, not a
   * verification verdict, so no class is filed.
   */
  reasonClass: NonprofitReasonClass | null;
  /** What the reviewer is being asked to conclude (manual branches only). */
  recommendation: "approve" | "decline" | null;
  /**
   * The owner's "no match → request supporting documentation" action (spec item 3). TRUE
   * on the EIN-not-found branch, whose first queue action is the docs request; every other
   * branch is FALSE, and NO IRS letter is ever required unless the automatic check failed.
   */
  supportingDocsRequested: boolean;
  flags: string[];
  signals: NonprofitVerificationSignals;
  /** Written to `nonprofit_applications.evidence` (jsonb). */
  evidence: Record<string, unknown>;
}
export interface DecideNonprofitVerificationInput extends Partial<NonprofitVerificationSignals> {
  /** Owner decision (a). Defaults to the shipped policy in nonprofit.server.ts. */
  subsectionPolicy?: NonprofitSubsectionPolicy;
  /** Website or work email — corroboration for the REVIEWER only, never for auto-approve. */
  websiteOrEmail?: string | null;
  /**
   * DEFINITE conflicts only (see NonprofitConflictKind). Any entry here is the owner's
   * deny lane; an ambiguous concern is NOT a conflict and must stay in manual review.
   */
  conflicts?: readonly NonprofitConflictKind[];
  /** The account that already holds this EIN (one free org account per EIN). */
  einClaim?: NonprofitEinClaimSignal | null;
  /** The user applying now — what makes an `einClaim` a re-apply instead of a conflict. */
  applicantUserId?: number | null;
  /** Injectable clock, so the evidence is deterministic under test. */
  now?: Date;
}
/** The status an application row takes for each decision. */
export function nonprofitStatusForDecision(decision: NonprofitDecision): NonprofitStatus {
  switch (decision) {
    case "auto_approve":
      return "approved";
    case "manual_review":
      return "manual_review";
    case "deny":
      // The owner's fraud lane. This is the ONLY automatic non-approval (spec item 3).
      return "denied";
    case "reentry_required":
      // Nothing was decided: the form must be corrected, so the application stays pending.
      return "pending";
  }
}
/**
 * THE DECISION TABLE (research §2.5 + the owner's spec item 3). Pure, total, and
 * evaluated in this order:
 *
 *   1. malformed EIN                          → re-entry (form validation, not a review)
 *   2. a DEFINITE conflict, or one EIN claimed by two different orgs
 *                                             → DENY (the owner's only fraud lane)
 *   3. EIN not in the mirror                  → MANUAL + request supporting documentation
 *   4. name Tier C                            → MANUAL (never reject on name alone)
 *   5. on the revocation list AND in Pub 78   → MANUAL (reinstatement hypothesis)
 *   6. on the revocation list, not in Pub 78  → MANUAL, recommend "decline"
 *   7. STATUS not 01/02                       → MANUAL
 *   8. SUBSECTION not '03' (owner decision (a), RESOLVED: 501(c)(3) ONLY)
 *                                             → MANUAL (never a rejection)
 *   9. otherwise                              → AUTO-APPROVE
 *
 * Step 8 is live because the owner resolved decision (a) on 2026-09-21 — a 501(c)(6)
 * business league, a 501(c)(4), a 501(c)(19) veterans' organization etc. is reviewed by a
 * human and never auto-approved (nonprofit.server.ts, NONPROFIT_SUBSECTION_POLICY).
 *
 * EVERY branch carries its owner-taxonomy reason class (clear-match / possible-match /
 * no-match-request-docs / fraud-likely) — see `reasonClassFor`.
 *
 * Secondary signals are never lost: they become `flags` on the outcome and are written
 * into `evidence`. A group-exemption subordinate (GROUP ≠ 0, 20.1 % of BMF rows)
 * auto-approves — the research allows it — but is TAGGED for the review queue.
 */
export function decideNonprofitVerification(
  input: DecideNonprofitVerificationInput,
): NonprofitVerificationOutcome {
  const subsectionPolicy = input.subsectionPolicy ?? NONPROFIT_SUBSECTION_POLICY;
  const now = input.now ?? new Date();
  const signals: NonprofitVerificationSignals = {
    einFormat: input.einFormat ?? "ok",
    ein: input.ein ?? null,
    einFound: input.einFound ?? false,
    nameTier: input.nameTier ?? null,
    submittedNameNormalized: input.submittedNameNormalized ?? null,
    matchedBmfName: input.matchedBmfName ?? null,
    bmfStatus: input.bmfStatus ?? null,
    bmfSubsection: input.bmfSubsection ?? null,
    bmfGroupNo: input.bmfGroupNo ?? null,
    bmfPostingDate: input.bmfPostingDate ?? null,
    onRevocationList: input.onRevocationList ?? false,
    inPub78: input.inPub78 ?? false,
    pub78DeductibilityCode: input.pub78DeductibilityCode ?? null,
    revocationDate: input.revocationDate ?? null,
    revocationPostingDate: input.revocationPostingDate ?? null,
    reinstatementDate: input.reinstatementDate ?? null,
  };
  const conflicts: NonprofitConflictKind[] = [...(input.conflicts ?? [])];
  // The one-EIN-one-org rule (owner spec item 6) turns into a CONFLICT only when the two
  // organisations are materially DIFFERENT. A second account for the SAME legal org is a
  // duplicate, not fraud: it is deflected at apply time (evaluateNonprofitEinClaim) and, if
  // it still reaches the engine, it is reviewed by a human — never denied as fraud.
  //
  // R1 — HARDENING THE DENY LANE. `einClaim.orgName` is OPTIONAL (a caller may know only the
  // holding user id). Comparing the submitted name against a NULL/blank name is Tier C by
  // construction, and "differs from nothing" is not evidence of two organisations — so an
  // UNKNOWN claim name is an unknown, never a conflict. It falls through to the
  // `ein_already_claimed` MANUAL branch below, which is the honest outcome: a human sees the
  // duplicate and decides. Only a claim that NAMES a materially different org may deny.
  const einClaim = input.einClaim ?? null;
  const claimByAnotherAccount =
    einClaim != null &&
    (einClaim.userId == null ||
      input.applicantUserId == null ||
      einClaim.userId !== input.applicantUserId);
  let einClaimIsDifferentOrg = false;
  let einClaimOrgNameKnown = false;
  if (claimByAnotherAccount && einClaim) {
    einClaimOrgNameKnown = normalizeOrgName(einClaim.orgName ?? null).normalized.length > 0;
    if (einClaimOrgNameKnown) {
      const claimNameTier = compareLegalNames(input.submittedNameNormalized ?? "", [
        einClaim.orgName ?? null,
      ]).tier;
      einClaimIsDifferentOrg = claimNameTier === "C";
      if (einClaimIsDifferentOrg && !conflicts.includes("ein_claimed_by_different_org")) {
        conflicts.push("ein_claimed_by_different_org");
      }
    }
  }
  const flags: string[] = [];
  const outcome = (
    decision: NonprofitDecision,
    reason: NonprofitDecisionReason,
    extra: Partial<
      Pick<
        NonprofitVerificationOutcome,
        "recommendation" | "method" | "flags" | "evidence" | "supportingDocsRequested"
      >
    > = {},
  ): NonprofitVerificationOutcome => ({
    decision,
    status: nonprofitStatusForDecision(decision),
    method: extra.method ?? null,
    reason,
    reasonClass: reasonClassFor(reason),
    recommendation: extra.recommendation ?? null,
    supportingDocsRequested: extra.supportingDocsRequested ?? reason === "ein_not_found",
    flags: [...flags, ...(extra.flags ?? [])],
    signals,
    evidence:
      extra.evidence ??
      buildEvidence(
        signals,
        decision,
        reason,
        subsectionPolicy,
        now,
        conflicts,
        einClaim,
        claimByAnotherAccount ? einClaimOrgNameKnown : null,
      ),
  });

  // ── 1. Form validation (§2.5 row 7) ────────────────────────────────────────
  if (signals.einFormat !== "ok" || !signals.ein) {
    return outcome("reentry_required", "ein_format");
  }

  // ── 2. THE DENY LANE (owner spec item 3: obvious fraud/conflicting info → deny) ──
  // Deliberately narrow: it fires on a DEFINITE conflict, or on two materially different
  // organisations claiming one EIN, and on nothing else. Every ambiguous case keeps
  // falling through to the manual branches below — an unclear record is never a rejection.
  if (conflicts.length > 0) {
    const reason: NonprofitDecisionReason = conflicts.includes("ein_claimed_by_different_org")
      ? "ein_conflict_different_org"
      : "fraud_conflict";
    return outcome("deny", reason, {
      flags: conflicts.map((conflict) => NONPROFIT_CONFLICT_FLAGS[conflict]),
    });
  }

  // ── 2b. One free org account per EIN: the duplicate case (NOT fraud) ────────
  if (claimByAnotherAccount) {
    return outcome("manual_review", "ein_already_claimed", {
      recommendation: null,
      // R1: when the holder's legal name is unknown, the queue is told so explicitly —
      // the reviewer has to identify the holding organization, and the engine refuses to
      // infer a conflict it cannot see.
      flags: einClaimOrgNameKnown
        ? ["one_free_org_account_per_ein", "deflect_to_existing_account"]
        : [
            "one_free_org_account_per_ein",
            "deflect_to_existing_account",
            "ein_claim_org_name_unknown",
          ],
    });
  }

  // ── 3. EIN not in the mirror (§2.5 row 6) ──────────────────────────────────
  // NO-MATCH → the owner's "request supporting documentation": this is the branch where
  // the automatic check failed, so (and only so) a document may be asked for. It is never
  // a rejection — churches, government entities, fiscal sponsors and newly approved orgs
  // are all legitimately absent from the BMF.
  if (!signals.einFound) {
    return outcome("manual_review", "ein_not_found", {
      recommendation: "approve",
      supportingDocsRequested: true,
      flags: ["ein_not_found_exception_class", "request_supporting_documentation"],
    });
  }

  // ── 4. Name mismatch (§2.5 row 5) ──────────────────────────────────────────
  if (signals.nameTier !== "A" && signals.nameTier !== "B") {
    const domainCorroborates = domainCorrespondsToName(
      input.websiteOrEmail ?? null,
      signals.submittedNameNormalized ?? "",
    );
    if (domainCorroborates) flags.push("domain_corresponds");
    return outcome("manual_review", "name_mismatch", {
      // Never an auto-approve on a domain: only the reviewer's recommendation moves.
      recommendation: domainCorroborates ? "approve" : null,
      flags: ["dba_names_absent_from_irs_file_by_design"],
    });
  }

  // ── 5/6. The revocation list (§2.4, §2.5 rows 2 and 3) ─────────────────────
  if (signals.onRevocationList) {
    if (signals.inPub78) {
      return outcome("manual_review", "revoked_reinstated_looking", {
        recommendation: "approve",
        flags: ["revocation_reinstatement_hypothesis"],
      });
    }
    return outcome("manual_review", "revoked_no_reinstatement", {
      recommendation: "decline",
      flags: ["revoked_and_absent_from_pub78"],
    });
  }

  // ── 7. STATUS must be 01/02 (§2.5 row 4) ───────────────────────────────────
  // No recommendation is invented here: the research states one only for the revoked
  // branch, and the reviewer decides with the official status wording in front of them
  // (`status_not_active` carries `bmfStatusMeaning` into the evidence).
  if (!BMF_STATUS_AUTO_APPROVE.includes(String(signals.bmfStatus ?? ""))) {
    return outcome("manual_review", "status_not_active", {
      flags: ["status_not_active"],
    });
  }

  // ── 7b. Owner decision (a): RESOLVED 2026-09-21 — 501(c)(3) only ────────────
  // The shipped policy is `501c3_only` (nonprofit.server.ts), so this branch runs on every
  // non-501(c)(3) record. The org may be perfectly exempt and still not qualify for THIS
  // free tier, so the reviewer decides rather than the engine recommending.
  if (!isEligibleSubsection(signals.bmfSubsection, subsectionPolicy)) {
    return outcome("manual_review", "subsection_not_501c3", {
      flags: ["subsection_not_501c3"],
    });
  }

  // ── 8. Auto-approve (§2.5 row 1) ───────────────────────────────────────────
  if (isGroupExemptionSubordinate(signals.bmfGroupNo)) {
    // Allowed to auto-approve, but tagged: the owner lists group-exemption
    // subordinates as an exception class, so the queue must be able to see them.
    flags.push("group_exemption_subordinate");
  }
  if (signals.bmfSubsection && signals.bmfSubsection !== NONPROFIT_501C3_SUBSECTION) {
    flags.push("subsection_not_501c3");
  }
  if (!signals.inPub78) {
    // Corroboration, not a gate: Pub 78 eligibility is not required to be exempt.
    flags.push("not_in_pub78");
  }
  return outcome("auto_approve", "auto_approved", { method: "irs_eo_bmf" });
}
/**
 * §2.5's audit record: "Every branch stores: ein, normalized submitted name, matched
 * BMF NAME, bmf_status, bmf_posting_date, revocation_posting_date, pub78 flag +
 * deductibility code, decided_at, decided_by, evidence (which file/date produced the
 * verdict)."
 */
function buildEvidence(
  signals: NonprofitVerificationSignals,
  decision: NonprofitDecision,
  reason: NonprofitDecisionReason,
  subsectionPolicy: NonprofitSubsectionPolicy,
  now: Date,
  conflicts: readonly NonprofitConflictKind[] = [],
  einClaim: NonprofitEinClaimSignal | null = null,
  /** Was the holder's legal name known? NULL when no other account holds the EIN. */
  einClaimOrgNameKnown: boolean | null = null,
): Record<string, unknown> {
  return {
    engine: NONPROFIT_VERIFICATION_ENGINE,
    source: IRS_SOURCE_LABEL,
    ein: signals.ein,
    submitted_name_normalized: signals.submittedNameNormalized,
    matched_bmf_name: signals.matchedBmfName,
    name_tier: signals.nameTier,
    bmf_status: signals.bmfStatus,
    bmf_status_meaning: bmfStatusMeaning(signals.bmfStatus),
    bmf_subsection: signals.bmfSubsection,
    bmf_group_no: signals.bmfGroupNo,
    bmf_posting_date: signals.bmfPostingDate,
    pub78: signals.inPub78,
    pub78_deductibility_code: signals.pub78DeductibilityCode,
    on_revocation_list: signals.onRevocationList,
    revocation_date: signals.revocationDate,
    revocation_posting_date: signals.revocationPostingDate,
    reinstatement_date: signals.reinstatementDate,
    subsection_policy: subsectionPolicy,
    decision,
    reason,
    // The owner's taxonomy class (spec item 3) is part of the audit record, not a UI
    // derivation: the queue, the applicant status page and any later export all read the
    // same value the engine wrote.
    reason_class: reasonClassFor(reason),
    supporting_docs_requested: reason === "ein_not_found",
    // Only ever populated on the deny lane — an empty array on every other branch, so a
    // reviewer can tell "no conflict was seen" from "no conflict was looked for".
    conflicts,
    ein_claim: einClaim
      ? { claimed_by_user_id: einClaim.userId ?? null, claimed_org_name: einClaim.orgName ?? null }
      : null,
    // R1: TRUE/FALSE when another account holds the EIN, NULL when none does. A FALSE here
    // is what tells the reviewer the deny lane was NOT available (the holder's name was
    // unknown), so the manual branch is a deliberate unknown, not a missed conflict.
    ein_claim_org_name_known: einClaimOrgNameKnown,
    // decided_by is the SYSTEM for an automatic verdict; a manual branch has no decider
    // yet — a human writes reviewed_by/reviewed_at when they act on the queue.
    decided_by:
      decision === "auto_approve" || decision === "deny"
        ? `system:${NONPROFIT_VERIFICATION_ENGINE}`
        : null,
    decided_at: now.toISOString(),
  };
}

// ── The read side (local DB lookups; never a live irs.gov call) ───────────────
export interface IrsMirrorStore {
  findBmfByEin(ein: string): Promise<BmfIdentity | null>;
  findPub78ByEin(ein: string): Promise<Pub78Identity | null>;
  findRevocationsByEin(ein: string): Promise<RevocationIdentity[]>;
  /** The most recent complete BMF mirror posting date, or null when never imported. */
  bmfPostingDate(): Promise<string | null>;
}
function dateOnly(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
export const neonIrsMirrorStore: IrsMirrorStore = {
  async findBmfByEin(ein) {
    const rows = (await sql()`
      SELECT ein, name, sort_name, state, subsection, status, group_no, ruling_year,
             ntee, posting_date
      FROM irs_eo_bmf
      WHERE ein = ${ein}
      LIMIT 1
    `) as (Omit<BmfIdentity, "posting_date"> & { posting_date: string | Date | null })[];
    const row = rows[0];
    if (!row) return null;
    return { ...row, posting_date: dateOnly(row.posting_date) };
  },
  async findPub78ByEin(ein) {
    const rows = (await sql()`
      SELECT ein, deductibility_code, posting_date
      FROM irs_pub78
      WHERE ein = ${ein}
      LIMIT 1
    `) as (Omit<Pub78Identity, "posting_date"> & { posting_date: string | Date | null })[];
    const row = rows[0];
    if (!row) return null;
    return { ...row, posting_date: dateOnly(row.posting_date) };
  },
  async findRevocationsByEin(ein) {
    const rows = (await sql()`
      SELECT ein, revocation_date, revocation_posting_date, reinstatement_date
      FROM irs_revocations
      WHERE ein = ${ein}
      ORDER BY revocation_posting_date DESC NULLS LAST
    `) as (Omit<
      RevocationIdentity,
      "revocation_date" | "revocation_posting_date" | "reinstatement_date"
    > & {
      revocation_date: string | Date | null;
      revocation_posting_date: string | Date | null;
      reinstatement_date: string | Date | null;
    })[];
    return rows.map((row) => ({
      ...row,
      revocation_date: dateOnly(row.revocation_date),
      revocation_posting_date: dateOnly(row.revocation_posting_date),
      reinstatement_date: dateOnly(row.reinstatement_date),
    }));
  },
  async bmfPostingDate() {
    const rows = (await sql()`
      SELECT posting_date
      FROM irs_mirror_runs
      WHERE source = 'eo_bmf' AND status = 'ok' AND mode = 'import'
      ORDER BY finished_at DESC NULLS LAST, started_at DESC
      LIMIT 1
    `) as { posting_date: string | Date | null }[];
    return dateOnly(rows[0]?.posting_date ?? null);
  },
};
export interface VerifyNonprofitApplicationInput {
  ein: string | number | null | undefined;
  orgName: string | null | undefined;
  /** Corroboration for the reviewer only (never an auto-approve signal). */
  websiteOrEmail?: string | null;
  /**
   * The account that already holds this EIN, when the apply route found one (one free org
   * account per EIN). Checked BEFORE the IRS lookup: a conflict that is definite is a
   * deny whether or not the EIN is in the mirror.
   */
  einClaim?: NonprofitEinClaimSignal | null;
  /** The user applying now — what distinguishes a re-apply from a conflicting claim. */
  applicantUserId?: number | null;
  /** DEFINITE conflicts only (see NonprofitConflictKind). */
  conflicts?: readonly NonprofitConflictKind[];
  subsectionPolicy?: NonprofitSubsectionPolicy;
  now?: Date;
}
/**
 * The whole engine, end to end: normalise → the conflict/deny lane → look up the three IRS
 * mirrors locally → compare names → run the decision table.
 *
 * FAIL-CLOSED: if a mirror lookup throws, the outcome is MANUAL REVIEW with reason
 * `mirror_lookup_failed`. An unknown state is never an approval and never a rejection —
 * which also means that with an EMPTY mirror (the importer has not run yet) EVERY
 * application goes to the manual queue rather than being auto-approved on nothing.
 */
export async function verifyNonprofitApplication(
  input: VerifyNonprofitApplicationInput,
  store: IrsMirrorStore = neonIrsMirrorStore,
): Promise<NonprofitVerificationOutcome> {
  const now = input.now ?? new Date();
  const normalized = normalizeEin(input.ein);
  const nameComparison = compareLegalNames(input.orgName, []);
  if (!normalized.ok) {
    return decideNonprofitVerification({
      einFormat: "bad",
      ein: null,
      submittedNameNormalized: nameComparison.submittedNormalized,
      websiteOrEmail: input.websiteOrEmail ?? null,
      einClaim: input.einClaim ?? null,
      applicantUserId: input.applicantUserId ?? null,
      conflicts: input.conflicts ?? [],
      subsectionPolicy: input.subsectionPolicy,
      now,
    });
  }
  const ein = normalized.ein;
  let bmf: BmfIdentity | null = null;
  let pub78: Pub78Identity | null = null;
  let revocations: RevocationIdentity[] = [];
  let postingDate: string | null = null;
  try {
    [bmf, pub78, revocations, postingDate] = await Promise.all([
      store.findBmfByEin(ein),
      store.findPub78ByEin(ein),
      store.findRevocationsByEin(ein),
      store.bmfPostingDate(),
    ]);
  } catch (error) {
    // FAIL-CLOSED. A mirror that cannot be read is NOT evidence of anything, so the
    // application goes to a human with the failure recorded — never an approval, and
    // never a rejection (an unreadable mirror must not cost an applicant their tier).
    const failed = decideNonprofitVerification({
      einFormat: "ok",
      ein,
      einFound: false,
      nameTier: null,
      submittedNameNormalized: nameComparison.submittedNormalized,
      websiteOrEmail: input.websiteOrEmail ?? null,
      einClaim: input.einClaim ?? null,
      applicantUserId: input.applicantUserId ?? null,
      conflicts: input.conflicts ?? [],
      subsectionPolicy: input.subsectionPolicy,
      now,
    } satisfies DecideNonprofitVerificationInput);
    return {
      ...failed,
      reason: "mirror_lookup_failed",
      // The class follows the reason that is actually returned, so the stored row can
      // never claim `no-match-request-docs` for what is really an unreadable mirror.
      reasonClass: reasonClassFor("mirror_lookup_failed"),
      supportingDocsRequested: false,
      flags: [...failed.flags, "mirror_lookup_failed"],
      evidence: {
        ...failed.evidence,
        reason: "mirror_lookup_failed",
        reason_class: reasonClassFor("mirror_lookup_failed"),
        supporting_docs_requested: false,
        error: (error as Error)?.message?.slice(0, 300) ?? String(error),
      },
    };
  }
  const comparison = bmf
    ? compareLegalNames(input.orgName, [bmf.name, bmf.sort_name ?? null])
    : nameComparison;
  const latestRevocation = revocations[0] ?? null;
  return decideNonprofitVerification({
    einFormat: "ok",
    ein,
    einFound: bmf != null,
    nameTier: bmf ? comparison.tier : null,
    submittedNameNormalized: comparison.submittedNormalized,
    matchedBmfName: bmf ? comparison.matchedName : null,
    bmfStatus: bmf?.status ?? null,
    bmfSubsection: bmf?.subsection ?? null,
    bmfGroupNo: bmf?.group_no ?? null,
    bmfPostingDate: bmf?.posting_date ?? postingDate,
    onRevocationList: revocations.length > 0,
    inPub78: pub78 != null,
    pub78DeductibilityCode: pub78?.deductibility_code ?? null,
    revocationDate: latestRevocation?.revocation_date ?? null,
    revocationPostingDate: latestRevocation?.revocation_posting_date ?? null,
    reinstatementDate:
      revocations.map((row) => row.reinstatement_date).find((value) => value != null) ?? null,
    websiteOrEmail: input.websiteOrEmail ?? null,
    einClaim: input.einClaim ?? null,
    applicantUserId: input.applicantUserId ?? null,
    conflicts: input.conflicts ?? [],
    subsectionPolicy: input.subsectionPolicy,
    now,
  });
}
