import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { getCurrentUser } from "~/lib/auth";
import { sql } from "~/db";
import { trackEvent } from "~/lib/track";
import { buildProfileContext } from "~/lib/profile-context";
import { getRelevantContext } from "~/lib/knowledge";
import type { BusinessProfile } from "~/components/CompanyProfile";
import { FeedbackWidget } from "~/components/FeedbackWidget";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Briefcase,
  CheckCircle2,
  DollarSign,
  FileText,
  Gauge,
  Info,
  ListChecks,
  Loader2,
  ShieldAlert,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  XCircle,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
interface ScoreResult {
  overallFit: number; // 0-100
  certifications: string[]; // required certs, each "Name — you have this | you don't have this | required"
  pastPerformance: string; // what past performance is required + relevance assessment
  contractSize: string; // estimated value range, if discernible
  competitiveness: "Low" | "Medium" | "High";
  missingQualifications: string[]; // gaps between requirements and the business
  estimatedEffort: "Low" | "Medium" | "High";
  reasons: string[]; // 3-5 plain-English reasons for the score
  recommendation: "GO" | "CAUTIOUS" | "NO-GO";
}

interface ScoreInput {
  solicitation: string;
  businessInfo: string;
}
type ScoreSearch = {
  text?: string;
};
// ── SEO FAQ content (rendered below the tool + as FAQPage schema) ───────────
const scoreFaqs = [
  {
    q: "What is a solicitation score?",
    a: "A solicitation score is a 0–100 fit rating that estimates how winnable a government bid is for your business. Contrax reads the actual solicitation text — scope of work, requirements, certifications, and evaluation criteria — and scores it across 9 dimensions: overall fit, required certifications, past performance, contract size, competitiveness, missing qualifications, estimated effort, and the reasons behind the call. You get the score plus a GO, CAUTIOUS, or NO-GO recommendation in plain English.",
  },
  {
    q: "How accurate is the score?",
    a: "The analysis is grounded in the solicitation text you paste and, when you add it, your real business information — certifications, past performance, size, and experience. It is deliberately critical: it flags missing certifications, disqualifying requirements, and tough competition instead of inflating your odds. Treat it as an expert second opinion for prioritizing which bids deserve your proposal hours, not a guarantee of award — contract outcomes also depend on your full proposal and the agency's evaluation.",
  },
  {
    q: "Do I need to sign up?",
    a: "No. The scoring tool is completely free and anonymous — paste a solicitation, get your score, no account, login, or credit card required. You only sign up for Contrax when you want to track bids, get deadline alerts, draft proposals, run compliance checks, and use the rest of the platform.",
  },
  {
    q: "What do GO, CAUTIOUS, and NO-GO mean?",
    a: "GO means the solicitation looks like a strong fit (a score of 65 or higher with no critical gaps) and is worth a real proposal effort. CAUTIOUS means there are fixable gaps or moderate competition (40–64) — dig deeper before committing hours. NO-GO means critical requirements are unmet or competition is stacked against you (below 40) — your time is better spent on other bids.",
  },
  {
    q: "Can I score state and local government bids too?",
    a: "Yes. The tool handles federal, state, county, city, and local solicitations — RFPs, RFQs, RFIs, and ITBs — as long as you paste the actual solicitation text. It also understands set-aside designations like 8(a), SDVOSB/VOSB, WOSB/EDWOSB, and HUBZone.",
  },
];

