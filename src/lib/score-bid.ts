/**
 * Shared server-side win-probability scoring engine.
 *
 * Used by the `/api/score` API route (client-facing) AND by dashboard's
 * `fetchDigest` server function (server-side digest curation). Extracted so the
 * logic lives in exactly one place now that the `scoreBid` createServerFn RPC
 * has been retired (RPCs silently fail on production Vercel).
 */
import { sql } from "~/db";
import { getLearningContext } from "~/lib/learning";
import { getRelevantContext } from "~/lib/knowledge";
import { buildProfileContext, buildScoringWeights } from "~/lib/profile-context";
import type { BusinessProfile } from "~/components/CompanyProfile";
import type { AuthUser } from "~/lib/auth";

export interface BidScore {
  bid_id: number;
  win_probability: number;
  competition_level: string;
  agency_sentiment: string;
  size_fit: string;
  experience_match: string;
  similar_awards_note: string;
  naics_match: string;
  role_fit: string;
  ai_explanation: string;
  generated_at: string;
}

/** Best-effort activity telemetry: never block scoring if the table is missing. */
async function trackActivity(memberEmail: string, action: string, bidId?: number, details?: string) {
  try {
    await sql()`CREATE TABLE IF NOT EXISTS team_activity (id SERIAL PRIMARY KEY, member_email TEXT NOT NULL, action TEXT NOT NULL, bid_id INTEGER REFERENCES bids(id), details TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql()`INSERT INTO team_activity (member_email, action, bid_id, details) VALUES (${memberEmail}, ${action}, ${bidId ?? null}, ${details ?? null})`;
  } catch { /* workspace telemetry is intentionally non-blocking */ }
}

export async function scoreBidServer(input: {
  user: AuthUser;
  bidId: number;
  regenerate: boolean;
}): Promise<BidScore> {
  const { user, bidId, regenerate } = input;
  await sql()`CREATE TABLE IF NOT EXISTS bid_scores (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, bid_id INTEGER NOT NULL REFERENCES bids(id), win_probability INTEGER NOT NULL, competition_level TEXT NOT NULL, agency_sentiment TEXT NOT NULL, size_fit TEXT NOT NULL DEFAULT '', experience_match TEXT NOT NULL, similar_awards_note TEXT NOT NULL DEFAULT '', ai_explanation TEXT NOT NULL, generated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id))`;
  // Backward compat ALTERs
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS win_probability INTEGER DEFAULT 50`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS agency_sentiment TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS size_fit TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS experience_match TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS similar_awards_note TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS naics_match TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS role_fit TEXT DEFAULT ''`; } catch {}
  if (!regenerate) {
    let cached: any[];
    try {
      cached = await sql()`SELECT bid_id, win_probability, competition_level, agency_sentiment, size_fit, experience_match, similar_awards_note, naics_match, role_fit, ai_explanation, generated_at FROM bid_scores WHERE user_id = ${user.id} AND bid_id = ${bidId}`;
    } catch {
      // Fallback: old schema
      const oldCached = await sql()`SELECT bid_id, match_score, competition_level, naics_fit, similarity_notes, profitability_estimate, ai_explanation, generated_at FROM bid_scores WHERE user_id = ${user.id} AND bid_id = ${bidId}`;
      if (oldCached.length) {
        const r = oldCached[0] as any;
        return { bid_id: r.bid_id, win_probability: Number(r.match_score), competition_level: r.competition_level, agency_sentiment: r.naics_fit || '', size_fit: r.profitability_estimate || '', experience_match: r.similarity_notes || '', similar_awards_note: '', naics_match: '', role_fit: '', ai_explanation: r.ai_explanation, generated_at: String(r.generated_at) } as BidScore;
      }
      cached = [];
    }
    if (cached.length) { const r = cached[0] as any; return { bid_id: r.bid_id, win_probability: Number(r.win_probability), competition_level: r.competition_level, agency_sentiment: r.agency_sentiment || '', size_fit: r.size_fit || '', experience_match: r.experience_match || '', similar_awards_note: r.similar_awards_note || '', naics_match: r.naics_match || '', role_fit: r.role_fit || '', ai_explanation: r.ai_explanation, generated_at: String(r.generated_at) } as BidScore; }
  }
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
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS specialties JSONB DEFAULT '[]'::jsonb`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS licenses JSONB DEFAULT '[]'::jsonb`; } catch {}
  try { await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS typical_contract_value TEXT`; } catch {}
  const bids = await sql()`SELECT title, agency, description, category, location, estimated_value, due_date FROM bids WHERE id = ${bidId}`;
  if (!bids.length) throw new Error("Bid not found");
  const profiles = await sql()`SELECT id, business_name, industry, locations, service_categories, naics_codes, uei, cage_code, sam_expiration, duns, certifications, years_in_business, employee_count, annual_revenue, past_performance_summary, capability_statement, specialties, licenses, typical_contract_value FROM business_profiles WHERE user_id = ${user.id}`;
  if (!profiles.length) throw new Error("Business profile not found — complete onboarding first");
  const bid = bids[0] as any, profile = profiles[0] as BusinessProfile;
  const profileNaicsCodes: string[] = Array.isArray(profile.naics_codes) ? profile.naics_codes : [];
  const learningCtxScore = await getLearningContext(user.email, bid.title, bid.agency, profileNaicsCodes[0] || "", bid.estimated_value || "");
  const knowledgeCtx = await getRelevantContext(`${bid.title} ${bid.description || ""} ${bid.category || ""}`);
  const prompt = `You are a government contracting analyst estimating win probability for a small business. Analyze this opportunity and return ONLY valid JSON — no markdown, no code fences.
Consider these factors:
1. Number of likely competitors — is this a crowded category or niche? Fewer competitors means higher win probability.
2. Agency buying history — does this agency typically award to small businesses like this one?
3. Contract size — is this the right size for the user's business? Too large or too small lowers win probability.
4. Similar past awards — has this agency awarded similar contracts before? Established patterns increase confidence.
5. Your experience — does the user's profile/services match what's being asked for?
6. Past award winners — who usually wins these and why? Incumbent advantage, set-aside patterns, etc.
7. NAICS Code Match — how well do the user's NAICS codes align with this bid's category and description? NAICS codes are the standard industry classification for government contracting.
8. Role Fit — for staffing agencies: does the bid require roles the user staffs (e.g. RN, LPN, CNA, physician, physical therapist)? Strong role overlap raises win probability; required roles the user cannot staff lower it. Mention specific roles in your analysis.
Return ONLY: {"win_probability": number 0-100, "competition_level":"Low"|"Moderate"|"High", "agency_sentiment":"...", "size_fit":"...", "experience_match":"...", "similar_awards_note":"...", "naics_match":"...", "role_fit":"...", "ai_explanation":"..."}
Learned patterns from the user's win/loss history:\n${learningCtxScore}\n\n${knowledgeCtx}\n\nOpportunity: title=${bid.title}; agency=${bid.agency}; description=${bid.description || "Not provided"}; category=${bid.category}; location=${bid.location}; estimated value=${bid.estimated_value}; due date=${bid.due_date}
Business profile:\n${buildProfileContext(profile)}\n\nScoring emphasis — prioritize these factors for THIS business (higher = more weight):\n${JSON.stringify(buildScoringWeights(profile))}`;
  try {
    const apiKey = process.env.OPENAI_API_KEY; if (!apiKey) throw new Error("OpenAI API key not configured");
    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 900, temperature: 0.2 }) });
    if (!response.ok) throw new Error(`OpenAI API error (${response.status})`);
    const json = await response.json() as any, content = json.choices?.[0]?.message?.content;
    const match = content?.match(/\{[\s\S]*\}/); if (!match) throw new Error("Could not parse AI response");
    const parsed = JSON.parse(match[0]);
    const score = { bid_id: bidId, win_probability: Math.max(0, Math.min(100, Math.round(Number(parsed.win_probability)))), competition_level: ["Low","Moderate","High"].includes(parsed.competition_level) ? parsed.competition_level : "Moderate", agency_sentiment: String(parsed.agency_sentiment || "No agency sentiment analysis provided."), size_fit: String(parsed.size_fit || "No size fit analysis provided."), experience_match: String(parsed.experience_match || "No experience match analysis provided."), similar_awards_note: String(parsed.similar_awards_note || "No similar awards data available."), naics_match: String(parsed.naics_match || "No NAICS code match analysis provided."), role_fit: String(parsed.role_fit || "No role fit analysis provided."), ai_explanation: String(parsed.ai_explanation || "No explanation provided."), generated_at: new Date().toISOString() } as BidScore;
    await sql()`INSERT INTO bid_scores (user_id, bid_id, win_probability, competition_level, agency_sentiment, size_fit, experience_match, similar_awards_note, naics_match, role_fit, ai_explanation) VALUES (${user.id}, ${bidId}, ${score.win_probability}, ${score.competition_level}, ${score.agency_sentiment}, ${score.size_fit}, ${score.experience_match}, ${score.similar_awards_note}, ${score.naics_match}, ${score.role_fit}, ${score.ai_explanation}) ON CONFLICT (user_id, bid_id) DO UPDATE SET win_probability=EXCLUDED.win_probability, competition_level=EXCLUDED.competition_level, agency_sentiment=EXCLUDED.agency_sentiment, size_fit=EXCLUDED.size_fit, experience_match=EXCLUDED.experience_match, similar_awards_note=EXCLUDED.similar_awards_note, naics_match=EXCLUDED.naics_match, role_fit=EXCLUDED.role_fit, ai_explanation=EXCLUDED.ai_explanation, generated_at=NOW()`;
    await trackActivity(user.email, "scored_bid", bidId, `${score.win_probability}% Win Chance`);
    return score;
  } catch (err) { throw new Error(`Win probability analysis failed: ${err instanceof Error ? err.message : "AI request failed"}`); }
}
