import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { sql } from "~/db";
import { US_STATES } from "~/lib/states";
import { IncumbentCard } from "~/components/IncumbentCard";
import { getFPDSIntel, type FPDSIntel } from "~/lib/fpds";
import { SaveToPipeline } from "~/components/SaveToPipeline";
import { getCurrentUser } from "~/lib/auth";
import { getSavedBidIds } from "~/lib/saved-matches";
import { trackEvent } from "~/lib/track";

// Milestone Grant — logged-out visitors accumulate a cross-tab counter of
// teased incumbent-intel card views (localStorage); when the counter reaches
// this threshold the CURRENT card offers a one-per-device email-for-data
// exchange instead of the signup CTA. See loadIntel below.
const MILESTONE_THRESHOLD = 5;

// ── Types ──────────────────────────────────────────────────────────────────────
interface Award {
  id: number; title: string; agency: string; solicitation_number: string | null;
  winning_company: string; award_amount: string; award_date: string;
  incumbent: string | null; category: string | null; location: string | null;
  naics_code: string | null; description: string | null; source_url: string | null;
}
interface SimilarBid {
  id: number; title: string; agency: string; due_date: string;
  estimated_value: string; category: string;
}

const SEED_AWARDS = [
  { title:"Fort Bragg Barracks Renovation", agency:"DoD", solicitation_number:"W91247-23-R-0042", winning_company:"Hensel Phelps", award_amount:"$12,400,000", award_date:"2024-03-15", incumbent:"Turner Construction", category:"Construction", location:"Fort Bragg, NC", naics_code:"236220", description:"Design-build renovation of two barracks buildings (A-1421 & A-1427) including HVAC upgrades, plumbing replacement, electrical modernization, and interior finishes for 400+ soldier housing units.", source_url:"https://sam.gov/opp/abc123def" },
  { title:"VA Medical Center IT Modernization", agency:"VA", solicitation_number:"36C10X24-R-0018", winning_company:"Leidos", award_amount:"$8,700,000", award_date:"2023-11-02", incumbent:"CACI International", category:"IT Services", location:"Washington, DC", naics_code:"541512", description:"Comprehensive IT infrastructure modernization for 12 VA medical centers across the Mid-Atlantic. Includes network upgrades, EHR integration, cybersecurity hardening (NIST 800-53), and 24/7 help desk for 15,000 clinical staff endpoints.", source_url:"https://sam.gov/opp/def456ghi" },
  { title:"GSA Building Maintenance Services", agency:"GSA", solicitation_number:"47PM0024-R-0031", winning_company:"J&J Maintenance", award_amount:"$2,100,000", award_date:"2024-01-22", incumbent:"ABM Industries", category:"Janitorial", location:"Denver, CO", naics_code:"561720", description:"Full-service janitorial and building maintenance for the Byron G. Rogers Federal Building and U.S. Courthouse. Daily cleaning, waste management, floor care, window washing, and preventative maintenance for 380,000 sq ft across 18 floors.", source_url:"https://sam.gov/opp/jkl789mno" },
  { title:"DHS Cybersecurity Operations Support", agency:"DHS", solicitation_number:"70RTAC24-R-0009", winning_company:"Booz Allen Hamilton", award_amount:"$24,500,000", award_date:"2024-06-10", incumbent:"Northrop Grumman", category:"IT Services", location:"Arlington, VA", naics_code:"541519", description:"SOC Tier 2/3 operations support for DHS Network Security Deployment. 24/7 threat monitoring, incident response, threat hunting, and red team penetration testing across .gov civilian networks. Requires TS/SCI-cleared personnel.", source_url:"https://sam.gov/opp/pqr012stu" },
  { title:"I-95 Bridge Rehabilitation — Richmond", agency:"DOT", solicitation_number:"693C73-24-B-0007", winning_company:"Flatiron Construction", award_amount:"$18,200,000", award_date:"2024-02-28", incumbent:null, category:"Construction", location:"Richmond, VA", naics_code:"237310", description:"Rehabilitation of four I-95 bridge structures (mile markers 74-78) including deck replacement, steel girder repairs, bearing replacement, and approach slab reconstruction. Staged lane closures maintaining two lanes each direction during peak hours.", source_url:"https://sam.gov/opp/vwx345yza" },
  { title:"HHS Healthcare Consulting BPA", agency:"HHS", solicitation_number:"75P00124-R-0025", winning_company:"Deloitte Consulting", award_amount:"$49,800,000", award_date:"2024-05-03", incumbent:"Accenture Federal Services", category:"Consulting", location:"Bethesda, MD", naics_code:"541611", description:"Blanket Purchase Agreement for healthcare policy consulting, actuarial analysis, program evaluation, and data analytics supporting CMS, CDC, and NIH. 5-year period of performance (base + 4 option years).", source_url:"https://sam.gov/opp/bcd678efg" },
  { title:"USDA Forest Service Wildfire Suppression", agency:"USDA", solicitation_number:"1282B124-R-0014", winning_company:"Erickson Incorporated", award_amount:"$6,300,000", award_date:"2024-04-17", incumbent:"Erickson Incorporated", category:"Supplies", location:"Boise, ID", naics_code:null, description:"Heavy-lift helicopter services for wildfire suppression across National Forest System lands in Regions 1, 4, and 6. Type 1 helicopters with water buckets, fuel tenders, and dedicated flight crews available 120 days/year during fire season.", source_url:"https://sam.gov/opp/hij901klm" },
  { title:"NASA Langley Research Center Security Services", agency:"NASA", solicitation_number:"80LARC24-R-0005", winning_company:"Paragon Systems", award_amount:"$4,150,000", award_date:"2023-09-30", incumbent:"Securitas Critical Infrastructure", category:"Security", location:"Hampton, VA", naics_code:"561612", description:"Armed security officer services for NASA Langley Research Center. Access control, patrol services, emergency response, visitor processing, and classified area protection. Requires Secret clearances and VA DCJS armed registration.", source_url:"https://sam.gov/opp/nop345qrs" },
  { title:"EPA Superfund Site Remediation — Region 5", agency:"EPA", solicitation_number:"68HE0H24-R-0012", winning_company:"CH2M Hill (Jacobs)", award_amount:"$15,600,000", award_date:"2024-08-01", incumbent:null, category:"Construction", location:"Chicago, IL", naics_code:"562910", description:"Remedial action at the Southeast Chicago Superfund site. Soil excavation, groundwater treatment system installation, and long-term monitoring for 25-year compliance period. Includes community air monitoring and EPA community engagement plan requirements.", source_url:"https://sam.gov/opp/zab901cde" },
  { title:"DOE National Lab IT Support Services", agency:"DOE", solicitation_number:"89243324-R-0004", winning_company:"SAIC", award_amount:"$32,000,000", award_date:"2024-03-01", incumbent:"SAIC", category:"IT Services", location:"Oak Ridge, TN", naics_code:"541513", description:"Enterprise IT support for Oak Ridge National Laboratory including HPC cluster management, scientific computing support, classified network operations, and cybersecurity compliance per DOE O 205.1. 1,200+ scientific and administrative users supported.", source_url:"https://sam.gov/opp/fgh234ijk" },
];

