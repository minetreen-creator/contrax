import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { getRelevantContext } from "~/lib/knowledge";
import { buildProfileContext } from "~/lib/profile-context";
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

    // Check cache
    const existing = await sql()`SELECT draft_text, generated_at FROM proposal_drafts WHERE bid_id = ${bidId} AND user_id = ${user.id}`;
    if (existing.length > 0) {
      const row = existing[0] as any;
      return Response.json({ bid_id: bidId, draft_text: row.draft_text, generated_at: String(row.generated_at) });
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
    const knowledgeCtx = await getRelevantContext(`${bid.title} ${bid.description || ""} proposal template capability statement compliance checklist`);

    const prompt = `You are a government proposal writer. Draft a professional proposal response for this contract opportunity based on the business profile provided.

Include:
1. Cover letter introducing the business
2. Executive summary of understanding the requirements
3. Relevant experience and qualifications
4. Proposed approach and methodology
5. Pricing summary (if applicable)

Format as a formal business proposal with sections and professional tone.

Bid:
Title: ${bid.title}
Agency: ${bid.agency}
Description: ${bid.description || "Not provided"}
Location: ${bid.location || "Not specified"}
Category: ${bid.category || "Not specified"}
Due Date: ${String(bid.due_date)}
Estimated Value: ${bid.estimated_value || "Not specified"}

Business profile:
${buildProfileContext(profile)}
${knowledgeCtx}`;

    let draftText: string;
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OpenAI API key not configured");

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
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

    // Store in DB
    await sql()`INSERT INTO proposal_drafts (bid_id, user_id, draft_text)
      VALUES (${bidId}, ${user.id}, ${draftText})
      ON CONFLICT (bid_id, user_id) DO UPDATE
      SET draft_text = ${draftText}, generated_at = NOW()`;
    try {
    await sql()`CREATE TABLE IF NOT EXISTS team_activity (id SERIAL PRIMARY KEY, member_email TEXT NOT NULL, action TEXT NOT NULL, bid_id INTEGER REFERENCES bids(id), details TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql()`INSERT INTO team_activity (member_email, action, bid_id, details) VALUES (${user.email}, 'drafted_proposal', ${bidId}, NULL)`;
  } catch { /* workspace telemetry is intentionally non-blocking */ }

    return Response.json({ bid_id: bidId, draft_text: draftText, generated_at: new Date().toISOString() });
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
