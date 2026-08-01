import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useCallback, useEffect } from "react";
import { sql } from "~/db";
import { getCurrentUser, logout, type AuthUser } from "~/lib/auth";
import { redirectToCheckout } from "~/lib/checkout";
import { getPricingRecommendation, fetchPricingCache, type PricingRecommendation } from "~/lib/pricing";
import { trackBid, untrackBid } from "~/routes/tracking";
import { getLearningContext, getUserPatterns } from "~/lib/learning";
import { createDeadlineAlertsForUser } from "~/lib/notifications";

// ── Types ────────────────────────────────────────────────────────────────────
interface BusinessProfile {
  id: number; business_name: string; industry: string;
  locations: string[]; service_categories: string[]; naics_codes: string[];
}
interface Bid {
  id: number; title: string; agency: string; description: string;
  location: string; category: string; due_date: string; estimated_value: string;
  source_url: string | null;
}
interface BidSummary {
  bid_id: number; summary_text: string; key_requirements: string[];
  generated_at: string;
}
interface ProposalDraft {
  bid_id: number; draft_text: string; generated_at: string;
}
interface BidRecommendation {
  bid_id: string; bid_title: string; win_probability: number | null;
  effort_level: string; competition_level: string; strategic_fit: string;
  recommendation: "GO" | "NO_GO" | "CAUTIOUS"; summary: string;
  factors: { factor: string; impact: string }[]; created_at: string;
}
interface BidScore {
  bid_id: number; win_probability: number;
  competition_level: string;
  agency_sentiment: string;
  size_fit: string;
  experience_match: string;
  similar_awards_note: string;
  naics_match: string;
  ai_explanation: string; generated_at: string;
}
interface SavedMatch { bid_id: number; status: string; }
interface DigestEntry {
  bid_id: number; title: string; agency: string; estimated_value: string;
  win_probability: number; reason: string;
}
interface DashboardData {
  profile: BusinessProfile | null;
  bids: Bid[];
  savedMatches: SavedMatch[];
  summaries: BidSummary[];
  drafts: ProposalDraft[];
  scores: BidScore[];
  recommendations: BidRecommendation[];
  pricing: PricingRecommendation[];
  lastSynced: string | null;
  totalBids: number;
  lossesCount: number;
  urgentTrackedCount: number;
}

// ── Server Functions ─────────────────────────────────────────────────────────

// Best-effort activity telemetry: never block the primary bid action if the optional
// workspace tables are unavailable during a migration or on an older database.
async function trackActivity(memberEmail: string, action: string, bidId?: number, details?: string) {
  try {
    await sql()`CREATE TABLE IF NOT EXISTS team_activity (id SERIAL PRIMARY KEY, member_email TEXT NOT NULL, action TEXT NOT NULL, bid_id INTEGER REFERENCES bids(id), details TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
    await sql()`INSERT INTO team_activity (member_email, action, bid_id, details) VALUES (${memberEmail}, ${action}, ${bidId ?? null}, ${details ?? null})`;
  } catch { /* workspace telemetry is intentionally non-blocking */ }
}

const fetchDashboardData = createServerFn({ method: "GET" }).handler(async (): Promise<DashboardData> => {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  // Check for active_profile_id (agency entity switching)
  let activeProfileId: number | null = null;
  try {
    const userRows = await sql()`SELECT active_profile_id FROM users WHERE id = ${user.id}`;
    activeProfileId = (userRows[0] as any)?.active_profile_id ?? null;
  } catch { /* column may not exist yet */ }

  const profileRows = activeProfileId
    ? await sql()`SELECT id, business_name, industry, locations, service_categories, naics_codes FROM business_profiles WHERE id = ${activeProfileId} AND user_id = ${user.id}`
    : await sql()`
      SELECT id, business_name, industry, locations, service_categories, naics_codes
      FROM business_profiles WHERE user_id = ${user.id}`;
  let profile: BusinessProfile | null = null;
  if (profileRows.length > 0) {
    const p = profileRows[0] as any;
    profile = {
      id: p.id, business_name: p.business_name, industry: p.industry,
      locations: Array.isArray(p.locations) ? p.locations : [],
      service_categories: Array.isArray(p.service_categories) ? p.service_categories : [],
      naics_codes: Array.isArray(p.naics_codes) ? p.naics_codes : [],
    };
  }

  await sql()`CREATE TABLE IF NOT EXISTS bid_scores (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, bid_id INTEGER NOT NULL REFERENCES bids(id), win_probability INTEGER NOT NULL, competition_level TEXT NOT NULL, agency_sentiment TEXT NOT NULL, size_fit TEXT NOT NULL DEFAULT '', experience_match TEXT NOT NULL, similar_awards_note TEXT NOT NULL DEFAULT '', ai_explanation TEXT NOT NULL, generated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id))`;
  // Backward compat: add new columns if they don't exist yet (old DB may have match_score/naics_fit/similarity_notes/profitability_estimate)
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS win_probability INTEGER DEFAULT 50`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS agency_sentiment TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS size_fit TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS experience_match TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS similar_awards_note TEXT DEFAULT ''`; } catch {}
  try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS naics_match TEXT DEFAULT ''`; } catch {}

  const bidRows = await sql()`SELECT id, title, agency, description, location, category, due_date, estimated_value, source_url FROM bids ORDER BY due_date ASC`;
  const bids: Bid[] = (bidRows as any[]).map((b) => ({
    id: b.id, title: b.title, agency: b.agency, description: b.description,
    location: b.location, category: b.category, due_date: String(b.due_date),
    estimated_value: b.estimated_value, source_url: b.source_url,
  }));

  const matchRows = await sql()`SELECT bid_id, status FROM saved_matches WHERE user_id = ${user.id}`;
  const savedMatches: SavedMatch[] = (matchRows as any[]).map((m) => ({
    bid_id: m.bid_id, status: m.status,
  }));

  // Fetch summaries and drafts for this user's saved/viewable bids
  const summaryRows = await sql()`SELECT bid_id, summary_text, key_requirements, generated_at FROM bid_summaries`;
  const summaries: BidSummary[] = (summaryRows as any[]).map((s) => ({
    bid_id: s.bid_id,
    summary_text: s.summary_text,
    key_requirements: Array.isArray(s.key_requirements) ? s.key_requirements : [],
    generated_at: String(s.generated_at),
  }));

  // Fetch scores with backward compat: try new columns first, fall back to old names
  let scoreRows: any[];
  try {
    scoreRows = await sql()`SELECT bid_id, win_probability, competition_level, agency_sentiment, size_fit, experience_match, similar_awards_note, naics_match, ai_explanation, generated_at FROM bid_scores WHERE user_id = ${user.id}`;
  } catch {
    // Fallback: old schema with match_score/naics_fit/similarity_notes/profitability_estimate
    const oldRows = await sql()`SELECT bid_id, match_score, competition_level, naics_fit, similarity_notes, profitability_estimate, ai_explanation, generated_at FROM bid_scores WHERE user_id = ${user.id}`;
    scoreRows = (oldRows as any[]).map((r: any) => ({
      bid_id: r.bid_id,
      win_probability: Number(r.match_score),
      competition_level: r.competition_level,
      agency_sentiment: r.naics_fit || '',
      size_fit: r.profitability_estimate || '',
      experience_match: r.similarity_notes || '',
      similar_awards_note: '',
      naics_match: '',
      ai_explanation: r.ai_explanation,
      generated_at: String(r.generated_at),
    }));
  }
  const scores: BidScore[] = (scoreRows as any[]).map((s) => ({ bid_id: s.bid_id, win_probability: Number(s.win_probability), competition_level: s.competition_level, agency_sentiment: s.agency_sentiment || '', size_fit: s.size_fit || '', experience_match: s.experience_match || '', similar_awards_note: s.similar_awards_note || '', naics_match: s.naics_match || '', ai_explanation: s.ai_explanation, generated_at: String(s.generated_at) }));

  await sql()`CREATE TABLE IF NOT EXISTS bid_recommendations (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, win_probability INTEGER, effort_level TEXT DEFAULT 'medium', competition_level TEXT DEFAULT 'medium', strategic_fit TEXT DEFAULT 'moderate', recommendation TEXT DEFAULT 'CAUTIOUS', summary TEXT DEFAULT '', factors JSONB DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
  const recommendationRows = await sql()`SELECT bid_id, bid_title, win_probability, effort_level, competition_level, strategic_fit, recommendation, summary, factors, created_at FROM bid_recommendations WHERE user_email = ${user.email}`;
  const recommendations: BidRecommendation[] = (recommendationRows as any[]).map((r) => ({ ...r, bid_id: String(r.bid_id), win_probability: r.win_probability == null ? null : Number(r.win_probability), factors: Array.isArray(r.factors) ? r.factors : [], created_at: String(r.created_at) }));

  const draftRows = await sql()`SELECT bid_id, draft_text, generated_at FROM proposal_drafts WHERE user_id = ${user.id}`;
  const drafts: ProposalDraft[] = (draftRows as any[]).map((d) => ({
    bid_id: d.bid_id,
    draft_text: d.draft_text,
    generated_at: String(d.generated_at),
  }));

  const syncRows = await sql()`SELECT created_at FROM sync_logs ORDER BY created_at DESC LIMIT 1`;
  const lastSynced = syncRows.length > 0 ? String(syncRows[0].created_at) : null;
  const countRows = await sql()`SELECT COUNT(*) as count FROM bids`;
  const totalBids = countRows.length > 0 ? Number(countRows[0].count) : 0;
  let lossesCount = 0;
  try { const lossRows = await sql()`SELECT COUNT(*) as count FROM bid_losses WHERE user_email = ${user.email}`; lossesCount = Number(lossRows[0]?.count || 0); } catch {}

  // Urgent tracked bids count (due within 3 days)
  let urgentTrackedCount = 0;
  try {
    await sql()`CREATE TABLE IF NOT EXISTS tracked_bids (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, agency TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'tracked', last_checked TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
    const urgentRows = await sql()`SELECT COUNT(*) as count FROM tracked_bids WHERE user_email = ${user.email} AND due_date::date <= (NOW() + INTERVAL '3 days')::date AND due_date::date >= NOW()::date`;
    urgentTrackedCount = Number(urgentRows[0]?.count || 0);
  } catch { /* tracking table may not exist yet */ }

  // Best-effort: generate deadline alert notifications for this user
  try { createDeadlineAlertsForUser(user.id, user.email).catch(() => {}); } catch { /* non-blocking */ }

  return { profile, bids, savedMatches, summaries, drafts, scores, recommendations, pricing: [], lastSynced, totalBids, lossesCount, urgentTrackedCount };
});

