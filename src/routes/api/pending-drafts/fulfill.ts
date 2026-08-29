import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { sql } from "~/db";
import { generateProposalDraft } from "~/lib/proposal-draft";
import { checkTrialCap, consumeTrial } from "~/lib/trial-usage";
import type { BusinessProfile } from "~/components/CompanyProfile";

/**
 * POST /api/pending-drafts/fulfill — generate the FAR-grounded Technical
 * Approach draft for the user's oldest awaiting_profile pending draft, WITHOUT
 * a bids-table row (the solicitation was pasted, not saved).
 *
 * Reuses the exact generation path as /api/bids-draft via the shared
 * generateProposalDraft() (retrieveRelevantClauses on the synthetic bid →
 * clause library block → system/user prompts → OpenAI → extractCitations) and
 * stores the result on the pending_drafts row (status -> 'fulfilled').
 *
 * Fail-open: on any error the row STAYS 'awaiting_profile' (with the error
 * message recorded) so a later retry — from onboarding or /draft/pending —
 * can pick it back up. Never breaks the caller's flow.
 */
async function handler({ request }: { request: Request }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

    // Lazy migrations — same pattern as bids-draft.ts (business_profiles
    // enrichment columns) and pending-drafts.ts (table creation). Each is
    // independent DDL and fail-soft; run concurrently to keep the no-op ALTERs
    // off the serial critical path (a warm DB would otherwise queue one
    // round-trip per statement before the model call).
    await Promise.all([
      sql()`CREATE TABLE IF NOT EXISTS pending_drafts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        solicitation_text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'awaiting_profile',
        draft_text TEXT,
        citations JSONB DEFAULT '[]'::jsonb,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        fulfilled_at TIMESTAMPTZ
      )`.catch(() => {}),
      sql()`CREATE INDEX IF NOT EXISTS idx_pending_drafts_user_status ON pending_drafts (user_id, status)`.catch(() => {}),
      sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS uei TEXT`.catch(() => {}),
      sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS cage_code TEXT`.catch(() => {}),
      sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS sam_expiration DATE`.catch(() => {}),
      sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS duns TEXT`.catch(() => {}),
      sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]'::jsonb`.catch(() => {}),
      sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS years_in_business INTEGER`.catch(() => {}),
      sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS employee_count INTEGER`.catch(() => {}),
      sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS annual_revenue TEXT`.catch(() => {}),
      sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS past_performance_summary TEXT`.catch(() => {}),
      sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS capability_statement TEXT`.catch(() => {}),
      sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS typical_contract_value TEXT`.catch(() => {}),
    ]);

    // Take the oldest awaiting_profile draft (first is fine per the design).
    const pendingRows = await sql()`
      SELECT id, solicitation_text FROM pending_drafts
      WHERE user_id = ${user.id} AND status = 'awaiting_profile'
      ORDER BY id ASC LIMIT 1
    `;
    if (pendingRows.length === 0) {
      return Response.json({ error: "No pending draft found" }, { status: 404 });
    }
    const pending = pendingRows[0] as { id: number; solicitation_text: string };
    const text = String(pending.solicitation_text || "").trim();
    if (!text) {
      await sql()`UPDATE pending_drafts SET error = 'Stored solicitation text is empty' WHERE id = ${pending.id}`.catch(() => {});
      return Response.json({ error: "Stored solicitation text is empty" }, { status: 400 });
    }

    // Business profile must exist (onboarding completed). If it does not, the
    // row stays awaiting_profile and the caller surfaces an honest message.
    const profileRows = await sql()`SELECT id, business_name, industry, locations, service_categories, naics_codes, uei, cage_code, sam_expiration, duns, certifications, years_in_business, employee_count, annual_revenue, past_performance_summary, capability_statement, specialties, licenses, typical_contract_value FROM business_profiles WHERE user_id = ${user.id}`;
    if (profileRows.length === 0) {
      return Response.json(
        { error: "Business profile not found — complete onboarding first" },
        { status: 400 },
      );
    }
    const profile = profileRows[0] as BusinessProfile;

    // Build a synthetic bid from the pasted text and run the SAME grounded
    // generation path as bids-draft.
    const syntheticBid = {
      title: text.slice(0, 80),
      description: text,
      agency: "",
      location: "",
      category: "",
      due_date: null,
      estimated_value: null,
    };

    // PER-TRIAL DRAFT CAP (owner): an ACTIVE Professional-trial user gets 1
    // proposal draft for the whole trial. If they've used it, reject with a
    // clear upgrade prompt (the row stays awaiting_profile for paid retry).
    const trialDraft = await checkTrialCap(user.id, "drafts");
    if (trialDraft.trialActive && !trialDraft.allowed) {
      return Response.json(
        {
          error:
            "You've used your 1 trial proposal draft. Upgrade to Professional to keep drafting proposals.",
        },
        { status: 403 },
      );
    }
    const { draftText, citations } = await generateProposalDraft(syntheticBid, profile);

    await sql()`
      UPDATE pending_drafts
      SET status = 'fulfilled', draft_text = ${draftText},
          citations = ${JSON.stringify(citations)}::jsonb,
          error = NULL, fulfilled_at = NOW()
      WHERE id = ${pending.id}
    `;
    // Consume ONE unit against the per-trial ledger on a successful generation.
    await consumeTrial(user.id, "drafts");

    return Response.json({
      id: pending.id,
      draft_text: draftText,
      citations,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[api/pending-drafts/fulfill] error:", err);
    // Fail-open: keep the row awaiting_profile so a retry can pick it up, and
    // record the error so the display can show an honest message.
    try {
      await sql()`
        UPDATE pending_drafts SET error = ${err instanceof Error ? err.message.slice(0, 500) : "Draft generation failed"}
        WHERE user_id = ${(await getUserFromRequest(request))?.id ?? -1} AND status = 'awaiting_profile'
      `;
    } catch { /* best-effort */ }
    return Response.json(
      { error: err instanceof Error ? err.message : "Draft generation failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/pending-drafts/fulfill")({
  server: { handlers: { POST: handler } },
});
