import { callAI } from "~/lib/ai";
import { searchFARClauses } from "~/lib/far-dfars";

export interface ProposalEvaluation {
  overallScore: number;
  criteria: { name: string; score: number; maxScore: number; feedback: string; status: "strong" | "adequate" | "weak" | "missing" }[];
  missingElements: string[];
  complianceRisks: { description: string; farClause?: string }[];
  weakArguments: string[];
  recommendations: string[];
}
const EMPTY: ProposalEvaluation = { overallScore: 0, criteria: [], missingElements: ["Evaluation unavailable — please try again."], complianceRisks: [], weakArguments: [], recommendations: [] };
export async function evaluateProposal(rfpText: string, proposalText: string, userProfile?: any): Promise<ProposalEvaluation> {
  const clauses = await searchFARClauses(`${rfpText.slice(0, 2400)} proposal compliance`, 8).catch(() => []);
  const context = clauses.map(c => `${c.clause_number}: ${c.title} — ${c.full_text.slice(0, 500)}`).join("\n");
  const prompt = `You are a federal source-selection evaluator. Extract Section M evaluation criteria from the RFP and score the proposal as objectively as a government evaluator. Never invent criteria or compliance obligations. Identify absent content, weak evidence, and actionable fixes. Cross-reference only the supplied FAR/DFARS references. Return ONLY valid JSON matching this shape: {"overallScore":0,"criteria":[{"name":"","score":0,"maxScore":10,"feedback":"","status":"strong|adequate|weak|missing"}],"missingElements":[],"complianceRisks":[{"description":"","farClause":""}],"weakArguments":[],"recommendations":[]}.
RFP / Section M:\n${rfpText.slice(0, 30000)}\n\nPROPOSAL DRAFT:\n${proposalText.slice(0, 30000)}\n\nRelevant FAR/DFARS references (cite only when applicable):\n${context}\n${userProfile ? `\nOfferor profile:\n${JSON.stringify(userProfile).slice(0, 3000)}` : ""}`;
  try {
    const raw = await callAI([{ role: "system", content: "You evaluate federal proposals rigorously and return structured JSON." }, { role: "user", content: prompt }], { max_tokens: 2200, temperature: 0.2, jsonMode: true });
    const parsed = JSON.parse(raw) as Partial<ProposalEvaluation>;
    return { ...EMPTY, ...parsed, overallScore: Math.max(0, Math.min(100, Number(parsed.overallScore) || 0)), criteria: Array.isArray(parsed.criteria) ? parsed.criteria : [] };
  } catch { return EMPTY; }
}