// ── Fetch tracked bid IDs for the current user ──────────────────────────────
const fetchTrackedBidIds = createServerFn({ method: "GET" }).handler(async (): Promise<string[]> => {
  const user = await getCurrentUser();
  if (!user) return [];
  try {
    await sql()`CREATE TABLE IF NOT EXISTS tracked_bids (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, agency TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'tracked', last_checked TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
    const rows = await sql()`SELECT bid_id FROM tracked_bids WHERE user_email = ${user.email}`;
    return (rows as any[]).map((r) => String(r.bid_id));
  } catch {
    return [];
  }
});

const getBidRecommendation = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as any;
    if (!d || typeof d.bid_title !== "string" || typeof d.bid_id !== "string" || typeof d.agency !== "string") throw new Error("Invalid recommendation input");
    return d;
  })
  .handler(async ({ data }) => {
    const user = await getCurrentUser(); if (!user) throw new Error("Not authenticated");
    await sql()`CREATE TABLE IF NOT EXISTS bid_recommendations (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, win_probability INTEGER, effort_level TEXT DEFAULT 'medium', competition_level TEXT DEFAULT 'medium', strategic_fit TEXT DEFAULT 'moderate', recommendation TEXT DEFAULT 'CAUTIOUS', summary TEXT DEFAULT '', factors JSONB DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
    const learningCtx = await getLearningContext(user.email, data.bid_title, data.agency, (data as any).naics_codes?.[0] || "", (data as any).estimated_value || "");
    const prompt = `You are an expert government contracting bid/no-bid advisor. Return ONLY JSON. Evaluate effort (RFP complexity/page count/specialized requirements), competition (agency type, contract size, set-aside hints), and strategic fit (NAICS, past awards, capabilities). Use exact enums: effort_level low|medium|high|extreme; competition_level low|medium|high; strategic_fit strong|moderate|weak; recommendation GO|NO_GO|CAUTIOUS. Return {recommendation, effort_level, competition_level, strategic_fit, summary, factors:[{factor,impact}]}.\nOpportunity: ${JSON.stringify(data)}\nProfile: ${JSON.stringify(data.user_profile || {})}\n\nLearned patterns from past wins/losses (use this to refine your recommendation):\n${learningCtx}`;
    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 700, temperature: 0.2 }) });
    if (!response.ok) throw new Error(`OpenAI API error (${response.status})`);
    const content = (await response.json() as any).choices?.[0]?.message?.content || ""; const match = content.match(/\{[\s\S]*\}/); if (!match) throw new Error("Could not parse recommendation");
    const p = JSON.parse(match[0]); const recommendation = ["GO", "NO_GO", "CAUTIOUS"].includes(p.recommendation) ? p.recommendation : "CAUTIOUS";
    const result: BidRecommendation = { bid_id: String(data.bid_id), bid_title: data.bid_title, win_probability: data.win_probability == null ? null : Number(data.win_probability), effort_level: ["low","medium","high","extreme"].includes(p.effort_level) ? p.effort_level : "medium", competition_level: ["low","medium","high"].includes(p.competition_level) ? p.competition_level : "medium", strategic_fit: ["strong","moderate","weak"].includes(p.strategic_fit) ? p.strategic_fit : "moderate", recommendation, summary: String(p.summary || "Review the opportunity details before deciding."), factors: Array.isArray(p.factors) ? p.factors.slice(0, 8).map((f: any) => ({ factor: String(f.factor || "Factor"), impact: String(f.impact || "neutral") })) : [], created_at: new Date().toISOString() };
    await sql()`INSERT INTO bid_recommendations (user_email,bid_id,bid_title,win_probability,effort_level,competition_level,strategic_fit,recommendation,summary,factors) VALUES (${user.email},${result.bid_id},${result.bid_title},${result.win_probability},${result.effort_level},${result.competition_level},${result.strategic_fit},${result.recommendation},${result.summary},${JSON.stringify(result.factors)}::jsonb) ON CONFLICT (user_email,bid_id) DO UPDATE SET bid_title=EXCLUDED.bid_title,win_probability=EXCLUDED.win_probability,effort_level=EXCLUDED.effort_level,competition_level=EXCLUDED.competition_level,strategic_fit=EXCLUDED.strategic_fit,recommendation=EXCLUDED.recommendation,summary=EXCLUDED.summary,factors=EXCLUDED.factors,created_at=NOW()`;
    return result;
  });

const scoreBid = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ bidId: (data as { bidId: number }).bidId, regenerate: Boolean((data as { regenerate?: boolean }).regenerate) }))
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    await sql()`CREATE TABLE IF NOT EXISTS bid_scores (id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, bid_id INTEGER NOT NULL REFERENCES bids(id), win_probability INTEGER NOT NULL, competition_level TEXT NOT NULL, agency_sentiment TEXT NOT NULL, size_fit TEXT NOT NULL DEFAULT '', experience_match TEXT NOT NULL, similar_awards_note TEXT NOT NULL DEFAULT '', ai_explanation TEXT NOT NULL, generated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, bid_id))`;
    // Backward compat ALTERs
    try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS win_probability INTEGER DEFAULT 50`; } catch {}
    try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS agency_sentiment TEXT DEFAULT ''`; } catch {}
    try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS size_fit TEXT DEFAULT ''`; } catch {}
    try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS experience_match TEXT DEFAULT ''`; } catch {}
    try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS similar_awards_note TEXT DEFAULT ''`; } catch {}
    try { await sql()`ALTER TABLE bid_scores ADD COLUMN IF NOT EXISTS naics_match TEXT DEFAULT ''`; } catch {}
    if (!data.regenerate) {
      let cached: any[];
      try {
        cached = await sql()`SELECT bid_id, win_probability, competition_level, agency_sentiment, size_fit, experience_match, similar_awards_note, naics_match, ai_explanation, generated_at FROM bid_scores WHERE user_id = ${user.id} AND bid_id = ${data.bidId}`;
      } catch {
        // Fallback: old schema
        const oldCached = await sql()`SELECT bid_id, match_score, competition_level, naics_fit, similarity_notes, profitability_estimate, ai_explanation, generated_at FROM bid_scores WHERE user_id = ${user.id} AND bid_id = ${data.bidId}`;
        if (oldCached.length) {
          const r = oldCached[0] as any;
          return { bid_id: r.bid_id, win_probability: Number(r.match_score), competition_level: r.competition_level, agency_sentiment: r.naics_fit || '', size_fit: r.profitability_estimate || '', experience_match: r.similarity_notes || '', similar_awards_note: '', naics_match: '', ai_explanation: r.ai_explanation, generated_at: String(r.generated_at) } as BidScore;
        }
        cached = [];
      }
      if (cached.length) { const r = cached[0] as any; return { bid_id: r.bid_id, win_probability: Number(r.win_probability), competition_level: r.competition_level, agency_sentiment: r.agency_sentiment || '', size_fit: r.size_fit || '', experience_match: r.experience_match || '', similar_awards_note: r.similar_awards_note || '', naics_match: r.naics_match || '', ai_explanation: r.ai_explanation, generated_at: String(r.generated_at) } as BidScore; }
    }
    const bids = await sql()`SELECT title, agency, description, category, location, estimated_value, due_date FROM bids WHERE id = ${data.bidId}`;
    if (!bids.length) throw new Error("Bid not found");
    const profiles = await sql()`SELECT industry, locations, service_categories, naics_codes FROM business_profiles WHERE user_id = ${user.id}`;
    if (!profiles.length) throw new Error("Business profile not found — complete onboarding first");
    const bid = bids[0] as any, profile = profiles[0] as any;
    const profileNaicsCodes: string[] = Array.isArray(profile.naics_codes) ? profile.naics_codes : [];
    const learningCtxScore = await getLearningContext(user.email, bid.title, bid.agency, profileNaicsCodes[0] || "", bid.estimated_value || "");
    const prompt = `You are a government contracting analyst estimating win probability for a small business. Analyze this opportunity and return ONLY valid JSON — no markdown, no code fences.

Consider these factors:
1. Number of likely competitors — is this a crowded category or niche? Fewer competitors means higher win probability.
2. Agency buying history — does this agency typically award to small businesses like this one?
3. Contract size — is this the right size for the user's business? Too large or too small lowers win probability.
4. Similar past awards — has this agency awarded similar contracts before? Established patterns increase confidence.
5. Your experience — does the user's profile/services match what's being asked for?
6. Past award winners — who usually wins these and why? Incumbent advantage, set-aside patterns, etc.
7. NAICS Code Match — how well do the user's NAICS codes align with this bid's category and description? NAICS codes are the standard industry classification for government contracting.

Return ONLY: {"win_probability": number 0-100, "competition_level":"Low"|"Moderate"|"High", "agency_sentiment":"...", "size_fit":"...", "experience_match":"...", "similar_awards_note":"...", "naics_match":"...", "ai_explanation":"..."}