// ── Server function: honest AI win-probability analysis ─────────────────────
const scoreSolicitation = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = (data ?? {}) as Partial<ScoreInput>;
    const solicitation = String(d.solicitation || "").trim();
    if (!solicitation) throw new Error("Please paste a solicitation first.");
    return {
      solicitation: solicitation.slice(0, 20000),
      businessInfo: String(d.businessInfo || "").trim().slice(0, 4000),
    };
  })
  .handler(async ({ data }): Promise<ScoreResult> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key not configured");

    // Fetch business profile if user is logged in
    let profileContext = "";
    try {
      const user = await getCurrentUser();
      if (user) {
        const profiles = await sql()`
          SELECT id, business_name, industry, locations, service_categories, naics_codes,
                 uei, cage_code, sam_expiration, duns, certifications,
                 years_in_business, employee_count, annual_revenue,
                 past_performance_summary, capability_statement, specialties, licenses,
                 typical_contract_value, is_agency, logo_url
          FROM business_profiles WHERE user_id = ${user.id} LIMIT 1`;
        if (profiles.length > 0) {
          profileContext = buildProfileContext(profiles[0] as unknown as BusinessProfile);
        }
      }
    } catch { /* anonymous user or DB not ready — use textarea only */ }

    const businessBlock = profileContext
      ? `===== BUSINESS PROFILE (from user's Contrax account) =====\n${profileContext}\n\n===== ADDITIONAL BUSINESS NOTES (for this bid) =====\n${data.businessInfo || "(None provided)"}`
      : `===== BUSINESS DESCRIPTION =====\n${data.businessInfo || "(Not provided — evaluate on the solicitation alone and note assumptions.)"}`;
    const knowledgeCtx = await getRelevantContext(data.solicitation.slice(0, 2500));

    const systemPrompt = `You are a seasoned government contracting analyst with 20 years of experience reviewing federal, state, and local solicitations (RFPs, RFQs, RFIs, ITBs) for small businesses. Your job is to give an honest, critical, evidence-based assessment of whether a business can win a specific solicitation — NOT to be encouraging. Small businesses lose government contracts far more often than they win them; a realistic analysis is the most valuable thing you can provide. Be blunt about gaps, missing certifications, competition, and effort. Never inflate scores. Return ONLY valid JSON.`;

    const userPrompt = `Analyze the solicitation and business description below, then return ONLY a valid JSON object with exactly these fields:

{
  "overallFit": number 0-100,
  "certifications": ["Name — status", ...],
  "pastPerformance": "string",
  "contractSize": "string",
  "competitiveness": "Low" | "Medium" | "High",
  "missingQualifications": ["string", ...],
  "estimatedEffort": "Low" | "Medium" | "High",
  "reasons": ["string", ...],
  "recommendation": "GO" | "CAUTIOUS" | "NO-GO"
}

Field rules:
1. overallFit — honest 0-100 score. Anchor around 35-55 for a typical small business. Only score above 75 when the business clearly meets nearly every requirement with strong evidence. Score below 30 when key requirements are unmet or competition is fierce. Be critical, not optimistic.
2. certifications — list EVERY certification, license, clearance, or socioeconomic designation the solicitation requires (e.g. HUBZone, 8(a), SDVOSB/VOSB, WOSB, EDWOSB, CMMC level, security clearance, state license). Format each entry EXACTLY as "Name — you have this" when the business info confirms it, "Name — you don't have this" when the business info contradicts or omits it, or "Name — required" when no business info was provided. Use an empty array when the solicitation requires none.
3. pastPerformance — what past performance the solicitation requires (e.g. "3 of 5 similar contracts in the last 3 years", references, CPARS ratings) and, if business info was provided, whether the business's experience plausibly satisfies it.
4. contractSize — estimated value range if discernible (e.g. "$250K–$500K, 1-year base with 4 option years"); if not stated, say so and give a rough expectation implied by the work type.
5. competitiveness — "Low" | "Medium" | "High" plus ONE-sentence reason (likely number of bidders, set-asides, incumbent advantage, agency buying patterns).
6. missingQualifications — specific gaps between the solicitation's requirements and the business as described (e.g. "No CMMC Level 2 certification", "No relevant past performance in the last 3 years", "No HUBZone certification"). If no business info was provided, base this on what the solicitation requires that a typical new entrant would struggle to meet. Empty array if none.
7. estimatedEffort — "Low" | "Medium" | "High" plus ONE-sentence reason (proposal page count, scope complexity, evaluation rigor, orals/demos required).
8. reasons — exactly 3-5 plain-English strings mixing genuine strengths AND concerns that explain the score. Be specific to THIS solicitation.
9. recommendation — "GO" only if overallFit >= 65 and no critical gaps; "CAUTIOUS" if 40-64 or some gaps are fixable; "NO-GO" if below 40 or a critical disqualifier exists.

Be critical and honest. Do not reward effort — only demonstrated fit.

===== SOLICITATION =====
${data.solicitation}

${businessBlock}${knowledgeCtx ? `

Use these excerpts from the user's knowledge base to ground your analysis (they may include prior capability statements, proposal templates, or compliance checklists):
${knowledgeCtx}` : ""}`;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          max_tokens: 1200,
          temperature: 0.2,
        }),
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${errBody.substring(0, 200)}`);
      }
      const json = (await response.json()) as any;
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error("No content in OpenAI response");
      const parsed = JSON.parse(content);

      const clampScore = (n: unknown) =>
        Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
      const pickEnum = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
        allowed.includes(String(v) as T) ? (String(v) as T) : fallback;

      const result: ScoreResult = {
        overallFit: clampScore(parsed.overallFit),
        certifications: Array.isArray(parsed.certifications)
          ? parsed.certifications.map(String).slice(0, 12)
          : [],
        pastPerformance: String(parsed.pastPerformance || "Not specified in the solicitation."),
        contractSize: String(parsed.contractSize || "Not stated in the solicitation."),
        competitiveness: pickEnum(parsed.competitiveness, ["Low", "Medium", "High"] as const, "Medium"),
        missingQualifications: Array.isArray(parsed.missingQualifications)
          ? parsed.missingQualifications.map(String).slice(0, 10)
          : [],
        estimatedEffort: pickEnum(parsed.estimatedEffort, ["Low", "Medium", "High"] as const, "Medium"),
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 5) : [],
        recommendation: pickEnum(parsed.recommendation, ["GO", "CAUTIOUS", "NO-GO"] as const, "CAUTIOUS"),
      };
      return result;
    } catch (err) {
      throw new Error(
        `Couldn't score this solicitation: ${err instanceof Error ? err.message : "AI request failed"}`
      );
    }
  });

