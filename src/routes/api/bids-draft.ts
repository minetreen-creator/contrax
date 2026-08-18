import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { generateProposalDraft } from "~/lib/proposal-draft";
import { extractCitations } from "~/lib/far-grounding";
import type { BusinessProfile } from "~/components/CompanyProfile";

async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => null)) as { bidId?: unknown } | null;
    const bidId = Number(body?.bidId);
    if (!Number.isInteger(bidId) || bidId <= 0) {
      return Response.json({ error: "Invalid bid id" }, { status: 400 });
    }
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

    // Lazy migration for FAR-grounded drafting citations (same pattern as the
    // business_profiles ALTERs below).
    try { await sql()`ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS citations JSONB DEFAULT '[]'::jsonb`; } catch {}

    // Check cache
    const existing = await sql()`SELECT draft_text, generated_at FROM proposal_drafts WHERE bid_id = ${bidId} AND user_id = ${user.id}`;
    if (existing.length > 0) {
      const row = existing[0] as any;
      // Cached drafts also become grounded: recompute citations from the stored
      // text (the DB-fallback lookup validates every number against far_clauses).
      const citations = await extractCitations(row.draft_text, []);
      return Response.json({ bid_id: bidId, draft_text: row.draft_text, citations, generated_at: String(row.generated_at) });
    }

    // Fetch bid and business profile
    const bidRows = await sql()`SELECT title, agency, description, location, category, due_date, estimated_value FROM bids WHERE id = ${bidId}`;
    if (bidRows.length === 0) throw new Error("Bid not found");
    const bid = bidRows[0] as any;

    // Lazy migration for business profile enrichment columns on existing databases.
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS uei TEXT`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS cage_code TEXT`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS sam_expiration DATE`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS duns TEXT`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]'::jsonb`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS years_in_business INTEGER`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS employee_count INTEGER`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS annual_revenue TEXT`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS past_performance_summary TEXT`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS capability_statement TEXT`; } catch {}
    try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS typical_contract_value TEXT`; } catch {}
    const profileRows = await sql()`SELECT id, business_name, industry, locations, service_categories, naics_codes, uei, cage_code, sam_expiration, duns, certifications, years_in_business, employee_count, annual_revenue, past_performance_summary, capability_statement, specialties, licenses, typical_contract_value FROM business_profiles WHERE user_id = ${user.id}`;
    if (profileRows.length === 0) throw new Error("Business profile not found — complete onboarding first");
    const profile = profileRows[0] as BusinessProfile;

    // FAR-Grounded Drafting — shared with /api/pending-drafts/fulfill so real
    // bids and pasted solicitations run the EXACT same generation path
    // (retrieveRelevantClauses → clause library block → prompts → OpenAI →
    // extractCitations). See src/lib/proposal-draft.ts.
    const { draftText, citations } = await generateProposalDraft(bid, profile);

    // Store in DB
    await sql()`INSERT INTO proposal_drafts (bid_id, user_id, draft_text, citations)
      VALUES (${bidId}, ${user.id}, ${draftText}, ${JSON.stringify(citations)}::jsonb)
      ON CONFLICT (bid_id, user_id) DO UPDATE
      SET draft_text = ${draftText}, citations = ${JSON.stringify(citations)}::jsonb, generated_at = NOW()`;
    try {
    await sql()`CREATE TABLE IF NOT EXISTS team_activity (id SERIAL PRIMARY KEY, member_email TEXT NOT NULL, action TEXT NOT NULL, bid_id INTEGER REFERENCES bids(id), details TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql()`INSERT INTO team_activity (member_email, action, bid_id, details) VALUES (${user.email}, 'drafted_proposal', ${bidId}, NULL)`;
  } catch { /* workspace telemetry is intentionally non-blocking */ }

    return Response.json({ bid_id: bidId, draft_text: draftText, citations, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error("[api/bids-draft] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Proposal generation failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/bids-draft")({
  server: { handlers: { POST: handler } },
});