Learned patterns from the user's win/loss history:\n${learningCtxScore}\n\nOpportunity: title=${bid.title}; agency=${bid.agency}; description=${bid.description || "Not provided"}; category=${bid.category}; location=${bid.location}; estimated value=${bid.estimated_value}; due date=${bid.due_date}
Business: industry=${profile.industry}; locations=${JSON.stringify(profile.locations)}; service categories=${JSON.stringify(profile.service_categories)}${profileNaicsCodes.length > 0 ? `; NAICS codes=${JSON.stringify(profileNaicsCodes)}` : ""}`;
    try {
      const apiKey = process.env.OPENAI_API_KEY; if (!apiKey) throw new Error("OpenAI API key not configured");
      const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 900, temperature: 0.2 }) });
      if (!response.ok) throw new Error(`OpenAI API error (${response.status})`);
      const json = await response.json() as any, content = json.choices?.[0]?.message?.content;
      const match = content?.match(/\{[\s\S]*\}/); if (!match) throw new Error("Could not parse AI response");
      const parsed = JSON.parse(match[0]);
      const score = { bid_id: data.bidId, win_probability: Math.max(0, Math.min(100, Math.round(Number(parsed.win_probability)))), competition_level: ["Low","Moderate","High"].includes(parsed.competition_level) ? parsed.competition_level : "Moderate", agency_sentiment: String(parsed.agency_sentiment || "No agency sentiment analysis provided."), size_fit: String(parsed.size_fit || "No size fit analysis provided."), experience_match: String(parsed.experience_match || "No experience match analysis provided."), similar_awards_note: String(parsed.similar_awards_note || "No similar awards data available."), naics_match: String(parsed.naics_match || "No NAICS code match analysis provided."), ai_explanation: String(parsed.ai_explanation || "No explanation provided."), generated_at: new Date().toISOString() } as BidScore;
      await sql()`INSERT INTO bid_scores (user_id, bid_id, win_probability, competition_level, agency_sentiment, size_fit, experience_match, similar_awards_note, naics_match, ai_explanation) VALUES (${user.id}, ${data.bidId}, ${score.win_probability}, ${score.competition_level}, ${score.agency_sentiment}, ${score.size_fit}, ${score.experience_match}, ${score.similar_awards_note}, ${score.naics_match}, ${score.ai_explanation}) ON CONFLICT (user_id, bid_id) DO UPDATE SET win_probability=EXCLUDED.win_probability, competition_level=EXCLUDED.competition_level, agency_sentiment=EXCLUDED.agency_sentiment, size_fit=EXCLUDED.size_fit, experience_match=EXCLUDED.experience_match, similar_awards_note=EXCLUDED.similar_awards_note, naics_match=EXCLUDED.naics_match, ai_explanation=EXCLUDED.ai_explanation, generated_at=NOW()`;
      await trackActivity(user.email, "scored_bid", data.bidId, `${score.win_probability}% Win Chance`);
      return score;
    } catch (err) { throw new Error(`Win probability analysis failed: ${err instanceof Error ? err.message : "AI request failed"}`); }
  });

interface DigestResult { entries: DigestEntry[]; hasRecentBids: boolean; }

// Curates recently created opportunities while reusing scoreBid's persisted scoring path.
const fetchDigest = createServerFn({ method: "GET" }).handler(async (): Promise<DigestResult> => {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  let activeIdForDigest: number | null = null; try { const ur = await sql()`SELECT active_profile_id FROM users WHERE id = ${user.id}`; activeIdForDigest = (ur[0] as any)?.active_profile_id ?? null; } catch {} const profiles = activeIdForDigest ? await sql()`SELECT id FROM business_profiles WHERE id = ${activeIdForDigest} AND user_id = ${user.id}` : await sql()`SELECT id FROM business_profiles WHERE user_id = ${user.id}`;
  if (!profiles.length) return { entries: [], hasRecentBids: false };

  const recent = await sql()`SELECT id, title, agency, estimated_value FROM bids WHERE created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 7`;
  if (!recent.length) return { entries: [], hasRecentBids: false };
  const scored: DigestEntry[] = [];
  for (const row of recent as any[]) {
    let scoreRows: any[] = [];
    try {
      scoreRows = await sql()`SELECT bid_id, win_probability, ai_explanation FROM bid_scores WHERE user_id = ${user.id} AND bid_id = ${row.id}`;
    } catch { /* scoreBid below will create/migrate the cache table */ }
    let score: any = scoreRows[0];
    if (!score) {
      try { score = await scoreBid({ data: { bidId: Number(row.id), regenerate: false } }); }
      catch { continue; }
    }
    const explanation = String(score.ai_explanation || "").trim();
    scored.push({
      bid_id: Number(row.id), title: String(row.title), agency: String(row.agency),
      estimated_value: String(row.estimated_value || "Not specified"),
      win_probability: Number(score.win_probability) || 0,
      reason: (explanation.split(/(?<=[.!?])\\s+/)[0] || "Strong fit for your business.").slice(0, 180),
    });
  }
  scored.sort((a, b) => b.win_probability - a.win_probability);
  return { entries: scored.slice(0, 5), hasRecentBids: true };
});

const saveBid = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ bidId: (data as { bidId: number }).bidId }))
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    await sql()`INSERT INTO saved_matches (user_id, bid_id, status) VALUES (${user.id}, ${data.bidId}, 'saved') ON CONFLICT (user_id, bid_id) DO UPDATE SET status = 'saved'`;
    await trackActivity(user.email, "saved_bid", data.bidId, "a bid");
    return { success: true };
  });

const dismissBid = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ bidId: (data as { bidId: number }).bidId }))
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    await sql()`INSERT INTO saved_matches (user_id, bid_id, status) VALUES (${user.id}, ${data.bidId}, 'dismissed') ON CONFLICT (user_id, bid_id) DO UPDATE SET status = 'dismissed'`;
    await trackActivity(user.email, "dismissed_bid", data.bidId);
    return { success: true };
  });

const generateSummary = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { bidId: number } }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    // Check cache
    const existing = await sql()`SELECT id FROM bid_summaries WHERE bid_id = ${data.bidId}`;
    if (existing.length > 0) {
      const s = await sql()`SELECT summary_text, key_requirements, generated_at FROM bid_summaries WHERE bid_id = ${data.bidId}`;
      const row = s[0] as any;
      return {
        bid_id: data.bidId,
        summary_text: row.summary_text,
        key_requirements: Array.isArray(row.key_requirements) ? row.key_requirements : [],
        generated_at: String(row.generated_at),
      };
    }

    // Fetch bid
    const bids = await sql()`SELECT title, agency, description, due_date, estimated_value FROM bids WHERE id = ${data.bidId}`;
    if (bids.length === 0) throw new Error("Bid not found");
    const bid = bids[0] as any;

    const prompt = `You are a government contracting expert. Summarize this bid opportunity in plain English for a small business owner. Include:
1. What the contract is for (2-3 sentences)
2. Key requirements and certifications needed (bullet points)
3. Important deadlines
4. Any red flags or special considerations
5. Estimated contract value if available

Format as JSON: { "summary": "...", "requirements": ["...", "..."], "deadline_notes": "...", "flags": "..." }

Bid details:
Title: ${bid.title}
Agency: ${bid.agency}
Description: ${bid.description || "Not provided"}
Due Date: ${String(bid.due_date)}
Estimated Value: ${bid.estimated_value || "Not specified"}`;

    let parsed: { summary: string; requirements: string[]; deadline_notes: string; flags: string };
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OpenAI API key not configured");

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 800,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${errBody.substring(0, 200)}`);
      }

      const json = await response.json() as any;
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error("No content in OpenAI response");

      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse JSON from AI response");
      parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.summary || !Array.isArray(parsed.requirements)) {
        throw new Error("Invalid AI response format");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI summary generation failed";
      throw new Error(`Summary generation failed: ${msg}`);
    }

    // Build full summary text
    const summaryText = [
      parsed.summary,
      parsed.deadline_notes ? `\nDeadlines: ${parsed.deadline_notes}` : "",
      parsed.flags ? `\nSpecial considerations: ${parsed.flags}` : "",
    ].filter(Boolean).join("\n");

    // Store in DB
    await sql()`INSERT INTO bid_summaries (bid_id, summary_text, key_requirements)
      VALUES (${data.bidId}, ${summaryText}, ${JSON.stringify(parsed.requirements)}::jsonb)
      ON CONFLICT (bid_id) DO UPDATE
      SET summary_text = ${summaryText}, key_requirements = ${JSON.stringify(parsed.requirements)}::jsonb, generated_at = NOW()`;

    return {
      bid_id: data.bidId,
      summary_text: summaryText,
      key_requirements: parsed.requirements,
      generated_at: new Date().toISOString(),
    };
  });

const generateProposal = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { bidId: number } }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    // Check cache
    const existing = await sql()`SELECT draft_text, generated_at FROM proposal_drafts WHERE bid_id = ${data.bidId} AND user_id = ${user.id}`;
    if (existing.length > 0) {
      const row = existing[0] as any;
      return { bid_id: data.bidId, draft_text: row.draft_text, generated_at: String(row.generated_at) };
    }

    // Fetch bid and business profile
    const bidRows = await sql()`SELECT title, agency, description, location, category, due_date, estimated_value FROM bids WHERE id = ${data.bidId}`;
    if (bidRows.length === 0) throw new Error("Bid not found");
    const bid = bidRows[0] as any;

    const profileRows = await sql()`SELECT business_name, industry, locations, service_categories FROM business_profiles WHERE user_id = ${user.id}`;
    if (profileRows.length === 0) throw new Error("Business profile not found — complete onboarding first");
    const profile = profileRows[0] as any;

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

Business:
Name: ${profile.business_name}
Industry: ${profile.industry}
Locations: ${JSON.stringify(profile.locations)}
Services: ${JSON.stringify(profile.service_categories)}`;

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
      VALUES (${data.bidId}, ${user.id}, ${draftText})
      ON CONFLICT (bid_id, user_id) DO UPDATE
      SET draft_text = ${draftText}, generated_at = NOW()`;
    await trackActivity(user.email, "drafted_proposal", data.bidId);

    return { bid_id: data.bidId, draft_text: draftText, generated_at: new Date().toISOString() };
  });