// ── Helpers ──────────────────────────────────────────────────────────────────
function scoreColor(score: number): string {
  const hue = Math.round((Math.max(0, Math.min(100, score)) / 100) * 120); // 0 red → 120 green
  return `hsl(${hue}, 72%, 42%)`;
}
function scoreLabel(score: number): string {
  if (score >= 75) return "Strong fit";
  if (score >= 55) return "Decent fit";
  if (score >= 40) return "Weak fit";
  return "Long shot";
}
function certStatus(cert: string): "matched" | "missing" | "unknown" {
  const s = cert.toLowerCase();
  if (s.includes("you have") || s.includes("matched") || s.includes("listed") || s.includes("✓"))
    return "matched";
  if (
    s.includes("you don't") ||
    s.includes("not") ||
    s.includes("missing") ||
    s.includes("lacks") ||
    s.includes("✗")
  )
    return "missing";
  return "unknown";
}
function recStyle(rec: string) {
  if (rec === "GO") return { badge: "bg-green-100 text-green-800 border-green-200", label: "GO — worth pursuing" };
  if (rec === "NO-GO") return { badge: "bg-red-100 text-red-800 border-red-200", label: "NO-GO — don't bid" };
  return { badge: "bg-amber-100 text-amber-800 border-amber-200", label: "CAUTIOUS — dig deeper first" };
}
function scoreTone(score: number) {
  if (score >= 65) return { text: "text-green-700", bg: "bg-green-50" };
  if (score >= 40) return { text: "text-amber-700", bg: "bg-amber-50" };
  return { text: "text-red-700", bg: "bg-red-50" };
}