// ── Server Functions ───────────────────────────────────────────────────────────

const HEALTHCARE_KEYWORDS = [
  "health", "medical", "nurse", "nursing", "physician", "clinician", "clinical",
  "hospital", "tricare", "medicare", "medicaid", "pharma", "pharmacy", "dental",
  "behavioral", "mental health", "substance abuse", "telehealth",
  "telemedicine", "emr", "ehr", "hipaa",
];

// SAM.gov locations are normalized as "City, ST" (and some records contain just
// the state code). Match the extracted state code against every US state + DC.
const STATE_LOCATION_REGEX = new RegExp(
  `(?:^|,\\s*)(${US_STATES.join("|")})(?:$|\\s|,)`,
  "i",
);

const getAwardsData = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { search?: string } }): Promise<{ awards: Award[]; similarBids: Record<number, SimilarBid[]> }> => {
  // The sync job stores procurement opportunities in `bids`.  Do not use the
  // legacy `awarded_contracts` table here: it is unrelated to synced data and
  // is not present in every production database.
  try { await sql()`ALTER TABLE bids ADD COLUMN IF NOT EXISTS naics_code TEXT`; } catch {}
  const search = data.search?.trim() ?? "";
  // Keep the URL-driven filter in the server query so SSR never serializes
  // unrelated opportunities into the initial HTML payload.
  const rows = search.toLowerCase() === "healthcare"
    ? await sql()`
        SELECT id, title, agency, description, location, category, due_date,
               estimated_value, source_url, created_at, naics_code
        FROM bids
        WHERE (
          title ILIKE '%health%' OR description ILIKE '%health%' OR
          title ILIKE '%medical%' OR description ILIKE '%medical%' OR
          title ILIKE '%nurse%' OR description ILIKE '%nurse%' OR
          title ILIKE '%nursing%' OR description ILIKE '%nursing%' OR
          title ILIKE '%physician%' OR description ILIKE '%physician%' OR
          title ILIKE '%clinician%' OR description ILIKE '%clinician%' OR
          title ILIKE '%clinical%' OR description ILIKE '%clinical%' OR
          title ILIKE '%hospital%' OR description ILIKE '%hospital%' OR
          title ILIKE '%tricare%' OR description ILIKE '%tricare%' OR
          title ILIKE '%medicare%' OR description ILIKE '%medicare%' OR
          title ILIKE '%medicaid%' OR description ILIKE '%medicaid%' OR
          title ILIKE '%pharma%' OR description ILIKE '%pharma%' OR
          title ILIKE '%pharmacy%' OR description ILIKE '%pharmacy%' OR
          title ILIKE '%dental%' OR description ILIKE '%dental%' OR
          title ILIKE '%behavioral%' OR description ILIKE '%behavioral%' OR
          title ILIKE '%mental health%' OR description ILIKE '%mental health%' OR
          title ILIKE '%substance abuse%' OR description ILIKE '%substance abuse%' OR

          title ILIKE '%telehealth%' OR description ILIKE '%telehealth%' OR
          title ILIKE '%telemedicine%' OR description ILIKE '%telemedicine%' OR
          title ILIKE '%emr%' OR description ILIKE '%emr%' OR
          title ILIKE '%ehr%' OR description ILIKE '%ehr%' OR
          title ILIKE '%hipaa%' OR description ILIKE '%hipaa%'
        )
        ORDER BY created_at DESC NULLS LAST, due_date ASC NULLS LAST
        LIMIT 100
      `
    : search
      ? await sql()`
          SELECT id, title, agency, description, location, category, due_date,
                 estimated_value, source_url, created_at, naics_code
          FROM bids
          WHERE (title ILIKE ${"%" + search + "%"} OR description ILIKE ${"%" + search + "%"})
          ORDER BY created_at DESC NULLS LAST, due_date ASC NULLS LAST
          LIMIT 100
        `
      : await sql()`
          SELECT id, title, agency, description, location, category, due_date,
                 estimated_value, source_url, created_at, naics_code
          FROM bids
          ORDER BY created_at DESC NULLS LAST, due_date ASC NULLS LAST
          LIMIT 100
        `;
  const awards: Award[] = (rows as any[]).map((r) => ({
    id: Number(r.id),
    title: r.title || "Untitled opportunity",
    agency: r.agency || "Unknown agency",
    solicitation_number: null,
    // Synced records are opportunities, not completed awards. Keep the shared
    // award card shape while making that distinction explicit to users.
    winning_company: "Open opportunity",
    award_amount: r.estimated_value || "Not specified",
    award_date: r.created_at || r.due_date ? String(r.created_at || r.due_date).slice(0, 10) : "",
    incumbent: null,
    category: r.category || null,
    location: r.location || null,
    naics_code: r.naics_code || null,
    description: r.description || null,
    source_url: r.source_url || null,
  }));

  const similarBids: Record<number, SimilarBid[]> = {};
  for (const award of awards) {
    const cat = award.category;
    const loc = award.location;
    if (!cat) { similarBids[award.id] = []; continue; }
    const parts = loc ? loc.split(",")[0].trim() : "";
    const bidRows = parts
      ? await sql()`SELECT id, title, agency, due_date, estimated_value, category FROM bids WHERE id <> ${award.id} AND (category ILIKE ${"%" + cat + "%"} OR location ILIKE ${"%" + parts + "%"}) ORDER BY due_date ASC NULLS LAST LIMIT 5`
      : await sql()`SELECT id, title, agency, due_date, estimated_value, category FROM bids WHERE id <> ${award.id} AND category ILIKE ${"%" + cat + "%"} ORDER BY due_date ASC NULLS LAST LIMIT 5`;
    similarBids[award.id] = (bidRows as any[]).map((b) => ({
      id: Number(b.id), title: b.title, agency: b.agency,
      due_date: b.due_date ? String(b.due_date).slice(0, 10) : "Not specified",
      estimated_value: b.estimated_value || "Not specified", category: b.category || "",
    }));
  }
  return { awards, similarBids };
});

