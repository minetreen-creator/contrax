/**
 * Red Team proposal evaluator — the AI engine behind /evaluate.
 *
 * The engine adopts the persona of a federal source-selection evaluator and
 * reviews a proposal draft exactly the way a government evaluation panel would:
 * extract every Section M criterion, score each on a 0-100 scale, hunt for
 * missing required content, flag compliance risks with real FAR/DFARS clause
 * references (from the far-dfars clause database), expose weak arguments, and
 * give prioritized, actionable fixes. It ends with a weighted overall "Red
 * Team score" and an explicit GO / NO-GO / FIX-AND-RESUBMIT recommendation.
 */
import { callAI } from "~/lib/ai";
import { searchFARClauses, getClauseByNumber } from "~/lib/far-dfars";

export type CriterionStatus = "strong" | "adequate" | "weak" | "missing";
export type RedTeamDecision = "GO" | "NO-GO" | "FIX-AND-RESUBMIT";
export type RecommendationImpact = "high" | "medium" | "low";

export interface CriterionScore {
  /** Criterion name as stated in the RFP (e.g. "Technical Approach"). */
  name: string;
  /** Score 0-100 — how well the proposal addresses this criterion. */
  score: number;
  /** Points the RFP assigns to this criterion (0 when unspecified). */
  maxScore: number;
  /** Evaluator-style feedback on this criterion. */
  feedback: string;
  status: CriterionStatus;
}

export interface ComplianceRisk {
  description: string;
  /** FAR/DFARS clause number, e.g. "52.219-9". */
  farClause?: string;
  /** Clause title resolved from the clause database, e.g. "Small Business Subcontracting Plan". */
  clauseTitle?: string;
}

export interface RecommendationItem {
  /** A specific, actionable fix — never generic advice. */
  action: string;
  impact: RecommendationImpact;
}

export interface ProposalEvaluation {
  /** Weighted overall Red Team score, 0-100. */
  overallScore: number;
  recommendation: RedTeamDecision;
  recommendationRationale: string;
  /** 2-3 sentence executive summary in evaluator voice. */
  summary: string;
  /** One entry per Section M evaluation criterion. */
  criteria: CriterionScore[];
  /** Content the RFP explicitly requires that the proposal does not address. */
  missingElements: string[];
  /** Compliance risks with FAR/DFARS clause references where applicable. */
  complianceRisks: ComplianceRisk[];
  /** Claims that lack evidence, specificity, or verifiable support. */
  weakArguments: string[];
  /** Concrete fixes, ordered by the AI, ranked high/medium/low impact. */
  recommendations: RecommendationItem[];
  /** ISO timestamp of when the review was generated. */
  generatedAt: string;
}

const VALID_STATUS: CriterionStatus[] = ["strong", "adequate", "weak", "missing"];
const VALID_DECISIONS: RedTeamDecision[] = ["GO", "NO-GO", "FIX-AND-RESUBMIT"];
const VALID_IMPACTS: RecommendationImpact[] = ["high", "medium", "low"];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function fallbackDecision(score: number, risks: ComplianceRisk[]): RedTeamDecision {
  const hasDisqualifying = risks.some((r) =>
    /(must|required|mandatory|shall).*(submit|include|furnish|provide)|disqualif|non-?responsive|not be considered/i.test(r.description),
  );
  if (score >= 75 && !hasDisqualifying) return "GO";
  if (score < 50 || hasDisqualifying) return "NO-GO";
  return "FIX-AND-RESUBMIT";
}