const downloadPdf = createServerFn({ method: "POST" }).validator((data: unknown) => {
  const bidId = Number((data as { bidId?: number }).bidId);
  if (!Number.isInteger(bidId) || bidId < 1) throw new Error("Invalid bid ID");
  return { bidId };
}).handler(async ({ data }): Promise<{ base64: string; filename: string }> => {
  const user = await getCurrentUser(); if (!user) throw new Error("Not authenticated");
  const rows = await sql()`SELECT p.draft_text, b.title, b.agency FROM proposal_drafts p JOIN bids b ON b.id = p.bid_id WHERE p.bid_id = ${data.bidId} AND p.user_id = ${user.id} LIMIT 1`;
  if (!rows.length) throw new Error("Proposal draft not found");
  const row = rows[0] as any, title = String(row.title || "Proposal Draft"), agency = String(row.agency || "");
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

  // White-label: check for agency branding
  let brandName = "Contrax";
  let logoBase64: string | null = null;
  try {
    const userRows = await sql()`SELECT active_profile_id FROM users WHERE id = ${user.id}`;
    const activeId = (userRows[0] as any)?.active_profile_id ?? null;
    const bpRows = activeId
      ? await sql()`SELECT business_name, logo_url, logo_data FROM business_profiles WHERE id = ${activeId} AND user_id = ${user.id}`
      : await sql()`SELECT business_name, logo_url, logo_data FROM business_profiles WHERE user_id = ${user.id} ORDER BY created_at LIMIT 1`;
    if (bpRows.length) {
      const bp = bpRows[0] as any;
      if (bp.business_name) brandName = bp.business_name;
      if (bp.logo_data) logoBase64 = bp.logo_data;
      else if (bp.logo_url && bp.logo_url.startsWith("data:")) logoBase64 = bp.logo_url;
    }
  } catch { /* non-critical: fall back to Contrax branding */ }

  // Generate PDF using jsPDF
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = 612, pageH = 792;
  let y = 50;

  if (logoBase64) {
    try {
      const imgData = logoBase64.includes("base64,") ? logoBase64.split("base64,")[1] : logoBase64;
      doc.addImage(imgData, "PNG", 50, y, 40, 40);
      y += 8;
    } catch { /* skip invalid logo */ }
  }
  y += 38;

  doc.setFontSize(20);
  doc.setTextColor(20, 30, 50);
  doc.text(brandName, 50, y);
  y += 28;

  doc.setFontSize(14);
  doc.setTextColor(30, 40, 60);
  doc.text(title, 50, y);
  y += 20;

  doc.setFontSize(11);
  doc.setTextColor(80, 90, 110);
  doc.text(agency, 50, y);
  y += 18;

  doc.setFontSize(10);
  doc.setTextColor(120, 130, 140);
  doc.text("Prepared " + date, 50, y);
  y += 30;

  doc.setDrawColor(200, 205, 210);
  doc.line(50, y, pageW - 50, y);
  y += 20;

  doc.setFontSize(10);
  doc.setTextColor(40, 45, 55);
  const draftText = String(row.draft_text || "");
  const lines = draftText.split(/\r?\n/);
  for (const line of lines) {
    if (y > pageH - 60) { doc.addPage(); y = 50; }
    const wrapped = doc.splitTextToSize(line, pageW - 100);
    for (const w of wrapped) {
      if (y > pageH - 60) { doc.addPage(); y = 50; }
      doc.text(w, 50, y);
      y += 14;
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.setTextColor(115, 120, 135);
    doc.text(brandName + " - AI-assisted proposal draft", 50, pageH - 30);
    doc.text("Page " + i + " of " + pageCount, pageW - 80, pageH - 30);
  }

  const pdfOutput = doc.output("arraybuffer");
  const base64 = btoa(String.fromCharCode(...new Uint8Array(pdfOutput)));
  const filename = "proposal-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) + ".pdf";
  return { base64, filename };
});
const handleLogout = createServerFn({ method: "POST" }).handler(async () => logout());
export interface TrialStatus { active: boolean; daysLeft: number; expired: boolean; }
export const checkTrial = createServerFn({ method: "GET" }).handler(async (): Promise<TrialStatus> => {
 const user = await getCurrentUser(); if (!user) return {active:false,daysLeft:0,expired:false};
 const rows = await sql()`SELECT plan_tier, trial_started_at FROM users WHERE id=${user.id}`; const r=rows[0] as any;
 if (r?.plan_tier && r.plan_tier !== "trial") return {active:false,daysLeft:0,expired:false};
 const daysLeft = r?.trial_started_at ? Math.max(0, Math.ceil((21*86400000-(Date.now()-new Date(r.trial_started_at).getTime()))/86400000)) : 0;
 return {active:daysLeft>0,daysLeft,expired:daysLeft<=0};
});

// ── Route ────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/dashboard")({
  loader: () => getCurrentUser(),
  component: DashboardPage,
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function daysUntil(d: string) { return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function fmtDateTime(d: string) { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
function countdown(days: number) {
  if (days < 0) return { bg: "bg-slate-100", text: "text-slate-600", label: "Closed" };
  if (days <= 7) return { bg: "bg-red-100", text: "text-red-700", label: `${days}d left` };
  if (days <= 21) return { bg: "bg-amber-100", text: "text-amber-700", label: `${days}d left` };
  return { bg: "bg-green-100", text: "text-green-700", label: `${days}d left` };
}
function recommendationStyle(rec: BidRecommendation | undefined) {
  if (!rec) return { label: "Recommendation pending", detail: "Run win probability analysis to get an AI recommendation.", bg: "bg-slate-100", text: "text-slate-600", border: "border-slate-200", dot: "⚪" };
  if (rec.recommendation === "GO") return { label: "GO", detail: "Recommended — strong fit, manageable competition", bg: "bg-green-100", text: "text-green-700", border: "border-green-200", dot: "🟢" };
  if (rec.recommendation === "NO_GO") return { label: "NO-GO", detail: "Skip — poor fit or excessive competition", bg: "bg-red-100", text: "text-red-700", border: "border-red-200", dot: "🔴" };
  return { label: "CAUTIOUS", detail: "Proceed carefully — mixed signals", bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-200", dot: "🟡" };
}
function levelStyle(level: string) { return level === "low" || level === "strong" ? "bg-green-100 text-green-700" : level === "high" || level === "extreme" || level === "weak" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"; }
function matchBid(bid: Bid, profile: BusinessProfile): boolean {
  const cat = bid.category.toLowerCase();
  const ind = profile.industry.toLowerCase();
  const catMatch = cat === ind || ind.includes(cat) || cat.includes(ind);
  const locMatch = profile.locations.some((l) => bid.location.toLowerCase().includes(l.toLowerCase()));
  return catMatch || locMatch;
}

// ── Upgrade Banner ────────────────────────────────────────────────────────────

function UpgradeBanner() {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("contrax_upgrade_banner_dismissed") === "true";
    }
    return false;
  });

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem("contrax_upgrade_banner_dismissed", "true");
  };

  if (dismissed) return null;

  return (
    <div className="mb-6 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100">
            <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-blue-900">
              You&rsquo;re on the free plan.{" "}
              <button
                type="button"
                onClick={() => redirectToCheckout("professional")}
                className="font-semibold text-blue-700 underline hover:text-blue-500 transition-colors"
              >
                Upgrade to Professional &rarr;
              </button>
            </p>
            <p className="mt-0.5 text-xs text-blue-600/70">
              Unlock AI proposal drafting, unlimited bids, and priority support.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 rounded-lg p-1.5 text-blue-400 hover:bg-blue-100 hover:text-blue-600 transition-colors"
          aria-label="Dismiss upgrade banner"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Loading Skeleton ─────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white"><div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between"><div className="h-8 w-28 bg-slate-200 rounded-lg animate-pulse" /><div className="h-5 w-16 bg-slate-200 rounded animate-pulse" /></div></header>
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
          <div className="h-7 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="flex gap-2"><div className="h-6 w-20 bg-slate-200 rounded-full animate-pulse" /><div className="h-6 w-10 bg-slate-200 rounded-full animate-pulse" /><div className="h-6 w-10 bg-slate-200 rounded-full animate-pulse" /></div>
        </div>
        <div className="space-y-4">
          {[1,2,3].map((i) => (<div key={i} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3"><div className="h-5 w-3/4 bg-slate-200 rounded animate-pulse" /><div className="h-4 w-1/3 bg-slate-100 rounded animate-pulse" /><div className="flex gap-4"><div className="h-4 w-24 bg-slate-100 rounded animate-pulse" /><div className="h-4 w-32 bg-slate-100 rounded animate-pulse" /></div></div>))}
        </div>
      </main>
    </div>
  );
}

// ── Deadline Alert Banner ────────────────────────────────────────────────────
function DeadlineAlertBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="mb-6 rounded-2xl border-2 border-red-200 bg-gradient-to-r from-red-50 to-rose-50 p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="font-bold text-red-800">{count} bid{count !== 1 ? "s" : ""} closing soon</p>
            <p className="text-sm text-red-700">Tracked bids due within 3 days. Review them now to avoid missing deadlines.</p>
          </div>
        </div>
        <a href="/tracking" className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 active:scale-[0.98] transition-all">
          View Now →
        </a>
      </div>
    </div>
  );
}

function TrialBanner({daysLeft}:{daysLeft:number}) { return <div className="mx-auto max-w-5xl px-4 pt-4"><div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><strong>Your 21-day trial</strong> · {daysLeft} day{daysLeft===1?"":"s"} left <a className="ml-2 font-semibold underline" href="/upgrade">Subscribe now →</a></div></div>; }
function TrialExpired() { return <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4"><div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm"><h1 className="text-2xl font-bold text-slate-900">Your trial has ended</h1><p className="mt-3 text-slate-600">Subscribe to continue using Contrax.</p><a href="/upgrade" className="mt-7 inline-flex rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white">View plans →</a></div></div>; }

// ── Component ────────────────────────────────────────────────────────────────
function DashboardPage() {
  const currentUser = Route.useLoaderData() as AuthUser | null;
  const navigate = useNavigate();

  if (!currentUser) {
    navigate({ to: "/login" });
    return null;
  }

  const [trial, setTrial] = useState<TrialStatus | null>(null);
  useEffect(() => { checkTrial().then(setTrial).catch(() => {}); }, []);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [digest, setDigest] = useState<DigestResult | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);

  const [savedBids, setSavedBids] = useState<Set<number>>(new Set());
  const [dismissedBids, setDismissedBids] = useState<Set<number>>(new Set());
  const [trackedBidIds, setTrackedBidIds] = useState<Set<string>>(new Set());
  const [expandedBid, setExpandedBid] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Record<number, string>>({});
  const [sortBy, setSortBy] = useState<"due_date" | "newest" | "value">("due_date");
  const [loggingOut, setLoggingOut] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [trackingLoading, setTrackingLoading] = useState<Set<number>>(new Set());

  // AI state
  const [summaries, setSummaries] = useState<Record<number, BidSummary>>({});
  const [drafts, setDrafts] = useState<Record<number, ProposalDraft>>({});
  const [scores, setScores] = useState<Record<number, BidScore>>({});
  const [recommendations, setRecommendations] = useState<Record<number, BidRecommendation>>({});
  const [pricing, setPricing] = useState<Record<number, PricingRecommendation>>({});
  const [scoring, setScoring] = useState<Set<number>>(new Set());
  const [pricingLoading, setPricingLoading] = useState<Set<number>>(new Set());
  const [generatingSummary, setGeneratingSummary] = useState<Set<number>>(new Set());
  const [generatingProposal, setGeneratingProposal] = useState<Set<number>>(new Set());
  const [downloadingPdf, setDownloadingPdf] = useState<Set<number>>(new Set());
  const [aiError, setAiError] = useState<Record<number, string>>({});

  if (trial?.expired) return <TrialExpired />;
  useEffect(() => {
    let cancelled = false;
    fetchDashboardData().then((d) => {
      if (!cancelled) {
        setData(d);
        setSavedBids(new Set(d.savedMatches.filter((m) => m.status === "saved").map((m) => m.bid_id)));
        setDismissedBids(new Set(d.savedMatches.filter((m) => m.status === "dismissed").map((m) => m.bid_id)));
        // Populate summaries and drafts from initial load
        const sumMap: Record<number, BidSummary> = {};
        d.summaries.forEach((s) => { sumMap[s.bid_id] = s; });
        setSummaries(sumMap);
        const draftMap: Record<number, ProposalDraft> = {};
        d.drafts.forEach((d) => { draftMap[d.bid_id] = d; });
        setDrafts(draftMap);
        const scoreMap: Record<number, BidScore> = {};
        d.scores.forEach((s) => { scoreMap[s.bid_id] = s; });
        setScores(scoreMap);
        const recMap: Record<number, BidRecommendation> = {};
        d.recommendations.forEach((r) => { recMap[Number(r.bid_id)] = r; });
        setRecommendations(recMap);
        setLoading(false);
        // Load cached pricing recommendations
        fetchPricingCache().then((pricingList) => {
          const pricingMap: Record<number, PricingRecommendation> = {};
          pricingList.forEach((p) => { pricingMap[Number(p.bid_id)] = p; });
          setPricing(pricingMap);
        }).catch(() => {});
      }
    }).catch((err) => {
      if (!cancelled) {
        setLoadError(err instanceof Error ? err.message : "Failed to load dashboard");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Fetch tracked bid IDs
  useEffect(() => {
    let cancelled = false;
    fetchTrackedBidIds().then((ids) => {
      if (!cancelled) setTrackedBidIds(new Set(ids));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!data?.profile) return;
    let cancelled = false;
    setDigestLoading(true);
    fetchDigest().then((result) => { if (!cancelled) setDigest(result); })
      .catch(() => { if (!cancelled) setDigest({ entries: [], hasRecentBids: false }); })
      .finally(() => { if (!cancelled) setDigestLoading(false); });
    return () => { cancelled = true; };
  }, [data?.profile]);

  const profile = data?.profile ?? null;
  const bids = data?.bids ?? [];
  const urgentTrackedCount = data?.urgentTrackedCount ?? 0;

  const filtered = profile ? bids.filter((b) => matchBid(b, profile) && !dismissedBids.has(b.id)) : [];
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "newest") return new Date(b.due_date).getTime() - new Date(a.due_date).getTime();
    if (sortBy === "value") return (b.estimated_value?.length || 0) - (a.estimated_value?.length || 0);
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });

  const doSave = useCallback(async (bidId: number) => {
    setActionLoading(bidId);
    try {
      await saveBid({ data: { bidId } });
      setSavedBids((p) => new Set(p).add(bidId));
      setDismissedBids((p) => { const n = new Set(p); n.delete(bidId); return n; });
    } catch {} finally { setActionLoading(null); }
  }, []);

  const doDismiss = useCallback(async (bidId: number) => {
    setActionLoading(bidId);
    try {
      await dismissBid({ data: { bidId } });
      setDismissedBids((p) => new Set(p).add(bidId));
      setSavedBids((p) => { const n = new Set(p); n.delete(bidId); return n; });
      if (expandedBid === bidId) setExpandedBid(null);
    } catch {} finally { setActionLoading(null); }
  }, [expandedBid]);

  // Track / Untrack handlers
  const doTrack = useCallback(async (bid: Bid) => {
    setTrackingLoading((p) => new Set(p).add(bid.id));
    try {
      await trackBid({ data: { bid_id: String(bid.id), bid_title: bid.title, agency: bid.agency, due_date: bid.due_date } });
      setTrackedBidIds((p) => new Set(p).add(String(bid.id)));
    } catch {} finally {
      setTrackingLoading((p) => { const n = new Set(p); n.delete(bid.id); return n; });
    }
  }, []);

  const doUntrack = useCallback(async (bidId: number) => {
    setTrackingLoading((p) => new Set(p).add(bidId));
    try {
      await untrackBid({ data: { bid_id: String(bidId) } });
      setTrackedBidIds((p) => { const n = new Set(p); n.delete(String(bidId)); return n; });
    } catch {} finally {
      setTrackingLoading((p) => { const n = new Set(p); n.delete(bidId); return n; });
    }
  }, []);

  const doGenerateSummary = useCallback(async (bidId: number) => {
    setGeneratingSummary((p) => new Set(p).add(bidId));
    setAiError((p) => { const n = { ...p }; delete n[bidId]; return n; });
    try {
      const result = await generateSummary({ data: { bidId } });
      setSummaries((p) => ({ ...p, [bidId]: result }));
      setActiveTab((p) => ({ ...p, [bidId]: "summary" }));
    } catch (err) {
      setAiError((p) => ({ ...p, [bidId]: err instanceof Error ? err.message : "Summary generation failed" }));
    } finally {
      setGeneratingSummary((p) => { const n = new Set(p); n.delete(bidId); return n; });
    }
  }, []);

  const doGenerateProposal = useCallback(async (bidId: number) => {
    setGeneratingProposal((p) => new Set(p).add(bidId));
    setAiError((p) => { const n = { ...p }; delete n[bidId]; return n; });
    try {
      const result = await generateProposal({ data: { bidId } });
      setDrafts((p) => ({ ...p, [bidId]: result }));
      setActiveTab((p) => ({ ...p, [bidId]: "draft" }));
    } catch (err) {
      setAiError((p) => ({ ...p, [bidId]: err instanceof Error ? err.message : "Proposal generation failed" }));
    } finally {
      setGeneratingProposal((p) => { const n = new Set(p); n.delete(bidId); return n; });
    }
  }, []);

  const doDownloadPdf = useCallback(async (bid: Bid) => {
    setDownloadingPdf((p) => new Set(p).add(bid.id));
    try {
      const result = await downloadPdf({ data: { bidId: bid.id } });
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.filename; anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) { setAiError((p) => ({ ...p, [bid.id]: err instanceof Error ? err.message : "PDF download failed" })); }
    finally { setDownloadingPdf((p) => { const n = new Set(p); n.delete(bid.id); return n; }); }
  }, []);

  const doScore = useCallback(async (bidId: number, regenerate = false) => {
    setScoring((p) => new Set(p).add(bidId));
    setAiError((p) => { const n = { ...p }; delete n[bidId]; return n; });
    try { const result = await scoreBid({ data: { bidId, regenerate } }); setScores((p) => ({ ...p, [bidId]: result })); setActiveTab((p) => ({ ...p, [bidId]: "score" }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      const bid = bids.find((b) => b.id === bidId);
      if (bid && profile) {
        const rec = await getBidRecommendation({ data: { bid_title: bid.title, bid_id: String(bid.id), agency: bid.agency, description: bid.description, estimated_value: bid.estimated_value, naics_codes: profile.naics_codes, user_profile: profile, win_probability: result.win_probability } });
        setRecommendations((p) => ({ ...p, [bidId]: rec }));
        await new Promise((r) => setTimeout(r, 300));
        getPricingRecommendation({ data: { bid_title: bid.title, bid_id: String(bid.id), agency: bid.agency, description: bid.description, estimated_value: bid.estimated_value, naics_codes: profile.naics_codes } }).then((pr) => setPricing((pp) => ({ ...pp, [bidId]: pr }))).catch(() => {});
      }
    }
    catch (err) { setAiError((p) => ({ ...p, [bidId]: err instanceof Error ? err.message : "Score generation failed" })); }
    finally { setScoring((p) => { const n = new Set(p); n.delete(bidId); return n; }); }
  }, [bids, profile]);

  const doPricing = useCallback(async (bidId: number, bid: Bid) => {
    setPricingLoading((p) => new Set(p).add(bidId));
    setAiError((p) => { const n = { ...p }; delete n[bidId]; return n; });
    try {
      const result = await getPricingRecommendation({ data: { bid_title: bid.title, bid_id: String(bid.id), agency: bid.agency, description: bid.description, estimated_value: bid.estimated_value, naics_codes: profile?.naics_codes || [] } });
      setPricing((p) => ({ ...p, [bidId]: result }));
    } catch (err) {
      setAiError((p) => ({ ...p, [bidId]: err instanceof Error ? err.message : "Pricing analysis failed" }));
    } finally {
      setPricingLoading((p) => { const n = new Set(p); n.delete(bidId); return n; });
    }
  }, [profile]);

  useEffect(() => {
    if (!data?.profile) return;
    const pending = bids.filter((b) => !scores[b.id] && !scoring.has(b.id)).slice(0, 5);
    if (pending.length) { pending.forEach((b, i) => setTimeout(() => doScore(b.id), i * 350)); }
  }, [data, scores, doScore]);

  const [copiedBid, setCopiedBid] = useState<number | null>(null);
  const doCopyDraft = useCallback(async (bidId: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBid(bidId);
      setTimeout(() => setCopiedBid(null), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedBid(bidId);
      setTimeout(() => setCopiedBid(null), 2000);
    }
  }, []);

  if (loading) return <LoadingSkeleton />;

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-500">{loadError}</p>
          <a href="/dashboard" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-500">Try again</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900">
              <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-900">Contrax</span>
          </a>
          <div className="flex items-center gap-4">
            <a href="/tracking" className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">
              📅 Tracking
              {urgentTrackedCount > 0 && (
                <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">{urgentTrackedCount}</span>
              )}
            </a>
            <a href="/workspace" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Team</a>
            <a href="/awards" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Awards</a>
            <a href="/trends" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">📊 Trends</a>
            <a href="/partners" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Partners</a>
            <a href="/losses" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Losses</a>
            <a href="/learnings" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">🧠 Learnings</a>
            <a href="/compliance" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Compliance</a>
              <a href="/admin" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Admin</a>
            <span className="text-sm text-slate-500 hidden sm:inline">{currentUser.email}</span>
            <button
              type="button"
              onClick={async () => { setLoggingOut(true); try { await handleLogout(); navigate({ to: "/" }); } catch { setLoggingOut(false); } }}
              disabled={loggingOut}
              className="text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              {loggingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* Deadline Alert Banner */}
        <DeadlineAlertBanner count={urgentTrackedCount} />

        {/* Profile Summary */}
        {profile ? (
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-2">
                <h1 className="text-2xl font-bold text-slate-900">{profile.business_name}</h1>
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">{profile.industry}</span>
                  {profile.locations.map((loc) => (
                    <span key={loc} className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{loc}</span>
                  ))}
                </div>
              </div>
              <a href="/onboarding" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.98]">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                Edit Profile
              </a>
            </div>
            {profile.service_categories.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400 mb-2">Services</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.service_categories.map((svc) => (
                    <span key={svc} className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-600">{svc}</span>
                  ))}
                </div>
              </div>
            )}
            {profile.naics_codes && profile.naics_codes.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400 mb-2">NAICS Codes</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.naics_codes.map((code) => (
                    <span key={code} className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-mono font-medium text-slate-600">{code}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-amber-800">Complete your profile</h2>
                <p className="mt-1 text-sm text-amber-700">Tell us about your business so we can find contracts that match your services and locations.</p>
              </div>
              <a href="/onboarding" className="inline-flex items-center rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-amber-600 active:scale-[0.98]">Set Up Profile &rarr;</a>
            </div>
          </div>
        )}

        <a href="/losses" className="mb-4 block rounded-2xl border border-purple-100 bg-white p-5 shadow-sm transition hover:border-purple-300"><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Why You Lost</h2><p className="mt-1 text-sm text-slate-500">{data?.lossesCount || 0} lost bid{data?.lossesCount === 1 ? "" : "s"} analyzed · track recurring weaknesses</p></div><span className="text-purple-600">View losses →</span></div></a>
        <a href="/learnings" className="mb-8 block rounded-2xl border border-green-200 bg-white p-5 shadow-sm transition hover:border-green-400"><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">🧠 Learning Engine</h2><p className="mt-1 text-sm text-slate-500">Win/loss patterns feed back into AI — smarter predictions with every outcome</p></div><span className="text-green-600">View learnings →</span></div></a>

        {/* Daily AI Digest */}
        {profile && (
          <section className="mb-8" aria-labelledby="digest-heading">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 id="digest-heading" className="text-xl font-bold text-slate-900">✨ Today&apos;s Top Opportunities</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {digestLoading ? "Analyzing today&apos;s opportunities..." : digest?.hasRecentBids
                    ? `We analyzed today&apos;s bids and found ${digest.entries.length} worth your attention.`
                    : "No new opportunities today. Check back tomorrow."}
                </p>
              </div>
            </div>
            {digestLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500 shadow-sm">Analyzing today&apos;s opportunities...</div>
            ) : digest?.entries.length ? (
              <div className="space-y-3">
                {digest.entries.map((entry) => {
                  const color = entry.win_probability >= 80 ? "text-green-600 bg-green-50 border-green-200" : entry.win_probability >= 50 ? "text-amber-600 bg-amber-50 border-amber-200" : "text-red-600 bg-red-50 border-red-200";
                  return <button key={entry.bid_id} type="button" onClick={() => { setExpandedBid(entry.bid_id); if (!scores[entry.bid_id]) doScore(entry.bid_id); }} className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md">
                    <div className="flex items-center gap-4">
                      <div className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border ${color}`}><span className="text-2xl font-bold leading-none">{entry.win_probability}%</span><span className="mt-1 text-[10px] font-semibold uppercase tracking-wide">win chance</span></div>
                      <div className="min-w-0 flex-1"><h3 className="truncate font-semibold text-slate-900">{entry.title}</h3><p className="mt-0.5 truncate text-sm text-slate-500">{entry.agency}</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"><span className="font-medium text-slate-700">{entry.estimated_value}</span><span className="truncate">{entry.reason}</span></div></div>
                      <svg className="hidden h-5 w-5 shrink-0 text-slate-400 sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </div>
                  </button>;
                })}
              </div>
            ) : null}
          </section>
        )}

        {/* Upgrade Banner */}
        {trial?.active && <TrialBanner daysLeft={trial.daysLeft} />}

        {/* Bid Matches */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Your Bid Matches</h2>
            <p className="mt-1 text-sm text-slate-500">
              {profile ? `${sorted.length} bid${sorted.length !== 1 ? "s" : ""} matching your profile` : "Set up your profile to see matching bids"}
              {data?.totalBids ? ` (${data.totalBids} total in database)` : ""}
            </p>
            {data?.lastSynced && (
              <p className="mt-0.5 text-xs text-slate-400">
                Last synced: {fmtDate(data.lastSynced)} at {new Date(data.lastSynced).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </p>
            )}
          </div>
          {profile && sorted.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="sort" className="text-sm font-medium text-slate-600">Sort by:</label>
              <select id="sort" value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white">
                <option value="due_date">Due date (closest)</option>
                <option value="newest">Newest</option>
                <option value="value">Highest value</option>
              </select>
            </div>
          )}
        </div>

        {/* Bid Cards */}
        {!profile ? (
          <div className="text-center py-12"><p className="text-slate-400">No profile yet — complete your onboarding to see bid matches.</p></div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-12 rounded-2xl border border-slate-200 bg-white">
            <svg className="mx-auto h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
            <h3 className="mt-4 text-lg font-semibold text-slate-700">No matching bids yet</h3>
            <p className="mt-1 text-sm text-slate-500">Try expanding your locations or service categories in your profile.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sorted.map((bid) => {
              const days = daysUntil(bid.due_date);
              const cd = countdown(days);
              const isExpanded = expandedBid === bid.id;
              const isSaved = savedBids.has(bid.id);
              const isTracked = trackedBidIds.has(String(bid.id));
              const isLoading = actionLoading === bid.id;
              const isTracking = trackingLoading.has(bid.id);
              const currentTab = activeTab[bid.id] || "details";
              const score = scores[bid.id];
              const recommendation = recommendations[bid.id];
              const recStyle = recommendationStyle(recommendation);
              const summary = summaries[bid.id];
              const draft = drafts[bid.id];
              const isScoring = scoring.has(bid.id);
              const isGenSummary = generatingSummary.has(bid.id);
              const isGenProposal = generatingProposal.has(bid.id);
              const errMsg = aiError[bid.id];

              return (
                <div key={bid.id} className={`rounded-2xl border bg-white shadow-sm transition-all ${isExpanded ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}>
                  <button type="button" onClick={() => setExpandedBid(isExpanded ? null : bid.id)} className="w-full text-left p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-slate-900 truncate">{bid.title}</h3>
                          <p className="mt-0.5 text-sm text-slate-500">{bid.agency}</p>
                        </div>
                        {/* Track toggle */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); isTracked ? doUntrack(bid.id) : doTrack(bid); }}
                          disabled={isTracking}
                          className={`shrink-0 rounded-full px-2 py-1 text-sm transition-colors ${isTracked ? "text-amber-500 hover:text-amber-600" : "text-slate-300 hover:text-amber-400"}`}
                          title={isTracked ? "Untrack this bid" : "Track this bid"}
                        >
                          {isTracking ? "⏳" : isTracked ? "🔖" : "🔖"}
                        </button>
                        {recommendation ? <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${recStyle.bg} ${recStyle.text}`}>{recStyle.dot} {recStyle.label}</span> : score ? <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${score.win_probability >= 80 ? "bg-green-100 text-green-700" : score.win_probability >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{score.win_probability}% Win Chance</span> : <button type="button" onClick={(e) => { e.stopPropagation(); doScore(bid.id); }} disabled={isScoring} className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500 hover:bg-blue-50 hover:text-blue-600">{isScoring ? "Analyzing…" : "Win Odds"}</button>}
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${cd.bg} ${cd.text}`}>{cd.label}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          Due {fmtDate(bid.due_date)}
                        </span>
                        {isTracked && <span className="inline-flex items-center gap-1 text-amber-600 font-medium text-xs">🔖 Tracked</span>}
                        <span className="inline-flex items-center gap-1">
                          <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          {bid.location}
                        </span>
                        <span className="font-medium text-slate-700">{bid.estimated_value}</span>
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{bid.category}</span>
                      </div>
                    </div>
                    <svg className={`hidden sm:block h-5 w-5 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-100">
                      <div className="flex justify-end px-5 pt-4"><a href={`/partners?bid_id=${bid.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600">Find Partners <span aria-hidden="true">→</span></a></div>
                      {/* Bid / No-Bid recommendation banner */}
                      <div className={`mx-5 mt-4 rounded-xl border ${recStyle.border} ${recStyle.bg} px-4 py-3`} aria-label="Bid recommendation">
                        <div className="flex flex-wrap items-center gap-2"><span className="text-lg">{recStyle.dot}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${recStyle.bg} ${recStyle.text}`}>{recStyle.label}</span><span className="text-sm font-medium text-slate-700">{recStyle.detail}</span></div>
                        {recommendation?.summary && <p className="mt-1.5 text-sm text-slate-600">{recommendation.summary}</p>}
                      </div>
                      {/* Tabs */}
                      <div className="flex border-b border-slate-100 px-5">
                        {[
                          { key: "details", label: "Details" },
                          { key: "score", label: "Win Probability", badge: score ? "✓" : null },
                          { key: "recommendation", label: "Recommendation", badge: recommendation ? "✓" : null },
                          { key: "pricing", label: "Pricing", badge: pricing[bid.id] ? "✓" : null },
                          { key: "summary", label: "AI Summary", badge: summary ? "✓" : null },
                          { key: "draft", label: "Proposal Draft", badge: draft ? "✓" : null },
                        ].map((tab) => (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveTab((p) => ({ ...p, [bid.id]: tab.key }))}
                            className={`relative px-4 py-3 text-sm font-medium transition-colors ${
                              currentTab === tab.key
                                ? "text-blue-600"
                                : "text-slate-500 hover:text-slate-700"
                            }`}
                          >
                            <span className="inline-flex items-center gap-1.5">
                              {tab.label}
                              {tab.badge && (
                                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-100 text-[10px] font-bold text-green-600">{tab.badge}</span>
                              )}
                            </span>
                            {currentTab === tab.key && (
                              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t" />
                            )}
                          </button>
                        ))}
                      </div>

                      {/* Tab Content — KEEPING EXISTING TAB CONTENT EXACTLY AS BEFORE */}
                      <div className="px-5 pb-5 pt-4">
                        {errMsg && (
                          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                            {errMsg}
                            <button type="button" onClick={() => setAiError((p) => { const n = { ...p }; delete n[bid.id]; return n; })} className="ml-2 underline hover:no-underline">Dismiss</button>
                          </div>
                        )}

                        {/* Details Tab */}
                        {currentTab === "details" && (
                          <div className="space-y-4">
                            <div><p className="text-sm font-medium text-slate-600 mb-1">Description</p><p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{bid.description}</p></div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                              <div><p className="font-medium text-slate-500">Agency</p><p className="text-slate-800">{bid.agency}</p></div>
                              <div><p className="font-medium text-slate-500">Due Date</p><p className="text-slate-800">{fmtDate(bid.due_date)}</p></div>
                              <div><p className="font-medium text-slate-500">Est. Value</p><p className="text-slate-800">{bid.estimated_value}</p></div>
                              <div><p className="font-medium text-slate-500">Category</p><p className="text-slate-800">{bid.category}</p></div>
                            </div>
                            {bid.source_url && (
                              <div><a href={bid.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-500">View source posting<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg></a></div>
                            )}
                          </div>
                        )}

                        {/* Recommendation Tab */}
                        {currentTab === "recommendation" && (
                          <div className="space-y-4">
                            <div className={`rounded-xl border ${recStyle.border} ${recStyle.bg} p-5`}>
                              <div className="flex flex-wrap items-center gap-3"><span className="text-2xl">{recStyle.dot}</span><span className={`rounded-full px-3 py-1 text-sm font-bold ${recStyle.bg} ${recStyle.text}`}>{recStyle.label}</span><span className="text-sm font-medium text-slate-700">{recStyle.detail}</span></div>
                              <p className="mt-3 text-sm text-slate-700">{recommendation?.summary || "Recommendation will be generated after win probability analysis."}</p>
                            </div>
                            {recommendation ? <><div className="grid gap-3 sm:grid-cols-3">{[["Effort estimate", recommendation.effort_level], ["Competition", recommendation.competition_level], ["Strategic fit", recommendation.strategic_fit]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-100 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-bold capitalize ${levelStyle(value)}`}>{value}</span></div>)}</div><div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Key factors</p><div className="space-y-2">{recommendation.factors.map((f, i) => <div key={i} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-white p-3 text-sm"><span className="text-slate-700">{f.factor}</span><span className="shrink-0 font-semibold text-slate-500">{f.impact}</span></div>)}</div></div><p className="text-xs text-slate-400">Generated {fmtDateTime(recommendation.created_at)}</p><a href={`/partners?bid_id=${bid.id}`} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100">View suggested partners →</a></> : <div className="py-8 text-center text-sm text-slate-500">Run win probability analysis to generate a recommendation.</div>}
                          </div>
                        )}

                        {/* Pricing Tab */}
                        {currentTab === "pricing" && (
                          <div>
                            {pricing[bid.id] ? (() => {
                              const p = pricing[bid.id];
                              const rangeSpan = p.suggested_high - p.suggested_low;
                              const medPct = rangeSpan > 0 ? ((p.suggested_median - p.suggested_low) / rangeSpan) * 100 : 50;
                              const fmt = (n: number) => "$" + n.toLocaleString();
                              const confColor = p.confidence > 70 ? "text-green-600" : p.confidence > 40 ? "text-amber-600" : "text-red-600";
                              const confBg = p.confidence > 70 ? "bg-green-50 border-green-200" : p.confidence > 40 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";
                              const stratColor = p.pricing_strategy === "aggressive" ? "bg-green-100 text-green-700" : p.pricing_strategy === "safe" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700";
                              const estimatedNum = parseFloat(bid.estimated_value?.replace(/[^0-9.]/g, "") || "0");
                              const inRange = estimatedNum > 0 && estimatedNum >= p.suggested_low && estimatedNum <= p.suggested_high;
                              const aboveRange = estimatedNum > 0 && estimatedNum > p.suggested_high;
                              const belowRange = estimatedNum > 0 && estimatedNum < p.suggested_low;
                              return (
                                <div className="space-y-5">
                                  {/* Price Range Bar Card */}
                                  <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-5">
                                    <div className="flex items-center justify-between mb-3">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-purple-600 flex items-center gap-1.5">
                                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        Suggested Price Range
                                      </p>
                                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${stratColor}`}>
                                        {p.pricing_strategy === "aggressive" ? "⚡ Aggressive" : p.pricing_strategy === "safe" ? "🛡️ Safe" : "⚖️ Competitive"}
                                      </span>
                                    </div>
                                    {/* Visual range bar */}
                                    <div className="relative mt-4 mb-2">
                                      <div className="h-3 rounded-full bg-gradient-to-r from-green-400 via-amber-400 to-blue-400" />
                                      <div className="absolute -top-1 left-0 w-full flex justify-between text-[10px] text-slate-400 font-medium" style={{ paddingLeft: "2%", paddingRight: "2%" }}>
                                        <span>{fmt(p.suggested_low)}</span>
                                        <span className="font-bold text-slate-700">{fmt(p.suggested_median)}</span>
                                        <span>{fmt(p.suggested_high)}</span>
                                      </div>
                                    </div>
                                    <div className="flex justify-between items-end mt-5">
                                      <div className="text-center"><p className="text-xs text-slate-400">Low</p><p className="text-lg font-bold text-slate-800">{fmt(p.suggested_low)}</p></div>
                                      <div className="text-center"><p className="text-xs text-slate-400">Median</p><p className="text-lg font-bold text-purple-700">{fmt(p.suggested_median)}</p></div>
                                      <div className="text-center"><p className="text-xs text-slate-400">High</p><p className="text-lg font-bold text-slate-800">{fmt(p.suggested_high)}</p></div>
                                    </div>
                                  </div>
                                  {/* Confidence + Value Comparison */}
                                  <div className="grid gap-4 sm:grid-cols-2">
                                    <div className={`rounded-xl border ${confBg} p-4`}>
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Confidence</p>
                                      <p className={`mt-1 text-3xl font-bold ${confColor}`}>{p.confidence}%</p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        {p.confidence > 70 ? "Strong data — many comparable awards found" : p.confidence > 40 ? "Moderate data — some comparable awards" : "Limited data — few comparable awards"}
                                      </p>
                                    </div>
                                    <div className={`rounded-xl border p-4 ${inRange ? "border-green-200 bg-green-50" : aboveRange ? "border-red-200 bg-red-50" : belowRange ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-white"}`}>
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">vs. Listed Value</p>
                                      <p className="mt-1 text-2xl font-bold text-slate-800">{bid.estimated_value || "N/A"}</p>
                                      {inRange && <p className="mt-1 text-xs font-medium text-green-600">✓ Within suggested range</p>}
                                      {aboveRange && <p className="mt-1 text-xs font-medium text-red-600">↑ Above suggested range</p>}
                                      {belowRange && <p className="mt-1 text-xs font-medium text-amber-600">↓ Below suggested range</p>}
                                      {estimatedNum === 0 && <p className="mt-1 text-xs text-slate-400">No estimated value to compare</p>}
                                    </div>
                                  </div>
                                  {/* AI Rationale */}
                                  <div className="rounded-lg border border-purple-100 bg-purple-50/50 p-4">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-purple-600 mb-1">AI Rationale</p>
                                    <p className="text-sm text-slate-700 leading-relaxed">{p.rationale}</p>
                                  </div>
                                  {/* Comparable Awards */}
                                  {p.comparable_awards.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Comparable Past Awards</p>
                                      <div className="space-y-2">
                                        {p.comparable_awards.slice(0, 5).map((a, i) => (
                                          <div key={i} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white p-3 text-sm">
                                            <div className="min-w-0 flex-1">
                                              <p className="font-medium text-slate-800 truncate">{a.title}</p>
                                              <p className="text-xs text-slate-500">{a.agency} · {a.year}</p>
                                            </div>
                                            <span className="ml-3 shrink-0 font-semibold text-green-700">{a.amount}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <button type="button" onClick={() => doPricing(bid.id, bid)} disabled={pricingLoading.has(bid.id)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">{pricingLoading.has(bid.id) ? "Refreshing…" : "Refresh Pricing"}</button>
                                  <p className="text-xs text-slate-400">Generated {fmtDateTime(p.created_at)}</p>
                                </div>
                              );
                            })() : pricingLoading.has(bid.id) ? (
                              <div className="flex flex-col items-center justify-center py-8 text-center">
                                <div className="flex items-center gap-1 mb-3"><span className="h-2 w-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: "0ms" }} /><span className="h-2 w-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: "150ms" }} /><span className="h-2 w-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: "300ms" }} /></div>
                                <p className="text-sm font-medium text-slate-600">Analyzing pricing...</p>
                                <p className="text-xs text-slate-400 mt-1">Comparing against past contract awards</p>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center justify-center py-8 text-center">
                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 mb-4 shadow-lg shadow-purple-200">
                                  <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                </div>
                                <p className="text-sm font-semibold text-slate-700">Get pricing intelligence</p>
                                <p className="text-xs text-slate-500 mt-1 mb-4 max-w-xs">AI analyzes past contract awards to suggest a competitive bid price range.</p>
                                <button type="button" onClick={() => doPricing(bid.id, bid)} className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 active:scale-[0.98] transition-all">
                                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                  Analyze Pricing
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Summary Tab */}
                        {currentTab === "summary" && (
                          <div>
                            {summary ? (
                              <div className="space-y-4">
                                <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5">
                                  <div className="flex items-center justify-between mb-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 flex items-center gap-1.5">
                                      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>
                                      AI Summary
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => doGenerateSummary(bid.id)}
                                      disabled={isGenSummary}
                                      className="text-xs font-medium text-slate-400 hover:text-blue-600 disabled:opacity-50"
                                    >
                                      {isGenSummary ? "Regenerating..." : "Regenerate"}
                                    </button>
                                  </div>
                                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{summary.summary_text}</p>
                                </div>
                                {summary.key_requirements.length > 0 && (
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Key Requirements</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {summary.key_requirements.map((req, i) => (
                                        <span key={i} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                                          <svg className="h-3 w-3 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                          {req}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                <p className="text-xs text-slate-400">Generated {fmtDateTime(summary.generated_at)}</p>
                                <a href={`/compliance?bid_id=${bid.id}`} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 active:scale-[0.98] transition-all">Run Compliance Check →</a>
                              </div>
                            ) : isGenSummary ? (
                              <div className="flex flex-col items-center justify-center py-8 text-center">
                                <div className="flex items-center gap-1 mb-3">
                                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                                </div>
                                <p className="text-sm font-medium text-slate-600">Analyzing bid...</p>
                                <p className="text-xs text-slate-400 mt-1">Our AI is reading through the requirements</p>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center justify-center py-8 text-center">
                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 mb-4 shadow-lg shadow-blue-200">
                                  <svg className="h-7 w-7 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>
                                </div>
                                <p className="text-sm font-semibold text-slate-700">Get an AI-powered summary</p>
                                <p className="text-xs text-slate-500 mt-1 mb-4 max-w-xs">Understand the requirements, deadlines, and potential red flags in plain English.</p>
                                <button
                                  type="button"
                                  onClick={() => doGenerateSummary(bid.id)}
                                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-[0.98] transition-all"
                                >
                                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>
                                  AI Summary
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Win Probability Tab */}
                        {currentTab === "score" && (
                          <div>{score ? <div className="space-y-5">
                            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5">
                              <div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Win Probability</p><p className={`mt-1 text-5xl font-bold ${score.win_probability >= 80 ? "text-green-600" : score.win_probability >= 50 ? "text-amber-600" : "text-red-600"}`}>{score.win_probability}<span className="text-2xl">% Win Chance</span></p></div>
                              <div className="text-right"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${score.competition_level === "Low" ? "bg-green-100 text-green-700" : score.competition_level === "High" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{score.competition_level} competition</span><p className="mt-2 text-xs text-slate-400">Generated {fmtDateTime(score.generated_at)}</p></div>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="rounded-lg border border-slate-100 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Agency Sentiment</p><p className="mt-1 text-sm leading-relaxed text-slate-700">{score.agency_sentiment}</p></div>
                              <div className="rounded-lg border border-slate-100 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Contract Size Fit</p><p className="mt-1 text-sm leading-relaxed text-slate-700">{score.size_fit}</p></div>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="rounded-lg border border-slate-100 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Experience Match</p><p className="mt-1 text-sm leading-relaxed text-slate-700">{score.experience_match}</p></div>
                              <div className="rounded-lg border border-slate-100 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Similar Awards</p><p className="mt-1 text-sm leading-relaxed text-slate-700">{score.similar_awards_note}</p></div>
                            </div>
                            {score.naics_match && (
                              <div className="rounded-lg border border-purple-100 bg-purple-50/50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-purple-600">NAICS Code Match</p><p className="mt-1 text-sm leading-relaxed text-slate-700">{score.naics_match}</p></div>
                            )}
                            <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">AI Analysis</p><p className="mt-1 text-sm leading-relaxed text-slate-700">{score.ai_explanation}</p></div>
                            <button type="button" onClick={() => doScore(bid.id, true)} disabled={isScoring} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">{isScoring ? "Regenerating…" : "Regenerate Score"}</button>
                          </div> : <div className="py-8 text-center"><p className="text-sm text-slate-600">{isScoring ? "Analyzing win probability…" : "No win probability yet."}</p><button type="button" onClick={() => doScore(bid.id)} disabled={isScoring} className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white">{isScoring ? "Analyzing…" : "Calculate Win Probability"}</button></div>}</div>
                        )}

                        {/* Proposal Draft Tab */}
                        {currentTab === "draft" && (
                          <div>
                            {draft ? (
                              <div className="space-y-4">
                                <div className="rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-white p-5 max-h-96 overflow-y-auto">
                                  <div className="flex items-center justify-between mb-3">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-green-600 flex items-center gap-1.5">
                                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                                      Proposal Draft
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => doGenerateProposal(bid.id)}
                                      disabled={isGenProposal}
                                      className="text-xs font-medium text-slate-400 hover:text-green-600 disabled:opacity-50"
                                    >
                                      {isGenProposal ? "Regenerating..." : "Regenerate"}
                                    </button>
                                  </div>
                                  <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{draft.draft_text}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <button type="button" onClick={() => doDownloadPdf(bid)} disabled={downloadingPdf.has(bid.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50 active:scale-[0.98] transition-all">
                                    {downloadingPdf.has(bid.id) ? "Preparing PDF…" : "📄 Download PDF"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => doCopyDraft(bid.id, draft.draft_text)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition-all"
                                  >
                                    {copiedBid === bid.id ? (
                                      <>
                                        <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                        Copied!
                                      </>
                                    ) : (
                                      <>
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
                                        Copy to Clipboard
                                      </>
                                    )}
                                  </button>
                                  <p className="text-xs text-amber-600 flex items-center gap-1">
                                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
                                    AI-generated draft — review and customize before submitting
                                  </p>
                                </div>
                                <p className="text-xs text-slate-400">Generated {fmtDateTime(draft.generated_at)}</p>
                              </div>
                            ) : isGenProposal ? (
                              <div className="flex flex-col items-center justify-center py-8 text-center">
                                <div className="flex items-center gap-1 mb-3">
                                  <span className="h-2 w-2 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                                  <span className="h-2 w-2 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                                  <span className="h-2 w-2 rounded-full bg-green-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                                </div>
                                <p className="text-sm font-medium text-slate-600">Drafting proposal...</p>
                                <p className="text-xs text-slate-400 mt-1">Our AI is writing a tailored response</p>
                              </div>
                            ) : isSaved ? (
                              <div className="flex flex-col items-center justify-center py-8 text-center">
                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 mb-4 shadow-lg shadow-green-200">
                                  <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                                </div>
                                <p className="text-sm font-semibold text-slate-700">Generate a proposal draft</p>
                                <p className="text-xs text-slate-500 mt-1 mb-4 max-w-xs">AI will draft a professional response based on your business profile.</p>
                                <button
                                  type="button"
                                  onClick={() => doGenerateProposal(bid.id)}
                                  className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700 active:scale-[0.98] transition-all"
                                >
                                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                                  Draft Proposal
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center justify-center py-8 text-center">
                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-4">
                                  <svg className="h-7 w-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                                </div>
                                <p className="text-sm font-medium text-slate-600">Save this bid first</p>
                                <p className="text-xs text-slate-500 mt-1">Save the bid to generate a proposal draft tailored to your business.</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="px-5 pb-5 flex gap-3 pt-2 border-t border-slate-100">
                        {/* Track/Untrack toggle in expanded view */}
                        <button
                          type="button"
                          onClick={() => isTracked ? doUntrack(bid.id) : doTrack(bid)}
                          disabled={isTracking}
                          className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-all ${isTracked ? "bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200" : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"}`}
                        >
                          {isTracking ? "⏳" : isTracked ? "🔖" : "🔖"}
                          {isTracked ? "Untrack" : "Track Bid"}
                        </button>
                        {!isSaved ? (
                          <button type="button" onClick={() => doSave(bid.id)} disabled={isLoading} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 hover:shadow-md disabled:opacity-50 active:scale-[0.98]">
                            {isLoading ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> : <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>}
                            {isLoading ? "Saving..." : "Save Bid"}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-2 rounded-xl bg-green-100 px-5 py-2.5 text-sm font-semibold text-green-700"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Saved</span>
                        )}
                        {isSaved && (
                          <button
                            type="button"
                            onClick={() => { setActiveTab((p) => ({ ...p, [bid.id]: "draft" })); if (!draft) doGenerateProposal(bid.id); }}
                            className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700 active:scale-[0.98] transition-all"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                            Draft Proposal
                          </button>
                        )}
                        <a
                          href={`/compliance?bid_id=${bid.id}`}
                          className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 active:scale-[0.98] transition-all"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          Check Compliance
                        </a>
                        <button type="button" onClick={() => doDismiss(bid.id)} disabled={isLoading} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-50 active:scale-[0.98]">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
