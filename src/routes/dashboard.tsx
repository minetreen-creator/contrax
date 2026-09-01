import { createFileRoute, useNavigate, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { sql } from "~/db";
import { getCurrentUser, type AuthUser } from "~/lib/auth";
import { locationMatchesStates, shouldApplyStateFilter } from "~/lib/open-bids";
import type { PricingRecommendation } from "~/lib/pricing";
import { trackBid, untrackBid } from "~/routes/tracking";
import { isHealthcareBid, type License } from "~/lib/healthcare";
import { FeedbackWidget } from "~/components/FeedbackWidget";
import { RadarLoginNotify } from "~/components/RadarLoginNotify";
import { SavedRadarMatches } from "~/components/SavedRadarMatches";
import { TrialChecklist } from "~/components/TrialChecklist";
import { TrialStartCard } from "~/components/TrialStartCard";
import { CompanyProfile, type BusinessProfile } from "~/components/CompanyProfile";
import { GettingStarted } from "~/components/GettingStarted";
import {
  PremiumUpgradeModal,
  SAVE_LIMIT_PAYWALL_TITLE,
  SAVE_LIMIT_PAYWALL_MESSAGE,
  SAVE_LIMIT_PAYWALL_CTA,
  SAVE_LIMIT_PAYWALL_PRICE,
} from "~/components/PremiumUpgradeModal";
import { checkTrial, hasUnlimitedSaves, FREE_SAVE_LIMIT, type TrialStatus } from "~/lib/trial";
import { CERTIFICATIONS, certificationDaysRemaining, certificationStatus, fmtCertDate } from "~/lib/certifications";
import {
  mergeFilterState,
  parseReviewParams,
  readReviewFilters,
  storeReviewFilters,
  writeReviewFilters,
  type ReviewFilterState,
  type SortKey,
} from "~/lib/review-context";
import { StickyFilterBar } from "~/components/StickyFilterBar";
import { ReviewPager } from "~/components/ReviewPager";

// ── Types ────────────────────────────────────────────────────────────────────
interface Bid {
  id: number; title: string; agency: string; description: string;
  location: string; category: string; set_aside: string | null; due_date: string; estimated_value: string;
  source_url: string | null; role_matches: number;
  naics_code: string | null; created_at: string;
}
interface BidSummary {
  bid_id: number; summary_text: string; key_requirements: string[];
  generated_at: string;
}
interface HealthcareSummary {
  bid_id: number;
  is_healthcare: boolean;
  required_roles: { role: string; headcount: string }[];
  shift_schedules: string;
  facility_type: string;
  credential_requirements: string[];
  contract_duration: string;
  renewal_terms: string;
  key_notes: string;
  summary_text: string;
  generated_at: string;
}
interface ClauseCitation {
  clause_number: string;
  title: string;
  full_text: string;
}
interface ProposalDraft {
  bid_id: number; draft_text: string; generated_at: string;
  citations: ClauseCitation[];
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
  role_fit: string;
  ai_explanation: string; generated_at: string;
}
interface SavedMatch { bid_id: number; status: string; }
interface ArchiveBid {
  id: number; title: string; agency: string; description: string;
  location: string; category: string; set_aside: string | null; due_date: string; estimated_value: string;
  source_url: string | null; role_matches: number;
  naics_code: string | null; created_at: string; status: string | null;
}
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
  matchCount?: number;
  archivedCount?: number;
  lossesCount: number;
  urgentTrackedCount: number;
  topCompetitor: { name: string; awards: number } | null;
  activeAwardees: number;
  unreadAlerts: number;
  pendingDraft: { id: number; status: string; has_draft_text: boolean } | null;
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

interface DigestResult { entries: DigestEntry[]; hasRecentBids: boolean; }
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

const generateHealthcareSummary = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ bidId: Number((data as { bidId: number }).bidId) }))
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    const bidRows = await sql()`SELECT title, agency, description, category, due_date, estimated_value FROM bids WHERE id = ${data.bidId}`;
    if (bidRows.length === 0) throw new Error("Bid not found");
    const bid = bidRows[0] as any;

    // Only produce a healthcare summary for healthcare opportunities.
    if (!isHealthcareBid(bid)) {
      return { bid_id: data.bidId, is_healthcare: false, required_roles: [], shift_schedules: "", facility_type: "", credential_requirements: [], contract_duration: "", renewal_terms: "", key_notes: "", summary_text: "", generated_at: new Date().toISOString() } as HealthcareSummary;
    }

    // Cache the structured summary per bid.
    await sql()`CREATE TABLE IF NOT EXISTS healthcare_bid_summaries (id SERIAL PRIMARY KEY, bid_id INTEGER UNIQUE REFERENCES bids(id), summary_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW())`;
    const cached = await sql()`SELECT summary_json, created_at FROM healthcare_bid_summaries WHERE bid_id = ${data.bidId}`;
    if (cached.length > 0) {
      const c = cached[0] as any;
      return { bid_id: data.bidId, is_healthcare: true, ...(typeof c.summary_json === "object" ? c.summary_json : {}), generated_at: String(c.created_at || new Date().toISOString()) } as HealthcareSummary;
    }

    const prompt = `You are a healthcare staffing procurement analyst. This opportunity appears to be a healthcare staffing contract. Extract the staffing-relevant details and return ONLY valid JSON — no markdown, no code fences.

Required JSON shape:
{
  "required_roles": [{"role": "RN", "headcount": "5 full-time"}],
  "shift_schedules": "Shifts, hours per week, coverage windows",
  "facility_type": "hospital | clinic | correctional | military | long-term care | home health | other",
  "credential_requirements": ["Active RN license (state)", "ACLS", "BLS", "background check"],
  "contract_duration": "Base period and any option periods",
  "renewal_terms": "Renewal / extension terms if stated",
  "key_notes": "Anything else a staffing agency must know (onboarding, EMR systems, uniforms, ratios)",
  "summary_text": "2-3 sentence plain-English overview of what the contract asks a staffing vendor to deliver"
}

Rules:
- Pull specific role names and headcounts from the text. If headcount is not stated, say "Not specified".
- Only list credentials that are actually mentioned or clearly implied by the requirements.
- If a field is not addressed in the text, use "Not specified" (or [] for lists).

Opportunity:
Title: ${bid.title}
Agency: ${bid.agency}
Description: ${bid.description || "Not provided"}
Category: ${bid.category || "Not specified"}
Due Date: ${String(bid.due_date)}
Estimated Value: ${bid.estimated_value || "Not specified"}`;

    let parsed: any;
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OpenAI API key not configured");
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 1200, temperature: 0.2 }),
      });
      if (!response.ok) throw new Error(`OpenAI API error (${response.status})`);
      const json = await response.json() as any;
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error("No content in OpenAI response");
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not parse JSON from AI response");
      parsed = JSON.parse(jsonMatch[0]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI request failed";
      throw new Error(`Healthcare summary generation failed: ${msg}`);
    }

    const result: HealthcareSummary = {
      bid_id: data.bidId,
      is_healthcare: true,
      required_roles: Array.isArray(parsed.required_roles) ? parsed.required_roles.slice(0, 30).map((r: any) => ({ role: String(r.role || "Role"), headcount: String(r.headcount || "Not specified") })) : [],
      shift_schedules: String(parsed.shift_schedules || "Not specified"),
      facility_type: String(parsed.facility_type || "Not specified"),
      credential_requirements: Array.isArray(parsed.credential_requirements) ? parsed.credential_requirements.map((c: any) => String(c)) : [],
      contract_duration: String(parsed.contract_duration || "Not specified"),
      renewal_terms: String(parsed.renewal_terms || "Not specified"),
      key_notes: String(parsed.key_notes || "Not specified"),
      summary_text: String(parsed.summary_text || "No summary provided."),
      generated_at: new Date().toISOString(),
    };

    const { generated_at: _g, ...cacheable } = result;
    await sql()`INSERT INTO healthcare_bid_summaries (bid_id, summary_json) VALUES (${data.bidId}, ${JSON.stringify(cacheable)}::jsonb) ON CONFLICT (bid_id) DO UPDATE SET summary_json = EXCLUDED.summary_json, created_at = NOW()`;
    await trackActivity(user.email, "healthcare_summary", data.bidId, "Healthcare View summary");
    return result;
  });