function ScoreGauge({ score }: { score: number }) {
  const r = 84;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = c * (1 - clamped / 100);
  const color = scoreColor(clamped);
  return (
    <div className="relative mx-auto h-52 w-52">
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
        <circle cx="100" cy="100" r={r} fill="none" stroke="#e2e8f0" strokeWidth="14" />
        <circle
          cx="100"
          cy="100"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease, stroke 1s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-extrabold tracking-tight text-slate-900">{clamped}</span>
        <span className="mt-1 text-sm font-medium text-slate-400">out of 100</span>
      </div>
    </div>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/score")({
  validateSearch: (search: Record<string, unknown>): ScoreSearch => ({
    text: typeof search.text === "string" && search.text.trim().length > 0 ? search.text : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Free Government Contract Scoring Tool — Contrax" },
      {
        name: "description",
        content:
          "Free government contract bid scoring. Paste any RFP, RFQ, or RFI and get an honest AI win-probability score with a GO, CAUTIOUS, or NO-GO call. No signup required.",
      },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company/score" },
      { property: "og:title", content: "Free Government Contract Scoring Tool — Contrax" },
      {
        property: "og:description",
        content:
          "Check if you can win that government contract — free. Paste any RFP, RFQ, or RFI and get an honest AI win-probability analysis across 9 dimensions: fit score, certifications, past performance, competition, and a GO/CAUTIOUS/NO-GO recommendation. No signup required.",
      },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Contrax — Free AI government contract scoring tool. Paste a solicitation and get a GO/CAUTIOUS/NO-GO bid score." },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Free Government Contract Scoring Tool — Contrax" },
      {
        name: "twitter:description",
        content:
          "Check if you can win that government contract — free. Paste any RFP, RFQ, or RFI and get an honest AI win-probability score and a GO/CAUTIOUS/NO-GO call. No signup required.",
      },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Contrax — Free AI government contract scoring tool. Paste a solicitation and get a GO/CAUTIOUS/NO-GO bid score." },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/score" }],
  }),
  component: ScorePage,
});