const getIncumbentIntel = createServerFn({ method: "GET" }).handler(async ({ data }: { data: { naicsCode: string; agency: string; title: string } }): Promise<FPDSIntel | null> => {
  return getFPDSIntel(data.naicsCode, data.agency, data.title);
});

// ── Route ──────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/awards")({
  validateSearch: (search: Record<string, unknown>) => ({
    search: typeof search.search === "string" ? search.search : undefined,
  }),
  loader: async ({ context }) => {
    // Resolve the current user + their saved bid ids so SSR renders the correct
    // logged-in/logged-out button state (and the saved state) in the HTML.
    const currentUser = await getCurrentUser();
    const [data, savedBidIds] = await Promise.all([
      getAwardsData({ data: { search: context.search } }),
      currentUser
        ? getSavedBidIds({ data: { userId: currentUser.id } })
        : Promise.resolve([] as number[]),
    ]);
    return { ...data, currentUser, savedBidIds };
  },
  component: AwardsPage,
  head: () => ({
    meta: [
      { title: "Government Contract Awards Database — Contrax" },
      {
        name: "description",
        content:
          "Browse live federal and city set-aside contract opportunities with incumbent intelligence and 5-year pricing history — built for 8(a), SDVOSB, WOSB, and HUBZone-certified small businesses.",
      },
      { name: "robots", content: "index, follow" },
      // Open Graph
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company/awards" },
      { property: "og:title", content: "Government Contract Awards Database — Contrax" },
      {
        property: "og:description",
        content:
          "Browse live federal and city set-aside contract opportunities with incumbent intelligence and 5-year pricing history — built for 8(a), SDVOSB, WOSB, and HUBZone-certified small businesses.",
      },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:alt", content: "Government Contract Awards Database — Contrax" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:site_name", content: "Contrax" },
      // Twitter Card
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Government Contract Awards Database — Contrax" },
      {
        name: "twitter:description",
        content:
          "Browse live federal and city set-aside contract opportunities with incumbent intelligence and 5-year pricing history — built for certified small businesses.",
      },
      { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
      { name: "twitter:image:alt", content: "Government Contract Awards Database — Contrax" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/awards" }],
  }),
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtDate(d: string | null | undefined) {
  if (!d) return "Not specified";
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? "Not specified" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Component ──────────────────────────────────────────────────────────────────
function AwardsPage() {
  const { awards, similarBids, currentUser, savedBidIds } = Route.useLoaderData();
  const routeSearch = Route.useSearch();
  const [search, setSearch] = useState("");
  const inputSearch = search || routeSearch.search || "";
  const [agencyFilter, setAgencyFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [intel, setIntel] = useState<Record<number, FPDSIntel | null | undefined>>({});
  const [loadingIntel, setLoadingIntel] = useState<number | null>(null);
  // Session-scoped "first one's free" grant: the FIRST intel card a logged-out
  // visitor expands in a tab-session shows full data (no wall). sessionStorage
  // persists across client-side nav and refresh within the tab; a new tab grants
  // again. Guarded for browser-only access (loadIntel is a client event handler).
  const [freeRevealAwardId, setFreeRevealAwardId] = useState<number | null>(null);
  const FREE_INTEL_GRANT_KEY = "contrax_free_intel_granted";
  function freeIntelGranted(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.sessionStorage.getItem(FREE_INTEL_GRANT_KEY) === "1"; } catch { return false; }
  }
  function grantFreeIntel(): void {
    if (typeof window === "undefined") return;
    try { window.sessionStorage.setItem(FREE_INTEL_GRANT_KEY, "1"); } catch { /* ignore */ }
  }
  // Milestone Grant (one per device): a cross-tab counter of teased-card views
  // (localStorage — deliberate: the first-free grant is per-tab sessionStorage,
  // so a per-tab milestone counter would be meaningless). At the threshold, the
  // current card shows the email-capture offer; the grant is marked used in the
  // SAME synchronous block so concurrent tabs can never double-grant.
  const [milestoneOfferAwardId, setMilestoneOfferAwardId] = useState<number | null>(null);
  const [milestoneRevealAwardId, setMilestoneRevealAwardId] = useState<number | null>(null);
  const MILESTONE_COUNT_KEY = "contrax_milestone_count";
  const MILESTONE_GRANTED_KEY = "contrax_milestone_granted";
  function readMilestoneCount(): number {
    if (typeof window === "undefined") return 0;
    try {
      const raw = window.localStorage.getItem(MILESTONE_COUNT_KEY);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch { return 0; }
  }
  function writeMilestoneCount(n: number): void {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(MILESTONE_COUNT_KEY, String(n)); } catch { /* ignore */ }
  }
  function milestoneGranted(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(MILESTONE_GRANTED_KEY) === "1"; } catch { return false; }
  }
  function grantMilestone(): void {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(MILESTONE_GRANTED_KEY, "1"); } catch { /* ignore */ }
  }
  function handleMilestoneGranted(awardId: number): void {
    setMilestoneRevealAwardId(awardId);
    trackEvent("milestone_grant_submit", String(awardId), "/awards");
    trackEvent("milestone_card_reveal", String(awardId), "/awards");
  }
  // Deep-link scroll: homepage hero "Get Incumbent Intel" → /awards#feed should
  // land visitors on the award feed, not the page top. The browser handles the
  // initial load natively (the list is SSR-rendered); this also covers SPA
  // navigations where the hash target must be scrolled to explicitly.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#feed") {
      document.getElementById("feed")?.scrollIntoView({ behavior: "instant", block: "start" });
    }
  }, []);
  async function loadIntel(award: Award) {
    if (loadingIntel === award.id) return;
    if (intel[award.id] !== undefined) { setExpandedId(award.id); return; }
    setLoadingIntel(award.id); setExpandedId(award.id);
    const result = await getIncumbentIntel({ data: { naicsCode: award.naics_code, agency: award.agency, title: award.title } });
    setIntel((prev) => ({ ...prev, [award.id]: result })); setLoadingIntel(null);
    // Logged-out users: the first expanded card WITH REAL DATA is granted free
    // (full data, no wall). Data-less cards (no FPDS history) never consume the
    // grant and fire no events. Every later data card shows the tease wall —
    // record the wall view then. Grant check+write are in the same synchronous
    // block after the await, so in-flight fetches cannot double-grant.
    if (!currentUser && result !== null) {
      if (!freeIntelGranted()) {
        grantFreeIntel();
        setFreeRevealAwardId(award.id);
        trackEvent("incumbent_first_free_view", String(award.id), "/awards");
      } else if (freeRevealAwardId !== award.id) {
        trackEvent("incumbent_gate_view", String(award.id), "/awards");
        // Milestone Grant: count every teased-card view in a cross-tab counter
        // (localStorage). At the threshold (and if the one-per-device grant is
        // unused), mark the grant used + offer the email exchange on THIS card —
        // check+write+event in the same synchronous block, so in-flight fetches
        // across tabs cannot double-grant. A refresh reverts this card to the
        // normal teaser (state resets) but the grant stays used forever.
        if (!milestoneGranted()) {
          const next = readMilestoneCount() + 1;
          writeMilestoneCount(next);
          if (next >= MILESTONE_THRESHOLD) {
            grantMilestone();
            setMilestoneOfferAwardId(award.id);
            trackEvent("milestone_grant_view", String(award.id), "/awards");
          }
        }
      }
    }
  }

  const agencies = [...new Set(awards.map((a) => a.agency))].sort();
  const categories = [...new Set(awards.filter((a) => a.category).map((a) => a.category!))].sort();

  // When searching for "healthcare", expand to the full set of healthcare keywords
  const filtered = awards.filter((a) => {
    if (search) {
      if (search.toLowerCase() === "healthcare") {
        const haystack = [
          a.title, a.winning_company, a.description, a.category,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!HEALTHCARE_KEYWORDS.some((kw) => haystack.includes(kw))) return false;
      } else {
        const q = search.toLowerCase();
        if (!a.title.toLowerCase().includes(q) && !a.winning_company.toLowerCase().includes(q) && !(a.description || "").toLowerCase().includes(q)) return false;
      }
    }
    if (agencyFilter && a.agency !== agencyFilter) return false;
    if (categoryFilter && a.category !== categoryFilter) return false;
    if (stateFilter) {
      // SAM.gov locations are normalized as "City, ST" (and some records
      // contain just the state code). Match the extracted state code only.
      const match = (a.location || "").match(STATE_LOCATION_REGEX);
      if (!match || match[1].toUpperCase() !== stateFilter) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-700">Dashboard</a>
            {!currentUser && (
              <a
                href="/signup?plan=professional&next=/awards"
                onClick={() => trackEvent("awards_signup_click", "header", "/awards")}
                className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 whitespace-nowrap transition-colors hover:bg-amber-300"
              >
                See Who Won This
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* Hero */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Past Awards</h1>
          <p className="mt-2 text-lg text-slate-500">Learn from awarded contracts to sharpen your bids</p>
          {!currentUser && (
            <a
              href="/signup?plan=professional&next=/awards"
              onClick={() => trackEvent("awards_signup_click", "hero", "/awards")}
              className="mt-5 inline-flex items-center rounded-xl bg-amber-400 px-6 py-3 text-sm font-semibold text-slate-900 shadow-lg shadow-amber-500/25 transition-all hover:bg-amber-300 hover:shadow-xl active:scale-[0.98]"
            >
              Get Incumbent Intel
            </a>
          )}
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label htmlFor="award-search" className="sr-only">Search awards</label>
            <input
              id="award-search"
              type="text"
              placeholder="Search by title, company, or keyword..."
              value={inputSearch}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
            />
          </div>
          <select
            value={agencyFilter}
            onChange={(e) => setAgencyFilter(e.target.value)}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="">All Agencies</option>
            {agencies.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            aria-label="Filter by state"
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="">All Regions</option>
            {US_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-900 bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Empty State */}
        {filtered.length === 0 && (
          <div className="text-center py-16 rounded-2xl border border-slate-200 bg-white">
            <svg className="mx-auto h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
            {awards.length === 0 ? (
              <>
                <h3 className="mt-4 text-lg font-semibold text-slate-700">No awards synced yet</h3>
                <p className="mt-1 text-sm text-slate-500">Check back after the next daily update.</p>
                <a
                  href="/dashboard"
                  className="mt-6 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
                >
                  Go to dashboard
                </a>
              </>
            ) : (
              <>
                <h3 className="mt-4 text-lg font-semibold text-slate-700">No awards match your filters</h3>
                <p className="mt-1 text-sm text-slate-500">Try adjusting your search or clearing filters.</p>
                <button
                  type="button"
                  onClick={() => { setSearch(""); setAgencyFilter(""); setStateFilter(""); setCategoryFilter(""); }}
                  className="mt-6 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
                >
                  Clear all filters
                </button>
              </>
            )}
          </div>
        )}

        {/* Awards List — id="feed" is the deep-link target for the homepage
            hero CTA ("Get Incumbent Intel" → /awards#feed) so visitors land
            directly on the award cards, not the page top. */}
        <div id="feed" className="space-y-4">
          {filtered.slice(0, 20).map((award) => {
            const isExpanded = expandedId === award.id;
            const bids = similarBids[award.id] || [];
            const isIncumbent = award.incumbent && award.incumbent === award.winning_company;

            return (
              <div key={award.id} className={`rounded-2xl border bg-white shadow-sm transition-all ${isExpanded ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}>
                {/* Row — Desktop table / Mobile card */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : award.id)}
                  className="w-full text-left p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6"
                >
                  {/* Mobile: stacked layout */}
                  <div className="sm:hidden flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 text-sm leading-snug">{award.title}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span className="font-medium text-slate-700">{award.agency}</span>
                      <span>·</span>
                      <span className="font-semibold text-green-700">{award.award_amount}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                      <span>{award.winning_company}</span>
                      <span>·</span>
                      <span>{fmtDate(award.award_date)}</span>
                      {award.category && <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{award.category}</span>}
                    </div>
                  </div>

                  {/* Desktop: table columns */}
                  <div className="hidden sm:flex sm:flex-1 sm:items-center sm:gap-4 min-w-0">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-slate-900 truncate text-sm">{award.title}</h3>
                    </div>
                    <span className="w-16 shrink-0 text-sm font-medium text-slate-600">{award.agency}</span>
                    <span className="w-36 shrink-0 text-sm text-slate-600 truncate">{award.winning_company}</span>
                    <span className="w-24 shrink-0 text-sm font-semibold text-green-700 text-right">{award.award_amount}</span>
                    <span className="w-24 shrink-0 text-sm text-slate-500 text-right">{fmtDate(award.award_date)}</span>
                    <span className="w-16 shrink-0 text-xs font-mono text-slate-500 text-right">{award.naics_code || "—"}</span>
                  </div>

                  <svg className={`hidden sm:block h-5 w-5 shrink-0 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </button>

                {/* Desktop column headers (only show once at top) */}
                {filtered[0]?.id === award.id && (
                  <div className="hidden sm:flex px-5 pb-2 text-xs font-medium uppercase tracking-wide text-slate-400 gap-4">
                    <span className="flex-1">Title</span>
                    <span className="w-16 shrink-0">Agency</span>
                    <span className="w-36 shrink-0">Winner</span>
                    <span className="w-24 shrink-0 text-right">Amount</span>
                    <span className="w-24 shrink-0 text-right">Date</span>
                    <span className="w-16 shrink-0 text-right">NAICS</span>
                    <span className="w-5 shrink-0" />
                  </div>
                )}

                <div className="border-t border-slate-100 px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={(e) => { e.stopPropagation(); loadIntel(award); }} className="text-sm font-semibold text-indigo-700 hover:text-indigo-900">🔍 {loadingIntel === award.id ? "Loading incumbent intelligence…" : intel[award.id] ? "Hide Incumbent Intelligence" : "View Incumbent Intelligence"}</button>
                  <SaveToPipeline bidId={award.id} user={currentUser} initiallySaved={savedBidIds.includes(award.id)} compact returnPath="/awards" />
                </div>

                {/* Expanded Detail Panel */}
                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 sm:px-5 py-5 space-y-5">
                    {intel[award.id] === null && <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No matching award history found for this agency and opportunity title.</p>}
                    {intel[award.id] && <IncumbentCard intel={intel[award.id]!} winner={award.winning_company} user={currentUser} bidId={award.id}
                      freeReveal={!currentUser && (freeRevealAwardId === award.id || milestoneRevealAwardId === award.id)}
                      milestoneOffer={!currentUser && milestoneOfferAwardId === award.id}
                      onMilestoneGranted={() => handleMilestoneGranted(award.id)} />}
                    {/* Key Info Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Award Amount</p>
                        <p className="mt-1 text-2xl font-bold text-slate-900">{award.award_amount}</p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-white p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Winning Company</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">{award.winning_company}</p>
                        <p className="text-xs text-slate-500">{fmtDate(award.award_date)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-white p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Solicitation</p>
                        <p className="mt-1 text-sm font-mono font-medium text-slate-700">{award.solicitation_number || "N/A"}</p>
                        {award.source_url && (
                          <a href={award.source_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-500">
                            View source <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Incumbent History */}
                    <div className="rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Incumbent History</p>
                      {award.incumbent ? (
                        <div className="mt-2">
                          <p className="text-sm text-slate-700">
                            Previous incumbent: <span className="font-semibold">{award.incumbent}</span>
                          </p>
                          <p className="mt-1 text-sm">
                            {isIncumbent ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                Incumbent retained the contract
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                                New entrant — unseated {award.incumbent}
                              </span>
                            )}
                          </p>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-slate-500">No incumbent data available — this may be a new requirement or first-time award.</p>
                      )}
                    </div>

                    {/* Context Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      {award.category && <div className="rounded-lg border border-slate-100 bg-white p-3"><p className="font-medium text-slate-400 text-xs uppercase">Category</p><p className="text-slate-800 font-medium">{award.category}</p></div>}
                      {award.location && <div className="rounded-lg border border-slate-100 bg-white p-3"><p className="font-medium text-slate-400 text-xs uppercase">Location</p><p className="text-slate-800 font-medium">{award.location}</p></div>}
                      {award.naics_code && <div className="rounded-lg border border-slate-100 bg-white p-3"><p className="font-medium text-slate-400 text-xs uppercase">NAICS Code</p><p className="text-slate-800 font-mono font-medium">{award.naics_code}</p></div>}
                      <div className="rounded-lg border border-slate-100 bg-white p-3"><p className="font-medium text-slate-400 text-xs uppercase">Agency</p><p className="text-slate-800 font-medium">{award.agency}</p></div>
                    </div>

                    {/* Description */}
                    {award.description && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Description</p>
                        <p className="text-sm text-slate-700 leading-relaxed">{award.description}</p>
                      </div>
                    )}

                    {/* Similar Future Opportunities */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Similar Future Opportunities</p>
                      {bids.length > 0 ? (
                        <div className="space-y-2">
                          {bids.map((bid) => (
                            <a
                              key={bid.id}
                              href={`/dashboard#bid-${bid.id}`}
                              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 hover:border-blue-300 hover:shadow-sm transition-all"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-800 truncate">{bid.title}</p>
                                <p className="text-xs text-slate-500">{bid.agency} · Due {fmtDate(bid.due_date)}</p>
                              </div>
                              <div className="ml-3 shrink-0 text-right">
                                <span className="text-sm font-semibold text-green-700">{bid.estimated_value}</span>
                                <span className="ml-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{bid.category}</span>
                              </div>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400 italic">No similar active bids found in our database. Check back as we add more opportunities.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