const downloadPdf = createServerFn({ method: "POST" }).validator((data: unknown) => {
  const bidId = Number((data as { bidId?: number }).bidId);
  if (!Number.isInteger(bidId) || bidId < 1) throw new Error("Invalid bid ID");
  return { bidId };
}).handler(async ({ data }): Promise<{ base64: string; filename: string }> => {
  const user = await getCurrentUser(); if (!user) throw new Error("Not authenticated");
  // Lazy migration for FAR-grounded drafting citations (same pattern as the
  // business_profiles ALTERs in src/routes/api/bids-draft.ts).
  try { await sql()`ALTER TABLE proposal_drafts ADD COLUMN IF NOT EXISTS citations JSONB DEFAULT '[]'::jsonb`; } catch {}
  const rows = await sql()`SELECT p.draft_text, p.citations, b.title, b.agency FROM proposal_drafts p JOIN bids b ON b.id = p.bid_id WHERE p.bid_id = ${data.bidId} AND p.user_id = ${user.id} LIMIT 1`;
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
// Trial status lives in ~/lib/trial (shared with settings, upgrade, and the
// TrialGate component). Re-exported here so existing imports keep working.
export { checkTrial, type TrialStatus };

// ── Route ────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  // Auth-only loader. Dashboard data now loads client-side from the
  // /api/dashboard-data API route (createServerFn client RPCs silently fail on
  // production, so the data can no longer be fetched from the loader).
  loader: async (): Promise<{ user: AuthUser | null }> => {
    const user = await getCurrentUser();
    return { user };
  },
  pendingComponent: LoadingSkeleton,
  component: DashboardRoute,
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
const CERT_NAME: Record<string, string> = {
  "8a": "8(a)", hubzone: "HUBZone", wosb: "WOSB", sdvosb: "SDVOSB", vosb: "VOSB",
  minority_owned: "Minority", disadvantaged: "Disadvantaged", small_business: "Small Business",
};


// ── FAR-Grounded Drafting renderer ─────────────────────────────────────────
// Renders the draft text with every VALID citation hyperlinked. The citations
// array (from the API/DB — every entry validated against far_clauses) is the
// ONLY source of truth: the token regex is built exclusively from those
// clause numbers, so text the engine never validated is never hyperlinked.
function renderDraftText(text: string, citations: ClauseCitation[] | undefined, reviewMode: boolean): ReactNode {
  const list = Array.isArray(citations) ? citations : [];
  if (!list.length) return text;
  // Escape clause numbers for regex use; longest first so a number that is a
  // prefix of another (e.g. 52.212-4 vs 52.212-40) matches the longer token.
  const escaped = list
    .map((c) => c.clause_number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  const re = new RegExp(
    escaped.map((n) => `(?:\\[FAR\\s+)?${n}(?:\\])?`).join("|"),
    "g",
  );
  const byNumber = new Map(list.map((c) => [c.clause_number, c]));
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    const token = m[0];
    const unwrapped = token.replace(/^\[FAR\s+/, "").replace(/\]$/, "");
    const citation = byNumber.get(unwrapped);
    if (citation) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(
        <a
          key={`cit-${key++}`}
          href={`/clauses/${citation.clause_number}`}
          className={
            reviewMode
              ? "rounded-sm bg-amber-200 px-0.5 font-medium text-blue-700 underline decoration-solid underline-offset-2 hover:bg-amber-300"
              : "font-medium text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700 hover:decoration-solid"
          }
        >
          {token}
        </a>,
      );
      last = m.index + token.length;
    }
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}
function setAsideLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v || /^(none|no|not set aside|n\/a|na)$/i.test(v)) return null;
  const lower = v.toLowerCase();
  const map: Record<string, string> = {
    sba: "8(a)",
    "8a": "8(a)",
    "8(a)": "8(a)",
    sdvosbc: "SDVOSB",
    sdvosb: "SDVOSB",
    vosbc: "VOSB",
    vosb: "VOSB",
    wosb: "WOSB",
    edwosb: "EDWOSB",
    "wosb/edwosb": "WOSB/EDWOSB",
    hzc: "HUBZone",
    hubzone: "HUBZone",
    mbe: "MBE",
    wbe: "WBE",
    dbe: "DBE",
  };
  if (map[lower]) return map[lower];
  if (lower.includes("8(a)") || (lower.includes("8a") && lower.includes("sba"))) return "8(a)";
  if (lower.includes("service-disabled") || lower.includes("sdvosb")) return "SDVOSB";
  if (lower.includes("economically disadvantaged")) return "EDWOSB";
  if (lower.includes("women-owned") || lower.includes("women owned") || lower.includes("wosb")) return "WOSB";
  if (lower.includes("veteran-owned") || lower.includes("veteran owned") || lower.includes("vosb")) return "VOSB";
  if (lower.includes("hubzone") || lower.includes("hub zone")) return "HUBZone";
  if (lower.includes("minority")) return "Minority-Owned";
  if (lower.includes("disadvantaged")) return "Disadvantaged";
  return v;
}

// Does a bid's set-aside designation match any of the user's certifications?
// Maps SAM.gov set-aside labels loosely to the profile cert keys (8a, sdvosb,
// wosb, edwosb, hubzone, vosb, minority_owned, disadvantaged).
function setAsideMatchesCertifications(bidSetAside: string | null | undefined, certifications: string[]): boolean {
  const label = setAsideLabel(bidSetAside);
  if (!label) return false;
  const certs = (certifications || []).map((c) => String(c).toLowerCase());
  switch (label.toLowerCase()) {
    case "8(a)":
      return certs.includes("8a") || certs.includes("8(a)") || certs.includes("sba") || certs.includes("disadvantaged");
    case "sdvosb":
      return certs.includes("sdvosb") || certs.includes("service_disabled_veteran");
    case "vosb":
      // SDVOSB firms are also veteran-owned and may bid VOSB set-asides.
      return certs.includes("vosb") || certs.includes("veteran") || certs.includes("sdvosb");
    case "wosb":
      return certs.includes("wosb") || certs.includes("wosb_edwosb");
    case "edwosb":
    case "wosb/edwosb":
      return certs.includes("edwosb") || certs.includes("wosb") || certs.includes("wosb_edwosb");
    case "hubzone":
      return certs.includes("hubzone");
    case "minority-owned":
      return certs.includes("minority_owned") || certs.includes("minority");
    case "disadvantaged":
      return certs.includes("disadvantaged") || certs.includes("8a") || certs.includes("8(a)");
    default:
      return certs.includes(label.toLowerCase());
  }
}

// NOTE: The old client-side `matchBid` (which OR-combined category/location/
// set-aside and — for a NAICS-onboarded profile whose `industry` is an empty
// string — auto-matched EVERY bid via `cat.includes("")` === true) has been
// REMOVED. Dashboard live-feed relevance now comes from the authoritative SQL
// matcher server-side in /api/dashboard-data (setAsidePredMulti + naicsPred +
// locationMatchesStates + LOW_CONTENT_SQL + DISTINCT ON), the same predicates
// the onboarding "We found N" count uses. `setAsideMatchesCertifications`
// remains for display/boost purposes.

// ── Opportunity Detail: Eligibility verdict ─────────────────────────────────
// Profile-aware, per-bid eligibility evaluation surfaced in the auth-gated
// dashboard (the only surface with the user's business profile). Reuses the
// shared open-bids geography predicates and the existing set-aside matcher.
// HONESTY: a dimension is NO_DATA when the required field is absent (e.g. a
// state/portal bid with naics_code NULL, or a profile with no locations) —
// never a fabricated verdict.
type EvalStatus = "MATCH" | "NO_MATCH" | "NO_DATA";
interface EligibilityDimension {
  status: EvalStatus;
  label: string;
  reason: string;
}
type EligibilityVerdict = "Eligible" | "Not eligible" | "Partial";
interface EligibilityResult {
  verdict: EligibilityVerdict;
  summary: string;
  dimensions: EligibilityDimension[];
}

// NAICS/trade dimension. Mirrors the shared keywordPred field coverage
// (title/description/naics) as a pure client-side predicate. A concrete miss
// is only asserted when there is real evidence (a bid NAICS code present while
// the profile lists NAICS codes that don't overlap); otherwise NO_DATA.
function evalTradeDimension(bid: Bid, profile: BusinessProfile | null): EligibilityDimension {
  const pNaics = (profile?.naics_codes ?? []).map((c) => String(c).trim()).filter(Boolean);
  const pKeywords = new Set<string>();
  const addKw = (t: string) => { const k = (t || "").trim().toLowerCase(); if (k) pKeywords.add(k); };
  addKw(profile?.industry ?? "");
  (profile?.specialties ?? []).forEach(addKw);

  const bidNaics = (bid.naics_code ?? "").trim();
  const haystack = `${bid.title}\n${bid.description ?? ""}`.toLowerCase();

  const sameTrade = (a: string, b: string) =>
    !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a));

  // Positive signal: bid NAICS matches a profile NAICS code (allow prefix/6-digit).
  if (bidNaics && pNaics.some((n) => sameTrade(n, bidNaics))) {
    return { status: "MATCH", label: "NAICS / trade", reason: `Bid NAICS ${bidNaics} matches a NAICS code on your profile.` };
  }
  // Positive signal: profile trade keyword (industry / specialty) appears in the
  // solicitation title or description (same field set as the shared keywordPred).
  const hit = [...pKeywords].find((k) => haystack.includes(k));
  if (hit) {
    return { status: "MATCH", label: "NAICS / trade", reason: `Solicitation text matches your listed trade (${hit}).` };
  }
  // Concrete miss: bid has a NAICS code and the profile lists NAICS codes that
  // don't overlap → the bid targets a trade the user does not list.
  if (bidNaics && pNaics.length > 0) {
    return { status: "NO_MATCH", label: "NAICS / trade", reason: `Bid NAICS ${bidNaics} is not among the NAICS codes on your profile.` };
  }
  // Insufficient evidence → honest NO_DATA.
  const reason = bidNaics
    ? `Bid has NAICS ${bidNaics}, but it is not on your profile and your listed trade/specialties don't appear in the solicitation.`
    : pNaics.length > 0 || pKeywords.size > 0
    ? "Solicitation has no NAICS or trade data to compare against your profile."
    : "Your profile has no NAICS or trade data to compare.";
  return { status: "NO_DATA", label: "NAICS / trade", reason };
}

// Geography dimension. Reuses the shared shouldApplyStateFilter /
// locationMatchesStates predicates. Nationwide (all states) = no restriction;
// empty profile locations = NO_DATA.
function evalGeographyDimension(bid: Bid, profile: BusinessProfile | null): EligibilityDimension {
  const locs = (profile?.locations ?? []).map(String).filter(Boolean);
  if (locs.length === 0) {
    return { status: "NO_DATA", label: "Geography", reason: "No locations set in your profile — geography can't be verified." };
  }
  if (!shouldApplyStateFilter(locs)) {
    return { status: "MATCH", label: "Geography", reason: "Nationwide — you target all states, so location is no restriction." };
  }
  const viaStates = locationMatchesStates(bid.location, locs);
  const viaName = locs.some((l) => bid.location?.toLowerCase().includes(String(l).toLowerCase()));
  if (viaStates || viaName) {
    return { status: "MATCH", label: "Geography", reason: `Solicitation location (${bid.location}) is in your target states.` };
  }
  return { status: "NO_MATCH", label: "Geography", reason: `Solicitation location (${bid.location}) is outside your target states.` };
}