function sanitize(parsed: Partial<ProposalEvaluation>): ProposalEvaluation {
  const criteria = Array.isArray(parsed.criteria)
    ? parsed.criteria
        .filter((c): c is CriterionScore => !!c && typeof c.name === "string")
        .map((c) => ({
          name: String(c.name || "Unnamed criterion").slice(0, 200),
          score: clamp(Number(c.score) || 0, 0, 100),
          maxScore: clamp(Number(c.maxScore) || 0, 0, 1000),
          feedback: String(c.feedback || "").slice(0, 1500),
          status: VALID_STATUS.includes(c.status) ? c.status : ("weak" as CriterionStatus),
        }))
    : [];
  const complianceRisks = Array.isArray(parsed.complianceRisks)
    ? parsed.complianceRisks
        .filter((r) => !!r && typeof r.description === "string")
        .map((r) => ({
          description: String(r.description).slice(0, 1500),
          farClause: typeof r.farClause === "string" && r.farClause.trim() ? r.farClause.trim() : undefined,
        }))
    : [];
  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
        .filter((r) => !!r && typeof r.action === "string")
        .map((r) => ({
          action: String(r.action).slice(0, 1200),
          impact: VALID_IMPACTS.includes(r.impact) ? r.impact : ("medium" as RecommendationImpact),
        }))
    : [];
  const score = clamp(Number(parsed.overallScore) || 0, 0, 100);
  let decision = VALID_DECISIONS.includes(parsed.recommendation as RedTeamDecision)
    ? (parsed.recommendation as RedTeamDecision)
    : fallbackDecision(score, complianceRisks);
  // Keep the decision consistent with the score unless the AI gave a reasoned
  // stricter call (e.g. a disqualifying compliance risk on a high-scoring draft).
  if (decision === "GO" && score < 75) decision = "FIX-AND-RESUBMIT";
  if (decision === "NO-GO" && score >= 75 && !complianceRisks.some((r) => /disqualif|not be considered/i.test(r.description))) {
    decision = "FIX-AND-RESUBMIT";
  }
  return {
    overallScore: score,
    recommendation: decision,
    recommendationRationale: String(parsed.recommendationRationale || "").slice(0, 1200),
    summary: String(parsed.summary || "").slice(0, 2000),
    criteria,
    missingElements: Array.isArray(parsed.missingElements)
      ? parsed.missingElements.filter((m) => typeof m === "string" && m.trim()).map((m) => m.slice(0, 1000))
      : [],
    complianceRisks,
    weakArguments: Array.isArray(parsed.weakArguments)
      ? parsed.weakArguments.filter((w) => typeof w === "string" && w.trim()).map((w) => w.slice(0, 1000))
      : [],
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}

const SYSTEM_PROMPT = `You are a senior federal source-selection evaluator conducting a "Red Team" review of a proposal BEFORE it is submitted. You have served on dozens of source-selection evaluation boards and know how agencies actually score proposals: strictly against the Section M factors, with no credit for claims that cannot be verified. You are ruthless but fair, and your job is to find every weakness, gap, and compliance problem so the offeror can fix them before the government does.

Your review must:
1. Extract EVERY evaluation criterion listed in the RFP's Section M (and any other evaluation factors stated in the solicitation). Score each one individually on a 0-100 scale, where 100 means the proposal fully satisfies that criterion with compelling, specific evidence. Record the maximum points the RFP assigns to the criterion in "maxScore" (0 if the RFP does not state points). Assign a status: "strong" (75+), "adequate" (50-74), "weak" (25-49), or "missing" (<25 or not addressed at all).
2. Identify MISSING ELEMENTS: content the RFP explicitly requires (via "shall", "must", "will be considered", "offeror shall provide", page limits, required attachments, certifications, past performance references, staffing plans, transition plans, etc.) that is absent from the proposal. Quote the requirement, then state what is missing.
3. Flag COMPLIANCE RISKS with FAR/DFARS clause references where applicable (e.g. "Missing small business subcontracting plan per FAR 52.219-9", "Flow-down of FAR 52.222-50 not addressed"). Only cite clauses you are confident apply to this solicitation type; never invent clause numbers. When the RFP or your knowledge indicates a required clause (small business subcontracting plan, Buy American, E-Verify, WOSB/8(a)/HUBZone/SDVOSB self-certification requirements, cybersecurity NIST SP 800-171 / DFARS 252.204-7012, etc.), name it precisely.
4. Identify WEAK ARGUMENTS: claims without evidence, vague past performance references (no contract numbers, dollar values, dates, or customer contacts), unsupported differentiators, generic boilerplate, and assertions that a government evaluator could not verify.
5. Give ACTIONABLE, SPECIFIC RECOMMENDATIONS — never generic advice like "be more detailed". Each must be a concrete fix (e.g. "Add a past performance matrix listing 3 contracts with dollar values, POCs, and dates matching the NAICS 541511 scope", "Insert a one-page transition plan covering the first 60 days with named owners", "Add the required FAR 52.219-9 subcontracting plan with a 35% SB participation goal"). Rank each high/medium/low impact on win probability.
6. Assign an OVERALL RED TEAM SCORE (0-100), a weighted combination of the criterion scores (weight by maxScore when the RFP states points).
7. Give a GO / NO-GO / FIX-AND-RESUBMIT recommendation: GO when the proposal is essentially ready (>=75 and no disqualifying compliance issues), FIX-AND-RESUBMIT when the proposal is fundamentally sound but has fixable gaps (50-74), NO-GO when there are disqualifying compliance problems or the draft is well below competitive (below 50).

Write "summary" as a 2-3 sentence executive summary in the voice of a senior evaluator. Write "recommendationRationale" as a short paragraph justifying the decision.

Rules: never invent RFP requirements — only evaluate against what is actually in the RFP text. Never invent FAR/DFARS clause numbers — only cite clauses you are confident exist. If a section of the proposal is missing entirely, say so explicitly. Be specific enough that the offeror can act without re-reading the RFP.`;

/**
 * Run a full Red Team review of a proposal against an RFP.
 * Never throws — returns a sanitized ProposalEvaluation on any failure.
 */
export async function evaluateProposal(
  rfpText: string,
  proposalText: string,
  userProfile?: { naics?: string; certifications?: string[]; pastPerformance?: string } | null,
): Promise<ProposalEvaluation> {
  const rfp = rfpText.trim().slice(0, 30000);
  const proposal = proposalText.trim().slice(0, 30000);
  // Pull relevant FAR/DFARS clause context from the clause database so the
  // model cites real clauses with accurate titles instead of guessing.
  const clauses = await searchFARClauses(`${rfp.slice(0, 2400)} compliance clause requirement`, 10).catch(() => []);
  const clauseContext = clauses
    .map((c) => `${c.source.toUpperCase()} ${c.clause_number}: ${c.title} — ${c.full_text.slice(0, 400)}`)
    .join("\n");

  const profileBlock = userProfile
    ? `\nOFFEROR PROFILE:\n${JSON.stringify({
        naics: userProfile.naics || null,
        certifications: userProfile.certifications || [],
        pastPerformance: (userProfile.pastPerformance || "").slice(0, 1500),
      }).slice(0, 3000)}`
    : "";

  const prompt = `RFP / SOLICITATION (paste of full RFP or Section M):\n${rfp}\n\nPROPOSAL DRAFT:\n${proposal}${profileBlock}\n\nRELEVANT FAR/DFARS CLAUSES (cite only when applicable; clause titles are authoritative):\n${clauseContext || "(none retrieved)"}\n\nReturn ONLY valid JSON matching exactly this shape:\n{"overallScore":0,"recommendation":"GO|NO-GO|FIX-AND-RESUBMIT","recommendationRationale":"","summary":"","criteria":[{"name":"","score":0,"maxScore":0,"feedback":"","status":"strong|adequate|weak|missing"}],"missingElements":[""],"complianceRisks":[{"description":"","farClause":"52.xxx-x"}],"weakArguments":[""],"recommendations":[{"action":"","impact":"high|medium|low"}]}`;

  const raw = await callAI(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    { max_tokens: 3200, temperature: 0.2, jsonMode: true },
  );

  const parsed = JSON.parse(raw) as Partial<ProposalEvaluation>;
  const result = sanitize(parsed);

  // Enrich compliance-risk clause numbers with authoritative titles from the
  // FAR/DFARS clause database (best-effort, never fails the review).
  if (result.complianceRisks.length) {
    await Promise.all(
      result.complianceRisks.map(async (risk) => {
        if (!risk.farClause) return;
        const clause = await getClauseByNumber(risk.farClause).catch(() => null);
        if (clause) risk.clauseTitle = clause.title;
      }),
    );
  }
  return result;
}

const EMPTY: ProposalEvaluation = {
  overallScore: 0,
  recommendation: "NO-GO",
  recommendationRationale: "The review engine could not produce a result. Please try again in a moment.",
  summary: "Evaluation unavailable — please try again.",
  criteria: [],
  missingElements: [],
  complianceRisks: [],
  weakArguments: [],
  recommendations: [],
  generatedAt: new Date().toISOString(),
};

/**
 * Safe wrapper used when callers want a guaranteed-serializable result even
 * when the AI pipeline fails (JSON parse error, OpenAI outage, etc.).
 */
export async function evaluateProposalSafe(
  rfpText: string,
  proposalText: string,
  userProfile?: { naics?: string; certifications?: string[]; pastPerformance?: string } | null,
): Promise<ProposalEvaluation> {
  try {
    return await evaluateProposal(rfpText, proposalText, userProfile);
  } catch {
    return { ...EMPTY, generatedAt: new Date().toISOString() };
  }
}
