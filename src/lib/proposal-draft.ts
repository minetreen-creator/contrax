/**
 * Shared FAR-Grounded proposal draft generation.
 *
 * Extracted from src/routes/api/bids-draft.ts so the same grounding path
 * (retrieveRelevantClauses → clause library block → system/user prompts →
 * OpenAI → extractCitations) serves BOTH real bids (from the bids table) and
 * synthetic bids built from pasted solicitation text (pending_drafts fulfill).
 *
 * Honesty contract: the model may ONLY cite clause numbers that appear in the
 * retrieved clause library; extractCitations DB-validates every number against
 * far_clauses before anything is stored or rendered.
 */
import { getRelevantContext } from "~/lib/knowledge";
import { buildProfileContext } from "~/lib/profile-context";
import {
  extractCitations,
  retrieveRelevantClauses,
  type GroundedClause,
} from "~/lib/far-grounding";
import type { BusinessProfile } from "~/components/CompanyProfile";

/** Minimal bid shape the generator needs (real bid rows and synthetic alike). */
export interface DraftBidInput {
  title: string;
  agency?: string | null;
  description?: string | null;
  location?: string | null;
  category?: string | null;
  due_date?: Date | string | null;
  estimated_value?: string | number | null;
}

export interface ProposalDraftResult {
  draftText: string;
  citations: GroundedClause[];
}

/**
 * Runs the full FAR-Grounded Drafting pipeline for a bid (real or synthetic).
 * Throws on failure (missing key, OpenAI error, empty response) — callers
 * decide how to fail open.
 */
export async function generateProposalDraft(
  bid: DraftBidInput,
  profile: BusinessProfile,
): Promise<ProposalDraftResult> {
  // The knowledge-base RAG context and the FAR/DFARS clause retrieval are
  // fully independent (distinct DB reads, no shared state) and both fail open
  // ("" / []), so run them concurrently instead of sequentially. This overlaps
  // the embedding + pgvector query with the clause retrieval, removing the
  // slower of the two from the critical path before the (irreducible) model call.
  const [knowledgeCtx, retrievedClauses] = await Promise.all([
    getRelevantContext(
      `${bid.title} ${bid.description || ""} proposal template capability statement compliance checklist`,
    ),
    // FAR-Grounded Drafting: retrieve REAL clauses from far_clauses and make
    // them the ONLY citation source the model may draw from.
    retrieveRelevantClauses(bid),
  ]);
  const clauseLibraryBlock =
    retrievedClauses.length === 0
      ? ""
      : `

FAR CLAUSE LIBRARY — MANDATORY CITATION SOURCE (real FAR/DFARS clauses retrieved because they apply to THIS solicitation):
The clauses below were retrieved for this solicitation, so they govern parts of this work. You MUST cite them in the draft:
- Cite the applicable clauses inline, in the exact form [FAR 52.212-4] or [DFARS 252.204-7012], immediately after the sentence or claim they support.
- Cite clauses in EVERY section (cover letter, executive summary, relevant experience, proposed approach, pricing) wherever a sentence makes a compliance, terms, or requirements claim that a listed clause governs.
- Do not leave this list unused: if a clause on the list applies to what you wrote, cite it. A clause may be cited multiple times in different sections.
- Cite ONLY the exact clause numbers from this list. NEVER invent a clause number or use one from memory — any number not on this list is forbidden.
- Example of a grounded sentence: "All commercial items will be acquired under the terms and conditions of the solicitation [FAR 52.212-4], and offerors must comply with the instructions at [FAR 52.212-1]."
- If no clause on the list applies to a specific sentence, write it without a citation — but most compliance and terms claims ARE governed by a listed clause, so expect several citations per section.

${retrievedClauses
  .map(
    (c) =>
      `[${c.clause_number.startsWith("252.") ? "DFARS" : "FAR"} ${c.clause_number}] ${c.title}\n${c.full_text.slice(0, 1500)}${c.full_text.length > 1500 ? "\n(truncated)" : ""}`,
  )
  .join("\n\n")}`;

  const systemPrompt = `You are a government proposal writer for a small business pursuing federal contracts.

MANDATORY CITATION RULE: Your draft MUST contain inline FAR/DFARS clause citations that support its claims.
- Cite ONLY the clause numbers listed in the "FAR CLAUSE LIBRARY" section of the user prompt. Never invent, guess, or recall a clause number that is not on that list.
- Format every citation inline as [FAR 52.212-4] or [DFARS 252.204-7012], placed immediately after the sentence or claim it supports.
- A draft that makes compliance, terms, or requirements claims without citing the governing clauses is INCOMPLETE. Do not leave the clause list unused.`;

  const prompt = `You are a government proposal writer. Draft a professional proposal response for this contract opportunity based on the business profile provided.

Include:
1. Cover letter introducing the business
2. Executive summary of understanding the requirements
3. Relevant experience and qualifications
4. Proposed approach and methodology
5. Pricing summary (if applicable)

Format as a formal business proposal with sections and professional tone.

CITATION REQUIREMENT: As you write each section, insert the applicable FAR/DFARS clause citations from the FAR CLAUSE LIBRARY (below) inline — in the form [FAR 52.xxx-x] or [DFARS 252.xxx-x] — immediately after the sentence or claim each clause supports. The library was retrieved because it applies to this solicitation, so do not leave it unused.

Bid:
Title: ${bid.title}
Agency: ${bid.agency || "Not provided"}
Description: ${bid.description || "Not provided"}
Location: ${bid.location || "Not specified"}
Category: ${bid.category || "Not specified"}
Due Date: ${bid.due_date ? String(bid.due_date) : "Not specified"}
Estimated Value: ${bid.estimated_value ?? "Not specified"}

Business profile:
${buildProfileContext(profile)}
${knowledgeCtx}${clauseLibraryBlock}`;

  let draftText: string;
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key not configured");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        max_tokens: 1500,
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errBody.substring(0, 200)}`);
    }

    const json = await response.json() as any;
    draftText = json.choices?.[0]?.message?.content;
    if (!draftText) throw new Error("No content in OpenAI response");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI proposal generation failed";
    throw new Error(`Proposal generation failed: ${msg}`);
  }

  // Extract + DB-validate citations from the generated draft text.
  const citations = await extractCitations(draftText, retrievedClauses);
  return { draftText, citations };
}