// Set-aside dimension. Reuses setAsideMatchesCertifications. A solicitation with
// NO set-aside designation is unrestricted (not a disqualifier) → NO_DATA; a
// set-aside reserved for a certification the user doesn't hold is a NO_MATCH.
function evalSetAsideDimension(bid: Bid, profile: BusinessProfile | null): EligibilityDimension {
  const certs = Array.isArray(profile?.certifications) ? profile.certifications : [];
  const label = setAsideLabel(bid.set_aside);
  if (!label) {
    return { status: "NO_DATA", label: "Set-aside", reason: "No set-aside designation — not restricted to a specific certification." };
  }
  if (setAsideMatchesCertifications(bid.set_aside, certs)) {
    return { status: "MATCH", label: "Set-aside", reason: `Set-aside (${label}) matches one of your certifications.` };
  }
  return { status: "NO_MATCH", label: "Set-aside", reason: `Reserved ${label} set-aside — none of your certifications qualify.` };
}

// Overall verdict: Not eligible on any clear miss; Eligible only when all three
// dimensions match; otherwise Partial (some match, some unknown/no data).
function computeEligibility(bid: Bid, profile: BusinessProfile | null): EligibilityResult {
  const dimensions = [
    evalSetAsideDimension(bid, profile),
    evalTradeDimension(bid, profile),
    evalGeographyDimension(bid, profile),
  ];
  const matches = dimensions.filter((d) => d.status === "MATCH").length;
  const misses = dimensions.filter((d) => d.status === "NO_MATCH").length;

  let verdict: EligibilityVerdict;
  if (misses > 0) verdict = "Not eligible";
  else if (matches === 3) verdict = "Eligible";
  else verdict = "Partial";

  let summary: string;
  if (verdict === "Eligible") {
    summary = "This opportunity fits your set-aside, trade, and geography.";
  } else if (verdict === "Not eligible") {
    const miss = dimensions.find((d) => d.status === "NO_MATCH");
    summary = miss ? miss.reason : "A required eligibility dimension does not match your profile.";
  } else {
    summary = dimensions
      .map((d) => `${d.label}: ${d.status === "MATCH" ? "match" : d.status === "NO_MATCH" ? "no match" : "no data"}`)
      .join("; ");
  }
  return { verdict, summary, dimensions };
}