function ScorePage() {
  const { text } = Route.useSearch();
  const [solicitation, setSolicitation] = useState(text || "");
  const [businessInfo, setBusinessInfo] = useState("");
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState("");

  const trimmed = solicitation.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < 300;

  const handleScore = async () => {
    setError("");
    if (!trimmed) {
      setValidationError("Paste a solicitation first — the tool needs the actual text to analyze.");
      return;
    }
    trackEvent("score_submit");
    setValidationError("");
    setLoading(true);
    try {
      const res = await scoreSolicitation({ data: { solicitation: trimmed, businessInfo: businessInfo.trim() } });
      setResult(res);
      trackEvent("score_result", res.recommendation);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setResult(null);
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong while scoring. Please try again in a moment."
      );
    } finally {
      setLoading(false);
    }
  };

  // One-shot auto-run: when arriving with a `?text=` search param (homepage hero flow),
  // start the analysis immediately so the visitor gets a score in a single action.
  // The ref guard fires exactly once (React StrictMode double-mounts effects in dev) and
  // blocks any later re-run from manual button clicks or text edits.
  const autoRunRef = useRef(false);

  useEffect(() => {
    if (autoRunRef.current) return;
    if (!text) return;
    autoRunRef.current = true;
    void handleScore();
  }, [text]);

  const reset = () => {
    setResult(null);
    setError("");
    setValidationError("");
  };

  const rec = result ? recStyle(result.recommendation) : null;
  const tone = result ? scoreTone(result.overallFit) : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "Free Government Contract Scoring Tool — Contrax",
            url: "https://www.contrax.company/score",
            description:
              "Free AI government contract scoring tool. Paste any solicitation (RFP, RFQ, RFI) and get a win-probability score across 9 dimensions with a GO, CAUTIOUS, or NO-GO recommendation. No signup required.",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Any",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            publisher: { "@type": "Organization", name: "Contrax", url: "https://www.contrax.company" },
          }),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: scoreFaqs.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }),
        }}
      />
      <main className="mx-auto max-w-4xl px-4 py-10 lg:py-14">
        {/* ── Header / SEO hero ──────────────────────────────────────── */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-slate-600 shadow-sm">
            <Target className="h-3.5 w-3.5 text-blue-600" />
            Free AI bid analysis — no login needed
          </div>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold tracking-tight text-slate-900 lg:text-5xl">
            Check If You Can Win That Government Contract —{" "}
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Free
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[16px] leading-relaxed text-slate-600">
            Paste any federal, state, or local solicitation — RFP, RFQ, RFI, or ITB — and get an
            honest AI win-probability analysis across 9 dimensions: fit score, required
            certifications, past performance, contract size, competition, effort, and the gaps
            standing between you and the award — ending in a clear{" "}
            <span className="font-semibold text-green-700">GO</span>,{" "}
            <span className="font-semibold text-amber-700">CAUTIOUS</span>, or{" "}
            <span className="font-semibold text-red-700">NO-GO</span> call.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13.5px] font-medium text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Free
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              No signup
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Instant results
            </span>
          </div>
        </div>

        {/* ── Input card ─────────────────────────────────────────────── */}
        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
          <p className="mb-4 text-xs text-slate-400">
            Bid data is sent to OpenAI for processing. Data is not used for model training. <a href="/privacy#6-ai-data-handling" className="underline underline-offset-2 hover:text-slate-600">Learn more →</a>
          </p>
          <label htmlFor="solicitation" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <FileText className="h-4 w-4 text-blue-600" />
            Solicitation text
          </label>
          <textarea
            id="solicitation"
            value={solicitation}
            onChange={(e) => {
              setSolicitation(e.target.value);
              if (validationError) setValidationError("");
            }}
            rows={10}
            disabled={loading}
            placeholder={
              "Paste the solicitation here…\n\nExample:\n\"The City of Austin seeks a qualified contractor to provide IT managed services for 400 endpoints over a 3-year period (est. $2.5M). Offerors must hold a HUBZone certification, have 5 years of similar experience, and provide 3 references of comparable scope. Proposals are evaluated 40% technical, 30% past performance, 30% price…\""
            }
            className="mt-2 w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
          />
          <p className="mt-2 text-[13px] text-slate-500">
            The more you paste — scope of work, requirements, certifications, evaluation criteria — the more accurate the score.
          </p>
          {validationError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13.5px] text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {validationError}
            </div>
          )}
          {tooShort && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13.5px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This looks very short for a solicitation — the analysis will be less reliable. Paste the full text if you have it. You can still score what you've pasted.
              </span>
            </div>
          )}

          <label htmlFor="businessInfo" className="mt-6 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Briefcase className="h-4 w-4 text-blue-600" />
            Describe your business <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id="businessInfo"
            value={businessInfo}
            onChange={(e) => setBusinessInfo(e.target.value)}
            rows={4}
            disabled={loading}
            placeholder={
              "e.g. 12-person IT services firm, HUBZone certified, 5 years of federal experience with 3 similar contracts, UEI registered in SAM.gov…"
            }
            className="mt-2 w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
          />
          <p className="mt-2 text-[13px] text-slate-500">
            Add this so the analysis can check certifications, past performance, and size against your actual business. If you&rsquo;re logged in, your saved Contrax profile is used automatically.
          </p>

          <button
            onClick={handleScore}
            disabled={loading}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Analyzing your chances…
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" />
                Score My Chances 🎯
              </>
            )}
          </button>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[13.5px] text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* ── Loading state ──────────────────────────────────────────── */}
        {loading && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <div className="mx-auto h-12 w-12 rounded-full border-4 border-slate-200 border-t-blue-600 animate-spin" />
            <p className="mt-4 font-semibold text-slate-800">Reading the fine print…</p>
            <p className="mt-1 text-sm text-slate-500">
              Checking certifications, past performance, and competition. Usually takes 15–30 seconds.
            </p>
          </div>
        )}

        {/* ── Results ────────────────────────────────────────────────── */}
        {result && !loading && (
          <div className="mt-8 space-y-6">
            {/* Score hero card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
              <div className="flex flex-col items-center gap-8 lg:flex-row lg:gap-12">
                <ScoreGauge score={result.overallFit} />
                <div className="flex-1 text-center lg:text-left">
                  <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                    Overall fit
                  </p>
                  <h2 className={`mt-1 text-3xl font-extrabold tracking-tight ${tone?.text}`}>
                    {scoreLabel(result.overallFit)}
                  </h2>
                  <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
                    This is our honest read of how well this solicitation fits your business — not
                    a guarantee. Contract awards depend on your full proposal, competition, and the
                    agency's evaluation.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${rec?.badge}`}>
                      <Gauge className="h-4 w-4" />
                      {rec?.label}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${tone?.bg} border-slate-200 text-slate-700`}>
                      <TrendingUp className="h-4 w-4" />
                      {result.competitiveness} competition
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-sm font-semibold text-slate-700">
                      <Timer className="h-4 w-4" />
                      {result.estimatedEffort} effort
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Score → signup conversion CTA */}
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-6 text-center shadow-sm lg:p-8">
              <h3 className="text-xl font-bold text-slate-900">
                {result.recommendation === "GO"
                  ? "This one's worth pursuing — don't lose it."
                  : result.recommendation === "CAUTIOUS"
                    ? "Worth digging deeper — don't lose this bid."
                    : "Tough call — but the next bid is out there."}
              </h3>
              <div className="mt-5 flex flex-col items-center gap-3">
                <a
                  href="/signup?plan=professional"
                  onClick={() => trackEvent("score_cta_click", result.recommendation)}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl active:scale-[0.98]"
                >
                  <FileText className="h-4 w-4" />
                  Draft my Technical Approach for this bid
                </a>
                <a
                  href={`/signup?plan=professional&score_rec=${result.recommendation}`}
                  onClick={() => trackEvent("score_cta_click", result.recommendation)}
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-[13px] font-semibold text-blue-700 shadow-sm transition-colors hover:bg-blue-50 active:scale-[0.99]"
                >
                  Start free trial
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
              </div>
              <p className="mt-3 text-[13.5px] leading-relaxed text-slate-600">
                Save this bid, get deadline alerts, and see the full compliance breakdown — 21-day
                free trial, no credit card required.
              </p>
            </div>

            {/* Detail sections */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Certifications */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
                  <Award className="h-5 w-5 text-blue-600" />
                  Certifications &amp; licenses
                </h3>
                {result.certifications.length === 0 ? (
                  <p className="mt-3 text-[14.5px] text-slate-600">
                    No certifications or licenses are required for this solicitation.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2.5">
                    {result.certifications.map((cert, i) => {
                      const status = certStatus(cert);
                      return (
                        <li key={i} className="flex items-start gap-2 text-[14.5px] text-slate-700">
                          {status === "matched" && (
                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                          )}
                          {status === "missing" && (
                            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                          )}
                          {status === "unknown" && (
                            <Info className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                          )}
                          <span>{cert}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!businessInfo.trim() && result.certifications.length > 0 && (
                  <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-500">
                    Tip: add your business info above to see whether you already hold these.
                  </p>
                )}
              </div>

              {/* Missing qualifications */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
                  <ShieldAlert className="h-5 w-5 text-red-500" />
                  Missing qualifications
                </h3>
                {result.missingQualifications.length === 0 ? (
                  <p className="mt-3 text-[14.5px] text-slate-600">
                    No major gaps found — you appear to meet the stated requirements.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2.5">
                    {result.missingQualifications.map((gap, i) => (
                      <li key={i} className="flex items-start gap-2 text-[14.5px] text-slate-700">
                        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                        <span>{gap}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Past performance */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
                  <Briefcase className="h-5 w-5 text-blue-600" />
                  Past performance
                </h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-slate-600">{result.pastPerformance}</p>
              </div>

              {/* Contract size */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                  Contract size
                </h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-slate-600">{result.contractSize}</p>
              </div>
            </div>

            {/* Reasons */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
              <h3 className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
                <ListChecks className="h-5 w-5 text-blue-600" />
                Why this score
              </h3>
              {result.reasons.length === 0 ? (
                <p className="mt-4 text-[15px] text-slate-600">
                  The analysis didn't return individual reasons — review the sections above for the
                  full breakdown.
                </p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {result.reasons.map((reason, i) => (
                    <li key={i} className="flex items-start gap-3 text-[15px] leading-relaxed text-slate-700">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                      {reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* CTA */}
            <div className={`rounded-2xl border p-6 text-center shadow-sm lg:p-8 ${tone?.bg}`}>
              <h3 className="text-xl font-bold text-slate-900">
                Want the full picture — and help winning this one?
              </h3>
              <p className="mx-auto mt-2 max-w-xl text-[15px] leading-relaxed text-slate-600">
                Sign up to track this bid, get deadline alerts, a full AI proposal draft, compliance
                checks, and pricing recommendations — all powered by the same engine.
              </p>
              <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  to="/signup"
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 active:scale-[0.99]"
                >
                  Sign up to track this bid &amp; get proposal help
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <button
                  onClick={reset}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-[15px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.99]"
                >
                  Score another solicitation
                </button>
              </div>
            </div>
            <FeedbackWidget context="score" solicitationRef="" aiOutputSummary={`Solicitation scored at ${result.overallFit}/100`} />
          </div>
        )}

        {/* ── How it works (always crawlable) ────────────────────────── */}
        <section className="mt-16 lg:mt-20">
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              How the government bid scoring tool works
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-600">
              No forms, no downloads, no sales call. Paste the bid and get a straight answer in
              under a minute.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <h3 className="mt-4 text-[15px] font-bold text-slate-900">1. Paste the solicitation</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600">
                Copy the scope of work, requirements, certifications, and evaluation criteria from
                the RFP, RFQ, or RFI — or arrive pre-filled from a search via the{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-[12.5px] text-slate-700">?text=</code>{" "}
                link.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
                <Sparkles className="h-5 w-5 text-blue-600" />
              </div>
              <h3 className="mt-4 text-[15px] font-bold text-slate-900">2. AI scores 9 dimensions</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600">
                An analyst-grade model checks fit score, required certifications, past performance,
                contract size, competition, effort, and the gaps — grounded in your business info
                when you add it.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
                <Gauge className="h-5 w-5 text-blue-600" />
              </div>
              <h3 className="mt-4 text-[15px] font-bold text-slate-900">3. Get your GO / CAUTIOUS / NO-GO call</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600">
                See exactly why the score is what it is, what you're missing, and whether this bid
                deserves your proposal hours — before you burn a week writing one.
              </p>
            </div>
          </div>
        </section>

        {/* ── FAQ ────────────────────────────────────────────────────── */}
        <section className="mt-16 lg:mt-20">
          <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mx-auto mt-8 max-w-3xl space-y-5">
            {scoreFaqs.map((faq) => (
              <div key={faq.q} className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="font-semibold text-slate-900">{faq.q}</h3>
                <div className="mt-2 text-sm leading-relaxed text-gray-600">{faq.a}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bottom CTA ─────────────────────────────────────────────── */}
        <section className="mt-16 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 px-6 py-14 text-center sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Score every bid. Then win it.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-blue-100/80">
            The free score is just the first step. Contrax tracks the solicitations you care about,
            drafts compliant proposals, checks FAR/DFARS requirements, and sends deadline alerts —
            built for 8(a), SDVOSB, WOSB, and HUBZone-certified small businesses.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-7 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-400 hover:shadow-xl active:scale-[0.98]"
            >
              Start your free trial
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/pricing"
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-7 py-3.5 text-[15px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
            >
              See pricing
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