function eligibilityVerdictStyle(v: EligibilityVerdict) {
  if (v === "Eligible") return { pill: "bg-green-100 text-green-700", dot: "🟢" };
  if (v === "Not eligible") return { pill: "bg-red-100 text-red-700", dot: "🔴" };
  return { pill: "bg-amber-100 text-amber-700", dot: "🟡" };
}
function eligibilityDimStyle(status: EvalStatus) {
  if (status === "MATCH") return { pill: "bg-green-100 text-green-700", txt: "Match" };
  if (status === "NO_MATCH") return { pill: "bg-red-100 text-red-700", txt: "No match" };
  return { pill: "bg-slate-100 text-slate-500", txt: "No data" };
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

// ── Zero-Matches Empty State (deliverable 3) ──────────────────────────────
// Shown on the live feed when the exact profile (NAICS + State + cert) yields no
// active solicitations. Offers two constructive actions instead of a bare "0":
//   1. "Broaden search (Include Nationwide)" — drops the geo constraint and
//      re-queries (only shown when the profile targets specific states).
//   2. "Add adjacent NAICS codes" — routes to the NAICS profile editor.
// When already nationwide and still 0, shows an honest secondary message.
function ZeroMatchesEmpty({
  nationwide,
  archivedCount,
  filterUpdating,
  onBroaden,
  onOpenArchive,
}: {
  nationwide: boolean;
  archivedCount: number;
  filterUpdating: boolean;
  onBroaden: () => void;
  onOpenArchive: () => void;
}) {
  return (
    <div className="text-center py-12 rounded-2xl border border-slate-200 bg-white">
      <svg className="mx-auto h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
      {nationwide ? (
        <>
          <h3 className="mt-4 text-lg font-semibold text-slate-700">No active solicitations right now</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            We didn&rsquo;t find any active solicitations matching your current NAICS + certification profile, even nationwide.
            Try widening your coverage to catch more opportunities.
          </p>
        </>
      ) : (
        <>
          <h3 className="mt-4 text-lg font-semibold text-slate-700">No matching bids in your states</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            No active solicitations matching this exact NAICS + State combination right now.
          </p>
        </>
      )}
      {archivedCount > 0 && (
        <p className="mt-2 text-sm text-slate-500">
          <button type="button" onClick={onOpenArchive} className="font-semibold text-blue-600 underline hover:text-blue-700">
            View {archivedCount} archived closed / no-go bid{archivedCount !== 1 ? "s" : ""}
          </button>
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {!nationwide && (
          <button
            type="button"
            onClick={onBroaden}
            disabled={filterUpdating}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {filterUpdating ? "Searching…" : "Broaden search (Include Nationwide)"}
          </button>
        )}
        <a href="/settings" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Add adjacent NAICS codes
        </a>
        <a href="/onboarding" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Edit profile</a>
        <a href="/awards" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Browse opportunities</a>
      </div>
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

function TrialBanner({ daysLeft, planTier, endsAt }: { daysLeft: number; planTier: string | null; endsAt: string | null }) {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-4">
      <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <strong>Your 14-day Professional trial</strong> · {daysLeft} day{daysLeft === 1 ? "" : "s"} left
          {endsAt ? <span className="text-amber-700"> · ends {fmtDate(endsAt)}</span> : null}
        </div>
        <a href="/upgrade" className="shrink-0 font-semibold text-blue-700 underline hover:text-blue-800">Subscribe now →</a>
      </div>
    </div>
  );
}
function TrialExpired() { return <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4"><div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm"><h1 className="text-2xl font-bold text-slate-900">Your trial has ended</h1><p className="mt-3 text-slate-600">Subscribe to continue using Contrax.</p><a href="/upgrade" className="mt-7 inline-flex rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white">View plans →</a></div></div>; }

// ── Component ────────────────────────────────────────────────────────────────
// ── Certification Status Card ───────────────────────────────────────────────
function CertificationStatusCard({ profile }: { profile: BusinessProfile }) {
  const held = (profile.certifications ?? []).filter((c) =>
    CERTIFICATIONS.some((m) => m.value === c),
  );
  const dates = profile.certification_dates ?? {};
  const withDates = held.filter((c) => dates[c]);
  const anyExpiring = withDates.some((c) => certificationDaysRemaining(dates[c]) <= 90);
  return (
    <section
      className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      aria-labelledby="cert-status-heading"
    >
      <div className="mb-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 id="cert-status-heading" className="text-xl font-bold text-slate-900">🛡️ Certification Status</h2>
          <p className="mt-1 text-sm text-slate-500">
            {held.length === 0
              ? "Add your set-aside certifications so Contrax can track their renewal deadlines."
              : withDates.length === 0
                ? "Set expiration dates to get renewal reminders before it&apos;s too late."
                : `${withDates.length} of ${held.length} certification${held.length !== 1 ? "s" : ""} have dates on file.`}
          </p>
        </div>
        <a
          href="/tracking?tab=certifications"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 active:scale-[0.98] transition-all"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Update dates
        </a>
      </div>
      {held.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
          <p className="text-sm text-slate-600">
            No certifications on file yet.{" "}
            <a href="/settings" className="font-semibold text-blue-600 hover:underline">Add certifications in Settings</a>{" "}
            to start tracking renewal deadlines.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {held.map((cert) => {
            const date = dates[cert] ?? "";
            const days = certificationDaysRemaining(date);
            const status = certificationStatus(days);
            const meta = CERTIFICATIONS.find((m) => m.value === cert);
            return (
              <div key={cert} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{meta?.label ?? cert}</p>
                  <p className={`mt-0.5 text-xs font-medium ${status.text}`}>
                    {status.kind === "missing"
                      ? "No expiration date set"
                      : status.kind === "expired"
                        ? `Expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""} ago`
                        : days === 0
                          ? "Expires today"
                          : `${fmtCertDate(date)} · ${days} day${days !== 1 ? "s" : ""} left`}
                  </p>
                </div>
                <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${status.badge}`}>
                  {status.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {anyExpiring && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠️ One or more certifications expire within 90 days. Review your renewal timeline in{" "}
          <a href="/tracking?tab=certifications" className="font-semibold underline">Certification Tracking</a>.
        </p>
      )}
    </section>
  );
}
/**
 * Route wrapper: keeps the auth guard OUT of DashboardPage so its hooks always
 * run in the same order. The old guard sat before ~50 hooks — when the loader
 * result flipped between renders of the same fiber (SSR user=null → client
 * user present, or loader revalidation), React saw a different hook count and
 * threw #300/#301. The wrapper mounts the page only when the user is present,
 * and its own hooks (useLoaderData + useNavigate) are unconditional.
 */
function DashboardRoute() {
  const { user: currentUser } = Route.useLoaderData();
  const navigate = useNavigate();
  if (!currentUser) {
    navigate({ to: "/login" });
    return null;
  }
  return <DashboardTrialGate user={currentUser} />;
}
/**
 * Trial gate: same hazard — the old `if (trial?.expired) return <TrialExpired />`
 * sat mid-hooks, so a null→expired flip changed the hook count mid-fiber. The
 * gate owns the trial state and only mounts DashboardPage while the user is in
 * the trial window (or on a paid plan).
 */
function DashboardTrialGate({ user }: { user: AuthUser }) {
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  useEffect(() => { checkTrial().then(setTrial).catch(() => {}); }, []);
  // R1: after the TrialStartCard's one-click brief starts the lazy 14-day
  // trial, re-read the trial status so the TrialBanner + TrialChecklist mount
  // and the start-card hides (its own server predicate flips to show=false).
  const refreshTrial = useCallback(() => {
    checkTrial().then(setTrial).catch(() => {});
  }, []);
  if (trial?.expired) return <TrialExpired />;
  return <DashboardPage user={user} trial={trial} onTrialStarted={refreshTrial} />;
}
function DashboardPage({ user, trial, onTrialStarted }: { user: AuthUser; trial: TrialStatus | null; onTrialStarted?: () => void }) {
  // Dashboard data loads client-side from /api/dashboard-data (createServerFn
  // client RPCs silently fail on production, so the loader only resolves auth).
  const navigate = useNavigate();
  const location = useLocation();
  const [digest, setDigest] = useState<DigestResult | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [dataLoading] = useState(true);
  const loadDashboardData = useCallback((): Promise<void> => {
    return fetch("/api/dashboard-data")
      .then((r) => { if (!r.ok) throw new Error("Failed to load dashboard data"); return r.json(); })
      .then((d: DashboardData) => setData(d))
      .catch(() => {});
  }, []);
  useEffect(() => { loadDashboardData(); }, [loadDashboardData]);

  // Seed saved/dismissed sets from dashboard data (re-hydrated when the fetch resolves).
  const [savedBids, setSavedBids] = useState<Set<number>>(() => new Set((data?.savedMatches ?? []).filter((m) => m.status === "saved").map((m) => m.bid_id)));
  const [dismissedBids, setDismissedBids] = useState<Set<number>>(() => new Set((data?.savedMatches ?? []).filter((m) => m.status === "dismissed").map((m) => m.bid_id)));
  const [trackedBidIds, setTrackedBidIds] = useState<Set<string>>(new Set());
  const [expandedBid, setExpandedBid] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Record<number, string>>({});
  // Free saved-bid limit paywall (non-Professional users over the cap).
  const [showSavePaywall, setShowSavePaywall] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>(() =>
    mergeFilterState(parseReviewParams(location.search), readReviewFilters()).sort,
  );
  const [setAsideOnly, setSetAsideOnly] = useState<boolean>(() =>
    mergeFilterState(parseReviewParams(location.search), readReviewFilters()).setAsideOnly,
  );
  // Live/Open vs Archived(default live) matched-feed tabs. `archivedBids` is
  // null until the user opens the Archived tab (lazy server query), so the
  // default live page never pays the payload/query cost of the dead list.
  const [feedTab, setFeedTab] = useState<"live" | "archived">(() =>
    mergeFilterState(parseReviewParams(location.search), readReviewFilters()).feedTab,
  );
  const [archivedBids, setArchivedBids] = useState<ArchiveBid[] | null>(null);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedCount, setArchivedCount] = useState<number>(() => data?.archivedCount ?? 0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [trackingLoading, setTrackingLoading] = useState<Set<number>>(new Set());

  // ── Review-context persistence (shared filter mechanism) ────────────────
  // URL params are the source of truth for the ACTIVE view; localStorage
  // ("contrax.reviewFilters") keeps the context across reloads/sessions so it
  // STAYS PUT until the user deliberately changes it. Business-profile filters
  // (geo states, NAICS, set-aside/cert) live in the user's profile row and
  // naturally survive every session — the sticky bar mirrors those.

  // Patch the active view filters (sort / set-aside-only / feed tab): update
  // React state, the URL params, and localStorage all in one place.
  const applyFilterPatch = useCallback(
    (p: Partial<ReviewFilterState>) => {
      if (p.sort !== undefined && p.sort !== sortBy) setSortBy(p.sort);
      if (p.setAsideOnly !== undefined && p.setAsideOnly !== setAsideOnly) setSetAsideOnly(p.setAsideOnly);
      if (p.feedTab !== undefined && p.feedTab !== feedTab) setFeedTab(p.feedTab);
      const patch: Record<string, string> = {};
      if (p.sort !== undefined) patch.sort = p.sort === "due_date" ? "" : p.sort;
      if (p.setAsideOnly !== undefined) patch.setasideonly = p.setAsideOnly ? "1" : "";
      if (p.feedTab !== undefined) patch.feed = p.feedTab;
      navigate({
        to: "/dashboard",
        search: { ...((location.search as Record<string, unknown>) ?? {}), ...patch } as any,
        replace: true,
      });
      // Reflect the newest context into localStorage (URL overrides local).
      const merged = mergeFilterState(parseReviewParams(location.search), readReviewFilters());
      if (p.sort !== undefined) merged.sort = p.sort;
      if (p.setAsideOnly !== undefined) merged.setAsideOnly = p.setAsideOnly;
      if (p.feedTab !== undefined) merged.feedTab = p.feedTab;
      storeReviewFilters(merged);
    },
    [navigate, sortBy, setAsideOnly, feedTab, location.search],
  );

  // Deep-link handling: a ?bid_id= param focuses that bid in the current result
  // set (no re-query) and scrolls it into view once dashboard data is ready.
  const handledDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const raw = location.search.bid_id;
    const bidIdStr =
      Array.isArray(raw) ? String(raw[0] ?? "") : raw == null ? "" : String(raw);
    if (!bidIdStr) { handledDeepLinkRef.current = null; return; }
    const bidId = Number(bidIdStr);
    if (!Number.isFinite(bidId) || bidId <= 0) return;
    setExpandedBid(bidId);
    if (handledDeepLinkRef.current === bidIdStr) return;
    handledDeepLinkRef.current = bidIdStr;
    requestAnimationFrame(() => {
      document.getElementById(`bid-${bidId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [data, location.search.bid_id]);

  // Focus a single match within the current result set and persist it to the
  // URL so it survives navigation and is shareable.
  const focusBid = useCallback((bidId: number) => {
    setExpandedBid(bidId);
    navigate({
      to: "/dashboard",
      search: { ...((location.search as Record<string, unknown>) ?? {}), bid_id: String(bidId) } as any,
      replace: true,
    });
  }, [navigate, location.search]);

  // Return to the full results list (clears the single-match focus deep-link).
  const backToResults = useCallback(() => {
    setExpandedBid(null);
    const raw = location.search.bid_id;
    if (raw === undefined || raw === null) return;
    const next = { ...((location.search as Record<string, unknown>) ?? {}) };
    delete next.bid_id;
    navigate({ to: "/dashboard", search: next as any, replace: true });
    requestAnimationFrame(() => {
      const el = document.getElementById("match-feed");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [navigate, location.search]);

  // AI state — pre-populated from loader data so SSR-rendered cards already show
  // their summaries/scores/recommendations without a client-side re-fetch.
  const [summaries, setSummaries] = useState<Record<number, BidSummary>>(() => {
    const map: Record<number, BidSummary> = {};
    (data?.summaries ?? []).forEach((s) => { map[s.bid_id] = s; });
    return map;
  });
  const [healthcareSummaries, setHealthcareSummaries] = useState<Record<number, HealthcareSummary>>({});
  const [healthcareView, setHealthcareView] = useState<Record<number, boolean>>({});
  const [generatingHealthcare, setGeneratingHealthcare] = useState<Set<number>>(new Set());
  const [reviewMode, setReviewMode] = useState<Record<number, boolean>>({});
  const [drafts, setDrafts] = useState<Record<number, ProposalDraft>>(() => {
    const map: Record<number, ProposalDraft> = {};
    (data?.drafts ?? []).forEach((d) => { map[d.bid_id] = d; });
    return map;
  });
  const [scores, setScores] = useState<Record<number, BidScore>>(() => {
    const map: Record<number, BidScore> = {};
    (data?.scores ?? []).forEach((s) => { map[s.bid_id] = s; });
    return map;
  });
  const [recommendations, setRecommendations] = useState<Record<number, BidRecommendation>>(() => {
    const map: Record<number, BidRecommendation> = {};
    (data?.recommendations ?? []).forEach((r) => { map[Number(r.bid_id)] = r; });
    return map;
  });
  const [pricing, setPricing] = useState<Record<number, PricingRecommendation>>({});
  const [scoring, setScoring] = useState<Set<number>>(new Set());
  const [pricingLoading, setPricingLoading] = useState<Set<number>>(new Set());
  const [generatingSummary, setGeneratingSummary] = useState<Set<number>>(new Set());
  const [generatingProposal, setGeneratingProposal] = useState<Set<number>>(new Set());
  const [downloadingPdf, setDownloadingPdf] = useState<Set<number>>(new Set());
  const [aiError, setAiError] = useState<Record<number, string>>({});
  // Hydrate the seeded collections once the client-side dashboard data arrives.
  useEffect(() => {
    if (!data) return;
    setSavedBids(new Set((data.savedMatches ?? []).filter((m) => m.status === "saved").map((m) => m.bid_id)));
    setDismissedBids(new Set((data.savedMatches ?? []).filter((m) => m.status === "dismissed").map((m) => m.bid_id)));
    if (typeof data.archivedCount === "number") setArchivedCount(data.archivedCount);
    const sMap: Record<number, BidSummary> = {};
    (data.summaries ?? []).forEach((s) => { sMap[s.bid_id] = s; });
    setSummaries(sMap);
    const dMap: Record<number, ProposalDraft> = {};
    (data.drafts ?? []).forEach((d) => { dMap[d.bid_id] = d; });
    setDrafts(dMap);
    const scMap: Record<number, BidScore> = {};
    (data.scores ?? []).forEach((s) => { scMap[s.bid_id] = s; });
    setScores(scMap);
    const rMap: Record<number, BidRecommendation> = {};
    (data.recommendations ?? []).forEach((r) => { rMap[Number(r.bid_id)] = r; });
    setRecommendations(rMap);
  }, [data]);

  // Load cached pricing recommendations (lightweight; bid-card data comes from the
  // route loader, so this effect no longer re-fetches the full dashboard).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pricing-cache").then((r) => r.json()).then((pricingList) => {
      if (cancelled) return;
      const pricingMap: Record<number, PricingRecommendation> = {};
      pricingList.forEach((p) => { pricingMap[Number(p.bid_id)] = p; });
      setPricing(pricingMap);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Fetch tracked bid IDs
  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard-tracked").then((r) => r.json()).then((ids: string[]) => {
      if (!cancelled) setTrackedBidIds(new Set(ids));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!data?.profile) return;
    let cancelled = false;
    setDigestLoading(true);
    fetch("/api/dashboard-digest").then((r) => r.json()).then((result: DigestResult) => { if (!cancelled) setDigest(result); })
      .catch(() => { if (!cancelled) setDigest({ entries: [], hasRecentBids: false }); })
      .finally(() => { if (!cancelled) setDigestLoading(false); });
    return () => { cancelled = true; };
  }, [data?.profile]);

  const profile = data?.profile ?? null;
  const bids = data?.bids ?? [];
  const urgentTrackedCount = data?.urgentTrackedCount ?? 0;

  const profileCerts = Array.isArray(profile?.certifications) ? profile.certifications : [];
  // Live relevance is enforced server-side by /api/dashboard-data (the same SQL
  // matcher the onboarding count uses). The client keeps only the view-level
  // Set-Aside Only toggle + a defensive dismissed check.
  const filtered = profile
    ? bids.filter(
        (b) => !dismissedBids.has(b.id) && (!setAsideOnly || setAsideLabel(b.set_aside) !== null),
      )
    : [];
  const sorted = [...filtered].sort((a, b) => {
    // Set-aside-first boost: bids reserved for certifications the user holds float to the top.
    const aSetAsideBoost = setAsideMatchesCertifications(a.set_aside, profileCerts) ? 0 : 1;
    const bSetAsideBoost = setAsideMatchesCertifications(b.set_aside, profileCerts) ? 0 : 1;
    if (aSetAsideBoost !== bSetAsideBoost) return aSetAsideBoost - bSetAsideBoost;
    // Role-match boost: bids matching the user's staffing specialties float to the top.
    const aBoost = (a.role_matches || 0) > 0 ? 0 : 1;
    const bBoost = (b.role_matches || 0) > 0 ? 0 : 1;
    if (aBoost !== bBoost) return aBoost - bBoost;
    if (sortBy === "newest") return new Date(b.due_date).getTime() - new Date(a.due_date).getTime();
    if (sortBy === "value") return (b.estimated_value?.length || 0) - (a.estimated_value?.length || 0);
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
  });

  // ── Review-continuity cursor ────────────────────────────────────────────
  // Position of the currently-focused match within the CURRENT result set
  // (`sorted`), so Previous / Next iterate the adjacent match in the same
  // filtered context without re-running any query.
  const reviewPos = expandedBid != null ? sorted.findIndex((b) => b.id === expandedBid) : -1;

  const goToBidAt = useCallback((index: number) => {
    const bid = sorted[index];
    if (!bid) return;
    setExpandedBid(bid.id);
    if (!scores[bid.id]) doScore(bid.id);
    navigate({
      to: "/dashboard",
      search: { ...((location.search as Record<string, unknown>) ?? {}), bid_id: String(bid.id) } as any,
      replace: true,
    });
    requestAnimationFrame(() => {
      document.getElementById(`bid-${bid.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [sorted, scores, navigate, location.search]);

  const goNext = useCallback(() => {
    if (reviewPos < 0) return;
    goToBidAt(reviewPos + 1);
  }, [reviewPos, goToBidAt]);

  const goPrev = useCallback(() => {
    if (reviewPos <= 0) return;
    goToBidAt(reviewPos - 1);
  }, [reviewPos, goToBidAt]);

  // Archived feed: dead bids (past-due OR dismissed/closed) filtered to the same
  // profile relevance as the live feed, most-recently-closed first.
  const archivedFiltered = archivedBids && profile
    ? archivedBids
        .filter((b) => !setAsideOnly || setAsideLabel(b.set_aside) !== null)
        .sort(
          (a, b) =>
            (b.due_date ? new Date(b.due_date).getTime() : 0) -
            (a.due_date ? new Date(a.due_date).getTime() : 0),
        )
    : [];
  // Why an item is archived (real signals only): a non-saved saved_matches
  // status means the user dismissed / marked it no-go; otherwise it's past due.
  const archiveTag = (b: ArchiveBid) =>
    b.status && b.status !== "saved"
      ? { label: b.status === "dismissed" ? "Dismissed" : "No-go", cls: "bg-slate-200 text-slate-600" }
      : { label: "Closed — past due", cls: "bg-slate-100 text-slate-500" };

  const doSave = useCallback(async (bidId: number) => {
    // Free saved-bid limit: a non-Professional user over the cap saving a NEW
    // bid gets the upgrade paywall instead. Re-saving an already-saved bid is
    // fine. Admins/demo/Pro users bypass.
    if (!hasUnlimitedSaves(trial, user) && savedBids.size >= FREE_SAVE_LIMIT && !savedBids.has(bidId)) {
      setShowSavePaywall(true);
      setActionLoading(null);
      return;
    }
    setActionLoading(bidId);
    try {
      const res = await fetch("/api/bids-save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bidId }) });
      if (res.status === 403) { const b = await res.json().catch(() => null); if (b?.error === "save_limit") { setShowSavePaywall(true); return; } throw new Error(b?.error || "Failed to save bid"); }
      if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error || "Failed to save bid"); }
      setSavedBids((p) => new Set(p).add(bidId));
      setDismissedBids((p) => { const n = new Set(p); n.delete(bidId); return n; });
    } catch {} finally { setActionLoading(null); }
  }, [savedBids, trial, user]);

  const doDismiss = useCallback(async (bidId: number) => {
    setActionLoading(bidId);
    try {
      await dismissBid({ data: { bidId } });
      setDismissedBids((p) => new Set(p).add(bidId));
      setSavedBids((p) => { const n = new Set(p); n.delete(bidId); return n; });
      setArchivedCount((c) => c + 1); // dismissed → moves into Archive
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

  // Load the Archived (closed/no-go) list lazily the first time the user opens
  // the Archived tab. Server-side query lives in /api/dashboard-archive.
  const loadArchive = useCallback(async () => {
    if (archivedLoading || archivedBids) return;
    setArchivedLoading(true);
    try {
      const res = await fetch("/api/dashboard-archive");
      if (!res.ok) throw new Error("Failed to load archived bids");
      const d = await res.json();
      setArchivedBids(d.bids ?? []);
      setArchivedCount((d.bids ?? []).length);
    } catch {} finally { setArchivedLoading(false); }
  }, [archivedLoading, archivedBids]);

  // Move an archived bid back to Open (bids-save sets status='saved', which is
  // not an archived status, so it returns to the live feed on next load).
  const doRestore = useCallback(async (bidId: number) => {
    // Same cap as doSave: restoring an archived bid to Open is a save.
    if (!hasUnlimitedSaves(trial, user) && savedBids.size >= FREE_SAVE_LIMIT && !savedBids.has(bidId)) {
      setShowSavePaywall(true);
      setActionLoading(null);
      return;
    }
    setActionLoading(bidId);
    try {
      const res = await fetch("/api/bids-save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bidId }) });
      if (res.status === 403) { const b = await res.json().catch(() => null); if (b?.error === "save_limit") { setShowSavePaywall(true); return; } throw new Error("Failed to move bid back to open"); }
      if (!res.ok) throw new Error("Failed to move bid back to open");
      setArchivedBids((p) => (p ? p.filter((b) => b.id !== bidId) : p));
      setArchivedCount((c) => Math.max(0, c - 1));
      setDismissedBids((p) => { const n = new Set(p); n.delete(bidId); return n; });
      setSavedBids((p) => new Set(p).add(bidId));
    } catch {} finally { setActionLoading(null); }
  }, [savedBids, trial, user]);

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

  const doGenerateHealthcareSummary = useCallback(async (bidId: number) => {
    setGeneratingHealthcare((p) => new Set(p).add(bidId));
    setAiError((p) => { const n = { ...p }; delete n[bidId]; return n; });
    try {
      const result = await generateHealthcareSummary({ data: { bidId } });
      setHealthcareSummaries((p) => ({ ...p, [bidId]: result }));
      if (result.is_healthcare) setHealthcareView((p) => ({ ...p, [bidId]: true }));
    } catch (err) {
      setAiError((p) => ({ ...p, [bidId]: err instanceof Error ? err.message : "Healthcare summary generation failed" }));
    } finally {
      setGeneratingHealthcare((p) => { const n = new Set(p); n.delete(bidId); return n; });
    }
  }, []);

  const doGenerateProposal = useCallback(async (bidId: number) => {
    setGeneratingProposal((p) => new Set(p).add(bidId));
    setAiError((p) => { const n = { ...p }; delete n[bidId]; return n; });
    try {
      const res = await fetch("/api/bids-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bidId }) });
      if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error || "Proposal generation failed"); }
      const result = await res.json();
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
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId, regenerate }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      const result = res;
      setScores((p) => ({ ...p, [bidId]: result })); setActiveTab((p) => ({ ...p, [bidId]: "score" }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      const bid = bids.find((b) => b.id === bidId);
      if (bid && profile) {
        const recRes = await fetch("/api/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bid_title: bid.title, bid_id: String(bid.id), agency: bid.agency, description: bid.description, estimated_value: bid.estimated_value, naics_codes: profile.naics_codes, user_profile: profile, win_probability: result.win_probability }),
        }).then((r) => r.json());
        if (recRes.error) throw new Error(recRes.error);
        const rec = recRes;
        setRecommendations((p) => ({ ...p, [bidId]: rec }));
        await new Promise((r) => setTimeout(r, 300));
        fetch("/api/pricing-recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bid_title: bid.title, bid_id: String(bid.id), agency: bid.agency, description: bid.description, estimated_value: bid.estimated_value, naics_codes: profile.naics_codes }) }).then((r) => r.json()).then((pr) => setPricing((pp) => ({ ...pp, [bidId]: pr }))).catch(() => {});
      }
    }
    catch (err) { setAiError((p) => ({ ...p, [bidId]: err instanceof Error ? err.message : "Score generation failed" })); }
    finally { setScoring((p) => { const n = new Set(p); n.delete(bidId); return n; }); }
  }, [bids, profile]);

  const doPricing = useCallback(async (bidId: number, bid: Bid) => {
    setPricingLoading((p) => new Set(p).add(bidId));
    setAiError((p) => { const n = { ...p }; delete n[bidId]; return n; });
    try {
      const result = await fetch("/api/pricing-recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bid_title: bid.title, bid_id: String(bid.id), agency: bid.agency, description: bid.description, estimated_value: bid.estimated_value, naics_codes: profile?.naics_codes || [] }) }).then((r) => r.json());
      setPricing((p) => ({ ...p, [bidId]: result }));
    } catch (err) {
      setAiError((p) => ({ ...p, [bidId]: err instanceof Error ? err.message : "Pricing analysis failed" }));
    } finally {
      setPricingLoading((p) => { const n = new Set(p); n.delete(bidId); return n; });
    }
  }, [profile]);

  // ── Inline filter-chip removal (X-to-remove) ──────────────────────────────
  // Profile-level filters (geo states, NAICS, set-aside/cert) live in the user's
  // profile row. Removing one INLINE patches just that column via
  // /api/profile-filters (a targeted partial update — the full /api/profile save
  // would wipe sibling fields), then re-fetches /api/dashboard-data so the
  // persisted state AND the live result + count BOTH change. The removed filter
  // stays gone (persisted).
  const [filterUpdating, setFilterUpdating] = useState(false);
  const removeFilterChip = useCallback(async (kind: "geo" | "naics" | "setAside") => {
    if (!profile || filterUpdating) return;
    setFilterUpdating(true);
    try {
      const body: Record<string, string[]> =
        kind === "geo" ? { locations: [] }
        : kind === "naics" ? { naicsCodes: [] }
        : { certifications: [] };
      const res = await fetch("/api/profile-filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update filters");
      await loadDashboardData();
      // Keep the review-context localStorage store in sync with the DB profile:
      // the removed filter is gone server-side, so clear the mirror fields too
      // (clears states/naics/setAside on the matching kind; other fields incl.
      // URL-param semantics sort/setasideonly/feed/bid_id are untouched).
      writeReviewFilters(
        kind === "geo" ? { states: [] }
        : kind === "naics" ? { naics: [] }
        : { setAside: "" },
      );
    } catch {} finally { setFilterUpdating(false); }
  }, [profile, filterUpdating, loadDashboardData]);

  // Zero-matches "Broaden search (Include Nationwide)": drop the geo constraint
  // (clear locations) and re-query — the same persistence path as chip removal.
  const broadenNationwide = useCallback(() => {
    if (!profile || filterUpdating) return;
    removeFilterChip("geo");
  }, [profile, filterUpdating, removeFilterChip]);

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
  if (dataLoading && !data) return <LoadingSkeleton />;

  return (
    <div className="min-h-screen bg-slate-50">
      <PremiumUpgradeModal
        open={showSavePaywall}
        onClose={() => setShowSavePaywall(false)}
        title={SAVE_LIMIT_PAYWALL_TITLE}
        message={SAVE_LIMIT_PAYWALL_MESSAGE}
        checkoutPlan="starter"
        ctaLabel={SAVE_LIMIT_PAYWALL_CTA}
        priceNote={SAVE_LIMIT_PAYWALL_PRICE}
      />
      {user.email === "demo@contrax.company" && <div className="border-b border-blue-200 bg-blue-50 px-4 py-3 text-center text-sm text-blue-900">🔍 You're exploring a demo account with sample data. When you're ready, <a href="/signup" className="font-bold underline">create your free account</a> to track real bids.</div>}
      {location.search.notice === "admin-only" && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-900">
          Admin access is restricted to authorized users only.
        </div>
      )}
      {/* Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <div className="flex items-center gap-4">
            <a href="/alerts" className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">🔔 Alerts {data?.unreadAlerts ? <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">{data.unreadAlerts}</span> : null}</a>
            <a href="/tracking" className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">
              📅 Tracking
              {urgentTrackedCount > 0 && (
                <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">{urgentTrackedCount}</span>
              )}
            </a>
            <a href="/pipeline" className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">⭐ Pipeline</a>
            <a href="/workspace" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Team</a>
            <a href="/awards" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Awards</a>
            <a href="/trends" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">📊 Trends</a>
            <a href="/partners" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Partners</a>
            <a href="/losses" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Losses</a>
            <a href="/learnings" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">🧠 Learnings</a>
            <a href="/compliance" className="text-sm font-medium text-slate-400 hover:text-slate-600 hidden sm:inline transition-colors">Compliance</a>
              {user.is_admin && <a href="/admin" className="text-sm font-semibold text-amber-600 hover:text-amber-500 bg-amber-50 px-2.5 py-1 rounded-md transition-colors">⚙ Admin</a>}
            <span className="text-sm text-slate-500 hidden sm:inline">{user.email}</span>
            <button
              type="button"
              onClick={async () => { setLoggingOut(true); try { await fetch("/api/logout", { method: "POST" }); navigate({ to: "/" }); } catch { setLoggingOut(false); } }}
              disabled={loggingOut}
              className="text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              {loggingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* Radar login notification — "your radar matches are waiting" (in-app,
            NOT email). Shown on login and after until dismissed/saved. */}
        <RadarLoginNotify />
        {/* Saved radar matches (account-linked, in-app — NOT email): for a
            logged-in user whose email matches an unfulfilled radar_saves row,
            recompute + surface their current matching bids. */}
        <SavedRadarMatches />
        {/* R1: first-run trial-start surface — a free-Basic user whose
            14-day Professional trial has NOT started sees the one-click
            "run my first Executive Brief" card; it routes them to the
            existing premium brief path (which lazily starts the trial).
            Hides itself once the trial is active (server predicate). */}
        <TrialStartCard onTrialStarted={onTrialStarted} />

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

        {/* Part B — pending Technical Approach draft (score → signup promise):
            honest ready/processing state instead of a dead end. */}
        {data?.pendingDraft && (
          <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-blue-900">Your Technical Approach draft</h2>
                <p className="mt-0.5 text-[13px] text-blue-700">
                  {data.pendingDraft.has_draft_text
                    ? "Your draft for the solicitation you scored is ready."
                    : data.pendingDraft.status === "awaiting_profile"
                      ? "We're preparing your draft from the solicitation you pasted — it takes a few seconds."
                      : "We couldn't finish your draft the first time — retry from the draft page."}
                </p>
              </div>
              <a
                href="/draft/pending"
                className="inline-flex shrink-0 items-center rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-700"
              >
                {data.pendingDraft.has_draft_text ? "View draft →" : data.pendingDraft.status === "awaiting_profile" ? "Check status →" : "Retry →"}
              </a>
            </div>
          </div>
        )}
        {/* Certification status — deadlines for held set-aside certifications */}
        {profile && <CertificationStatusCard profile={profile} />}
        {/* How Contrax understands your business — collapsible profile summary */}
        {profile && <CompanyProfile profile={profile} />}
        {profile && <GettingStarted hasSavedBids={data.savedMatches.length > 0} hasDrafts={data.drafts.length > 0} />}

        <a href="/evaluate" className="mb-4 block rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-white p-5 shadow-sm transition hover:border-red-300"><div className="flex items-center justify-between gap-4"><div><div className="flex items-center gap-2"><h2 className="font-bold text-slate-900">🔴 Red Team</h2><span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Agency</span></div><p className="mt-1 text-sm text-slate-600">AI proposal auditing — find the holes before submission</p></div><span className="shrink-0 text-sm font-semibold text-red-700">Run review →</span></div></a>
        <a href="/competitors" className="mb-4 block rounded-2xl border border-blue-100 bg-white p-5 shadow-sm transition hover:border-blue-300"><div className="flex items-center justify-between gap-4"><div><h2 className="font-bold text-slate-900">Competitor intelligence</h2><p className="mt-1 text-sm text-slate-600">Top competing firm: <b>{data?.topCompetitor?.name || "No match yet"}</b>{data?.topCompetitor ? ` (${data.topCompetitor.awards} recent awards)` : ""}</p><p className="mt-1 text-xs text-slate-500">Competition in your categories: <b>{(data?.activeAwardees || 0) > 20 ? "High" : (data?.activeAwardees || 0) > 7 ? "Medium" : "Low"}</b></p></div><span className="shrink-0 text-sm font-semibold text-blue-700">View competitors →</span></div></a>
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
                  return <button key={entry.bid_id} type="button" onClick={() => { focusBid(entry.bid_id); if (!scores[entry.bid_id]) doScore(entry.bid_id); }} className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md">
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

        {trial?.active && <TrialBanner daysLeft={trial.daysLeft} planTier={trial.planTier} endsAt={trial.endsAt} />}
        {trial?.active && <div className="mx-auto max-w-5xl px-4 pt-4"><TrialChecklist /></div>}

        {/* Bid Matches */}
        {profile && (
          <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Match feeds">
            <button
              type="button"
              role="tab"
              aria-selected={feedTab === "live"}
              onClick={() => setFeedTab("live")}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                feedTab === "live"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              Open / Closing Soon
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${feedTab === "live" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>{sorted.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={feedTab === "archived"}
              onClick={() => { setFeedTab("archived"); loadArchive(); }}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                feedTab === "archived"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
              title="Closed, no-go, or dismissed opportunities"
            >
              Archived
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${feedTab === "archived" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>{archivedCount}</span>
            </button>
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{feedTab === "archived" ? "Archived Opportunities" : "Your Bid Matches"}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {feedTab === "archived"
                ? profile ? `${archivedFiltered.length} closed / no-go bid${archivedFiltered.length !== 1 ? "s" : ""} matching your profile` : "Set up your profile to see matching bids"
                : profile ? `${sorted.length} live bid${sorted.length !== 1 ? "s" : ""} matching your profile` : "Set up your profile to see matching bids"}
            </p>
            {data?.lastSynced && (
              <p className="mt-0.5 text-xs text-slate-400">
                Last synced: {fmtDate(data.lastSynced)} at {new Date(data.lastSynced).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </p>
            )}
          </div>
          {profile && feedTab === "live" && sorted.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => applyFilterPatch({ setAsideOnly: !setAsideOnly })}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  setAsideOnly
                    ? "bg-purple-600 text-white shadow-sm"
                    : "border border-slate-300 bg-white text-slate-600 hover:bg-purple-50 hover:text-purple-700"
                }`}
                title="Show only bids with a set-aside designation"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Set-Aside Only
              </button>
              <label htmlFor="sort" className="text-sm font-medium text-slate-600">Sort by:</label>
              <select id="sort" value={sortBy} onChange={(e) => applyFilterPatch({ sort: e.target.value as any })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white">
                <option value="due_date">Due date (closest)</option>
                <option value="newest">Newest</option>
                <option value="value">Highest value</option>
              </select>
            </div>
          )}
        </div>

        {/* Sticky, mobile-first filter bar — shared review-context mechanism */}
        {profile && (
          <StickyFilterBar
            states={profile.locations ?? []}
            setAsideLabel={
              profileCerts.length > 0
                ? profileCerts.map((c) => CERT_NAME[c] ?? c).join(", ")
                : setAsideOnly
                  ? "Set-asides only"
                  : "All set-asides"
            }
            naics={profile.naics_codes ?? []}
            sort={sortBy}
            setAsideOnly={setAsideOnly}
            total={feedTab === "live" ? sorted.length : undefined}
            onPatch={applyFilterPatch}
            onChangeGeo={() => navigate({ to: "/settings" })}
            onChangeSetAside={() => applyFilterPatch({ setAsideOnly: !setAsideOnly })}
            onChangeNaics={() => navigate({ to: "/settings" })}
            onRemoveGeo={(profile.locations ?? []).length > 0 ? () => removeFilterChip("geo") : undefined}
            onRemoveNaics={(profile.naics_codes ?? []).length > 0 ? () => removeFilterChip("naics") : undefined}
            onRemoveSetAside={profileCerts.length > 0 ? () => removeFilterChip("setAside") : undefined}
          />
        )}

        {/* Review-continuity pager — shown while a single match is focused */}
        {profile && feedTab === "live" && reviewPos >= 0 && (
          <div className="mt-3">
            <ReviewPager
              position={reviewPos}
              total={sorted.length}
              onBack={backToResults}
              onPrev={goPrev}
              onNext={goNext}
              setLabel="Open / Closing Soon"
            />
          </div>
        )}

        {/* Bid Cards */}
        {!profile ? (
          <div className="text-center py-12"><p className="text-slate-400">No profile yet — complete your onboarding to see bid matches.</p></div>
        ) : feedTab === "archived" ? (
          archivedLoading && !archivedBids ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500 shadow-sm">Loading archived opportunities...</div>
          ) : archivedFiltered.length === 0 ? (
            <div className="text-center py-12 rounded-2xl border border-slate-200 bg-white">
              <h3 className="text-lg font-semibold text-slate-700">No archived opportunities</h3>
              <p className="mt-1 text-sm text-slate-500">Closed, no-go, and dismissed bids will appear here.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {archivedFiltered.map((bid) => {
                const tag = archiveTag(bid);
                return (
                  <div key={bid.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label={`Archived bid: ${bid.title}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-slate-800 truncate">{bid.title}</h3>
                          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${tag.cls}`}>{tag.label}</span>
                          {setAsideLabel(bid.set_aside) && <span className="shrink-0 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700">{setAsideLabel(bid.set_aside)}</span>}
                        </div>
                        <p className="mt-0.5 text-sm text-slate-500">{bid.agency}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                          {bid.due_date ? <span className="font-medium text-slate-700">Due {fmtDate(bid.due_date)}</span> : <span className="text-slate-400">No due date</span>}
                          {bid.estimated_value && <span className="font-medium text-slate-700">{bid.estimated_value}</span>}
                          {bid.category && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{bid.category}</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => doRestore(bid.id)}
                        disabled={actionLoading === bid.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                        title="Move back to Open"
                      >
                        {actionLoading === bid.id ? "Moving…" : "Move to Open"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : sorted.length === 0 ? (
          <ZeroMatchesEmpty
            nationwide={profile.locations.length === 0}
            archivedCount={archivedCount}
            filterUpdating={filterUpdating}
            onBroaden={broadenNationwide}
            onOpenArchive={() => { setFeedTab("archived"); loadArchive(); }}
          />
        ) : (
          <div id="match-feed" className="space-y-4">
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
              const hcBid = isHealthcareBid(bid);
              const hcOn = hcBid && !!healthcareView[bid.id];
              const hcSummary = healthcareSummaries[bid.id];
              const isGenHealthcare = generatingHealthcare.has(bid.id);
              const elig = profile ? computeEligibility(bid, profile) : null;

              return (
                <div key={bid.id} id={`bid-${bid.id}`} className={`rounded-2xl border bg-white shadow-sm transition-all ${isExpanded ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}>
                  <button type="button" onClick={() => (isExpanded ? backToResults() : focusBid(bid.id))} className="w-full text-left p-5 flex flex-col sm:flex-row sm:items-center gap-4">
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
                        {bid.role_matches > 0 && (
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">🔵 {bid.role_matches} role match{bid.role_matches !== 1 ? "es" : ""}</span>
                        )}
                        {setAsideLabel(bid.set_aside) && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                              setAsideMatchesCertifications(bid.set_aside, profileCerts)
                                ? "bg-purple-600 text-white"
                                : "border border-purple-300 bg-purple-50 text-purple-700"
                            }`}
                            title={
                              setAsideMatchesCertifications(bid.set_aside, profileCerts)
                                ? "This set-aside matches one of your certifications"
                                : "Set-aside designation"
                            }
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                            {setAsideLabel(bid.set_aside)} Set-Aside
                          </span>
                        )}
                        {isHealthcareBid(bid) && (
                          <span className="inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700">🩺 Healthcare</span>
                        )}
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
                      {/* Opportunity Detail — Eligibility, Key dates, Summary (additive) */}
                      {elig && (
                        <div className="mx-5 mt-4 space-y-4">
                          {/* 1. Eligibility verdict widget */}
                          <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-4 sm:p-5" aria-label="Eligibility verdict for this opportunity">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Eligibility</p>
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${eligibilityVerdictStyle(elig.verdict).pill}`}>{eligibilityVerdictStyle(elig.verdict).dot} {elig.verdict}</span>
                            </div>
                            <p className="mt-2 text-sm text-slate-600">{elig.summary}</p>
                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                              {elig.dimensions.map((d) => {
                                const ds = eligibilityDimStyle(d.status);
                                return (
                                  <div key={d.label} className="rounded-lg border border-slate-200 bg-white p-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-semibold text-slate-600">{d.label}</span>
                                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${ds.pill}`}>{ds.txt}</span>
                                    </div>
                                    <p className="mt-1 text-xs leading-snug text-slate-500">{d.reason}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            {/* 2. Key dates */}
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Key dates</p>
                              <div className="mt-2 flex items-center justify-between">
                                <span className="text-sm text-slate-600">Proposal due</span>
                                <span className="inline-flex items-center gap-2">
                                  <span className="text-sm font-semibold text-slate-800">{fmtDate(bid.due_date)}</span>
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${cd.bg} ${cd.text}`}>{cd.label}</span>
                                </span>
                              </div>
                              {bid.created_at && (
                                <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                                  <span>Listed / synced</span>
                                  <span>{fmtDate(bid.created_at)}</span>
                                </div>
                              )}
                            </div>
                            {/* 3. Plain-English summary surfaced structurally */}
                            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-500">Quick summary</p>
                                {summary && (
                                  <button type="button" onClick={() => setActiveTab((p) => ({ ...p, [bid.id]: "summary" }))} className="text-xs font-medium text-blue-600 hover:underline">Full AI Summary →</button>
                                )}
                              </div>
                              <div className="mt-2">
                                {summary ? (
                                  <>
                                    <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-line">{summary.summary_text}</p>
                                    {summary.key_requirements.length > 0 && (
                                      <div className="mt-2 flex flex-wrap gap-1.5">
                                        {summary.key_requirements.slice(0, 3).map((req, i) => (
                                          <span key={i} className="rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">{req}</span>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                ) : isGenSummary ? (
                                  <p className="text-sm text-slate-500 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" />Generating summary…</p>
                                ) : (
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm text-slate-500">A plain-English read of what this contract needs.</p>
                                    <button type="button" onClick={() => doGenerateSummary(bid.id)} disabled={isGenSummary} className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Generate summary</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
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
                            {hcBid && (
                            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-2.5">
                              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-teal-700">🩺 Healthcare View</span>
                              <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
                                <button type="button" onClick={() => setHealthcareView((p) => ({ ...p, [bid.id]: false }))} className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${!hcOn ? "bg-teal-600 text-white" : "text-slate-600 hover:text-slate-800"}`}>Standard</button>
                                <button type="button" onClick={() => { if (!hcSummary && !isGenHealthcare) doGenerateHealthcareSummary(bid.id); setHealthcareView((p) => ({ ...p, [bid.id]: true })); }} className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${hcOn ? "bg-teal-600 text-white" : "text-slate-600 hover:text-slate-800"}`}>Healthcare</button>
                              </div>
                              <span className="text-xs text-teal-600">{hcOn && hcSummary ? "Staffing-focused breakdown" : hcOn ? "Generating staffing breakdown…" : "Extract roles, shifts, credentials & contract terms"}</span>
                            </div>
                          )}
                          {hcOn ? (
                            hcSummary ? (
                              <div className="space-y-4">
                                <div className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-5">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 mb-2 flex items-center gap-1.5">🩺 AI Healthcare Summary</p>
                                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{hcSummary.summary_text}</p>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white p-5">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Required Roles &amp; Headcount</p>
                                  {hcSummary.required_roles.length > 0 ? (
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      {hcSummary.required_roles.map((r, i) => (
                                        <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2.5">
                                          <span className="text-sm font-semibold text-slate-800">{r.role}</span>
                                          <span className="text-xs text-slate-500">{r.headcount}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : <p className="text-sm text-slate-400">Not specified</p>}
                                </div>
                                <div className="grid gap-4 sm:grid-cols-3">
                                  <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Facility Type</p><p className="text-sm text-slate-700">{hcSummary.facility_type}</p></div>
                                  <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Contract Duration</p><p className="text-sm text-slate-700">{hcSummary.contract_duration}</p></div>
                                  <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Renewal Terms</p><p className="text-sm text-slate-700">{hcSummary.renewal_terms}</p></div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Shift Schedules / Hours</p><p className="text-sm text-slate-700 whitespace-pre-line">{hcSummary.shift_schedules}</p></div>
                                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-2">Credential Requirements</p>
                                  {hcSummary.credential_requirements.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {hcSummary.credential_requirements.map((c, i) => (
                                        <span key={i} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-800">🪪 {c}</span>
                                      ))}
                                    </div>
                                  ) : <p className="text-sm text-slate-400">Not specified</p>}
                                  <a href={`/compliance?bid_id=${bid.id}`} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600">Check against your licenses →</a>
                                </div>
                                {hcSummary.key_notes && hcSummary.key_notes !== "Not specified" && (
                                  <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-1">Key Notes</p>
                                    <p className="text-sm text-slate-700 whitespace-pre-line">{hcSummary.key_notes}</p>
                                  </div>
                                )}
                                <div className="flex items-center gap-3">
                                  <button type="button" onClick={() => doGenerateHealthcareSummary(bid.id)} disabled={isGenHealthcare} className="text-xs font-medium text-slate-400 hover:text-teal-600 disabled:opacity-50">{isGenHealthcare ? "Regenerating..." : "Regenerate"}</button>
                                  <p className="text-xs text-slate-400">Generated {fmtDateTime(hcSummary.generated_at)}</p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center justify-center py-8 text-center">
                                {isGenHealthcare ? (
                                  <>
                                    <div className="flex items-center gap-1 mb-3">
                                      <span className="h-2 w-2 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                                      <span className="h-2 w-2 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                                      <span className="h-2 w-2 rounded-full bg-teal-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                                    </div>
                                    <p className="text-sm font-medium text-slate-600">Extracting staffing requirements...</p>
                                    <p className="text-xs text-slate-400 mt-1">Roles, headcount, shifts, credentials, and contract terms</p>
                                  </>
                                ) : (
                                  <>
                                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 mb-4 shadow-lg shadow-teal-200">
                                      <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-6-4.35-9-8.5C1.5 9.5 3.5 6 6.5 6c2 0 3.5 1 4.5 2.5C12 7 13.5 6 15.5 6c3 0 5 3.5 4.5 6.5C18 16.65 12 21 12 21z" /></svg>
                                    </div>
                                    <p className="text-sm font-semibold text-slate-700">Generate the Healthcare View</p>
                                    <p className="text-xs text-slate-500 mt-1 mb-4 max-w-xs">AI extracts required roles, headcount, shift schedules, facility type, credentials, and contract terms for your staffing team.</p>
                                    <button type="button" onClick={() => doGenerateHealthcareSummary(bid.id)} className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 active:scale-[0.98] transition-all">🩺 Generate Healthcare Summary</button>
                                  </>
                                )}
                              </div>
                            )
                          ) : summary ? (
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
                            {score.role_fit && (
                              <div className="rounded-lg border border-teal-100 bg-teal-50/50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-teal-600">Role Fit (Staffing)</p><p className="mt-1 text-sm leading-relaxed text-slate-700">{score.role_fit}</p></div>
                            )}
                            <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">AI Analysis</p><p className="mt-1 text-sm leading-relaxed text-slate-700">{score.ai_explanation}</p></div>
                            <FeedbackWidget context="win_probability" solicitationRef={String(bid.id)} aiOutputSummary={`${score.win_probability}% win probability: ${score.ai_explanation}`} />
                            <button type="button" onClick={() => doScore(bid.id, true)} disabled={isScoring} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">{isScoring ? "Regenerating…" : "Regenerate Score"}</button>
                          </div> : <div className="py-8 text-center"><p className="text-sm text-slate-600">{isScoring ? "Analyzing win probability…" : "No win probability yet."}</p><button type="button" onClick={() => doScore(bid.id)} disabled={isScoring} className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white">{isScoring ? "Analyzing…" : "Calculate Win Probability"}</button></div>}</div>
                        )}

                        {/* Proposal Draft Tab */}
                        {currentTab === "draft" && (
                          <div>
                            {draft ? (
                              <div className="space-y-4">
                                <div className="rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-white p-5 max-h-96 overflow-y-auto">
                                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-green-600 flex items-center gap-1.5">
                                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                                      Drafting Intelligence
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <div className="inline-flex items-center rounded-lg border border-green-200 bg-white p-0.5 text-xs font-medium">
                                        <button
                                          type="button"
                                          onClick={() => setReviewMode((p) => ({ ...p, [bid.id]: false }))}
                                          className={`rounded-md px-2.5 py-1 transition-colors ${!reviewMode[bid.id] ? "bg-green-600 text-white" : "text-slate-500 hover:text-slate-700"}`}
                                        >
                                          Draft
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setReviewMode((p) => ({ ...p, [bid.id]: true }))}
                                          className={`rounded-md px-2.5 py-1 transition-colors ${reviewMode[bid.id] ? "bg-amber-400 text-white" : "text-slate-500 hover:text-slate-700"}`}
                                        >
                                          Review
                                        </button>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => doGenerateProposal(bid.id)}
                                        disabled={isGenProposal}
                                        className="text-xs font-medium text-slate-400 hover:text-green-600 disabled:opacity-50"
                                      >
                                        {isGenProposal ? "Regenerating..." : "Regenerate"}
                                      </button>
                                    </div>
                                  </div>
                                  <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{renderDraftText(draft.draft_text, draft.citations, !!reviewMode[bid.id])}</div>
                                  {(!draft.citations || draft.citations.length === 0) && (
                                    <p className="mt-3 text-xs italic text-slate-400">
                                      No FAR citations in this draft — the proposal sections below were written from the business profile.
                                    </p>
                                  )}
                                  {reviewMode[bid.id] && draft.citations && draft.citations.length > 0 && (
                                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 flex items-center gap-1.5">
                                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                                        Why the AI wrote this
                                      </p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        Every clause below is a real FAR/DFARS clause, validated against the FAR clause library. Click a highlighted citation in the draft or "View clause" to read the full text.
                                      </p>
                                      <div className="mt-3 space-y-3">
                                        {draft.citations.map((c) => (
                                          <div key={c.clause_number} className="rounded-lg border border-amber-200 bg-white p-3">
                                            <div className="flex items-start justify-between gap-3">
                                              <p className="text-sm font-semibold text-slate-800">
                                                FAR {c.clause_number} — {c.title}
                                              </p>
                                              <a
                                                href={`/clauses/${c.clause_number}`}
                                                className="shrink-0 text-xs font-medium text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-700 hover:decoration-solid"
                                              >
                                                View clause →
                                              </a>
                                            </div>
                                            <div className="mt-2 max-h-40 overflow-y-auto rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 whitespace-pre-line">
                                              {c.full_text}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <FeedbackWidget context="proposal" solicitationRef={String(bid.id)} aiOutputSummary={draft.draft_text.slice(0, 500)} />
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
