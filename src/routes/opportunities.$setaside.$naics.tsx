import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";

// ── Set-aside normalization ────────────────────────────────────────────────────
// URL slug -> canonical DB label. The `bids.set_aside` column stores the label
// forms ("8(a)", "SDVOSB", "WOSB", "HUBZone") produced by the SAM.gov sync's
// normalizeSetAside(). Accept both the canonical labels and common aliases so
// /opportunities/8a/541330 and /opportunities/8(a)/541330 both resolve.
const SET_ASIDE_ALIASES: Record<string, string> = {
  "8a": "8(a)",
  "8(a)": "8(a)",
  "8-a": "8(a)",
  "8_a": "8(a)",
  sba: "8(a)",
  "sba-8a": "8(a)",
  sdvosb: "SDVOSB",
  "service-disabled": "SDVOSB",
  "service-disabled-veteran": "SDVOSB",
  wosb: "WOSB",
  "women-owned": "WOSB",
  edwosb: "EDWOSB",
  hubzone: "HUBZone",
  hzc: "HUBZone",
  "hub-zone": "HUBZone",
  vosb: "VOSB",
  "veteran-owned": "VOSB",
};

/** Canonical set-aside labels, ordered for tab/cross-link display. */
const SET_ASIDE_TABS = [
  { slug: "8a", label: "8(a)" },
  { slug: "sdvosb", label: "SDVOSB" },
  { slug: "wosb", label: "WOSB" },
  { slug: "hubzone", label: "HUBZone" },
];

function normalizeSetAsideParam(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9()]/g, "").replace(/[()]/g, "");
  if (!key) return null;
  for (const [alias, label] of Object.entries(SET_ASIDE_ALIASES)) {
    const aliasKey = alias.toLowerCase().replace(/[^a-z0-9()]/g, "").replace(/[()]/g, "");
    if (aliasKey === key) return label;
  }
  return null;
}

function slugForLabel(label: string): string | null {
  for (const t of SET_ASIDE_TABS) if (t.label === label) return t.slug;
  return null;
}

// ── NAICS industry-name lookup ─────────────────────────────────────────────────
// Friendly industry names for the NAICS codes present in the `bids` table
// (SAM.gov + city sources) plus the common services codes from the awards
// database. Unknown codes fall back to "NAICS {code}".
const NAICS_NAMES: Record<string, string> = {
  // Construction
  "236118": "Residential Remodelers",
  "236210": "Industrial Building Construction",
  "236220": "Commercial Building Construction",
  "237110": "Water and Sewer Line and Related Structures Construction",
  "237130": "Power and Communication Line and Related Structures Construction",
  "237310": "Highway, Street, and Bridge Construction",
  "237990": "Other Heavy and Civil Engineering Construction",
  "238210": "Electrical Contractors",
  "238220": "Plumbing, Heating, and Air-Conditioning Contractors",
  "238910": "Site Preparation Contractors",
  "238990": "All Other Specialty Trade Contractors",
  // Manufacturing
  "221320": "Sewage Treatment Facilities",
  "326299": "All Other Rubber Product Manufacturing",
  "331210": "Iron and Steel Pipe and Tube Manufacturing",
  "331221": "Rolled Steel Shape Manufacturing",
  "332216": "Saw Blade and Handtool Manufacturing",
  "332312": "Fabricated Structural Metal Manufacturing",
  "332313": "Plate Work Manufacturing",
  "332420": "Metal Tank (Heavy Gauge) Manufacturing",
  "332439": "Other Metal Container Manufacturing",
  "332510": "Hardware Manufacturing",
  "332613": "Spring Manufacturing",
  "332710": "Machine Shops",
  "332722": "Shot Peening Services and Other Metal Treating Services",
  "332911": "Industrial Valve Manufacturing",
  "332996": "Fabricated Pipe and Pipe Fitting Manufacturing",
  "332999": "All Other Miscellaneous Fabricated Metal Product Manufacturing",
  "333120": "Construction Machinery Manufacturing",
  "333241": "Food Product Machinery Manufacturing",
  "333310": "Commercial and Service Industry Machinery Manufacturing",
  "333415": "Air-Conditioning and Warm Air Heating Equipment and Commercial and Industrial Refrigeration Equipment Manufacturing",
  "333611": "Turbine and Turbine Generator Set Units Manufacturing",
  "333613": "Mechanical Power Transmission Equipment Manufacturing",
  "333618": "Other Engine Equipment Manufacturing",
  "333912": "Air and Gas Compressor Manufacturing",
  "333914": "Measuring, Dispensing, and Other Pumping Equipment Manufacturing",
  "333991": "Power-Driven Handtool Manufacturing",
  "333998": "All Other Miscellaneous General Purpose Machinery Manufacturing",
  "334111": "Electronic Computer Manufacturing",
  "334118": "Computer Terminal and Other Computer Peripheral Equipment Manufacturing",
  "334210": "Telephone Apparatus Manufacturing",
  "334220": "Radio and Television Broadcasting and Wireless Communications Equipment Manufacturing",
  "334310": "Audio and Video Equipment Manufacturing",
  "334412": "Bare Printed Circuit Board Manufacturing",
  "334413": "Semiconductor and Related Device Manufacturing",
  "334416": "Capacitor, Resistor, Coil, Transformer, and Other Inductor Manufacturing",
  "334417": "Electronic Connector Manufacturing",
  "334418": "Printed Circuit Assembly (Electronic Assembly) Manufacturing",
  "334419": "Other Electronic Component Manufacturing",
  "334510": "Electromedical and Electrotherapeutic Apparatus Manufacturing",
  "334511": "Search, Detection, Navigation, Guidance, Aeronautical, and Nautical System and Instrument Manufacturing",
  "334519": "Other Measuring and Controlling Device Manufacturing",
  "335311": "Power, Distribution, and Specialty Transformer Manufacturing",
  "335312": "Motor and Generator Manufacturing",
  "335313": "Switchgear and Switchboard Apparatus Manufacturing",
  "335314": "Relay and Industrial Control Manufacturing",
  "335910": "Battery Manufacturing",
  "335931": "Current-Carrying Wiring Device Manufacturing",
  "335999": "All Other Miscellaneous Electrical Equipment and Component Manufacturing",
  "336310": "Motor Vehicle Gasoline Engine and Engine Parts Manufacturing",
  "336330": "Motor Vehicle Steering and Suspension Components Manufacturing",
  "336350": "Motor Vehicle Transmission and Power Train Parts Manufacturing",
  "336360": "Motor Vehicle Seating and Interior Trim Manufacturing",
  "336370": "Motor Vehicle Metal Stamping",
  "336390": "Other Motor Vehicle Parts Manufacturing",
  "336411": "Aircraft Manufacturing",
  "336412": "Aircraft Engine and Engine Parts Manufacturing",
  "336413": "Other Aircraft Parts and Auxiliary Equipment Manufacturing",
  "336992": "Military Armored Vehicle, Tank, and Tank Component Manufacturing",
  "339112": "Surgical and Medical Instrument Manufacturing",
  "339113": "Surgical Appliance and Supplies Manufacturing",
  "339920": "Sporting and Athletic Goods Manufacturing",
  "339991": "Gasket, Packing, and Sealing Device Manufacturing",
  // Professional, scientific & technical services
  "541110": "Offices of Lawyers",
  "541199": "All Other Legal Services",
  "541211": "Offices of Certified Public Accountants",
  "541219": "Other Accounting Services",
  "541310": "Architectural Services",
  "541330": "Engineering Services",
  "541360": "Geophysical Surveying and Mapping Services",
  "541370": "Surveying and Mapping (except Geophysical) Services",
  "541380": "Testing Laboratories",
  "541430": "Graphic Design Services",
  "541490": "Other Specialized Design Services",
  "541511": "Custom Computer Programming Services",
  "541512": "Computer Systems Design Services",
  "541513": "Computer Facilities Management Services",
  "541519": "Other Computer Related Services",
  "541610": "Management Consulting Services",
  "541611": "Administrative Management Consulting",
  "541612": "Human Resources Consulting Services",
  "541613": "Marketing Consulting Services",
  "541618": "Other Management Consulting Services",
  "541620": "Environmental Consulting Services",
  "541690": "Other Scientific and Technical Consulting Services",
  "541712": "Research and Development in the Physical, Engineering, and Life Sciences",
  "541715": "Research and Development in the Physical, Engineering, and Life Sciences",
  "541720": "Research and Development in the Social Sciences and Humanities",
  "541810": "Advertising Agencies",
  "541850": "Display Advertising",
  "541870": "Advertising Material Distribution Services",
  "541930": "Translation and Interpretation Services",
  "541990": "All Other Professional, Scientific, and Technical Services",
  // Administrative & support
  "561110": "Office Administrative Services",
  "561210": "Facilities Support Services",
  "561311": "Employment Placement Agencies",
  "561320": "Temporary Help Services",
  "561410": "Document Preparation Services",
  "561440": "Collection Agencies",
  "561499": "All Other Business Support Services",
  "561510": "Travel Agencies",
  "561590": "All Other Travel Arrangement and Reservation Services",
  "561612": "Security Guards and Patrol Services",
  "561621": "Security Systems Services",
  "561710": "Exterminating and Pest Control Services",
  "561720": "Janitorial Services",
  "561730": "Landscaping Services",
  "561740": "Carpet and Upholstery Cleaning Services",
  "561790": "Other Services to Buildings and Dwellings",
  "561910": "Packaging and Labeling Services",
  "561920": "Convention and Trade Show Organizers",
  "561990": "All Other Support Services",
  // Waste management
  "562111": "Solid Waste Collection",
  "562211": "Hazardous Waste Treatment and Disposal",
  "562212": "Solid Waste Landfill",
  "562219": "Other Nonhazardous Waste Treatment and Disposal",
  "562910": "Remediation Services",
  "562920": "Materials Recovery Facilities",
  "562998": "All Other Miscellaneous Waste Management Services",
  // Education, health care, social assistance
  "611310": "Colleges, Universities, and Professional Schools",
  "611430": "Professional and Management Development Training",
  "611710": "Educational Support Services",
  "621111": "Offices of Physicians (except Mental Health Specialists)",
  "621210": "Offices of Dentists",
  "621330": "Offices of Mental Health Practitioners",
  "621498": "All Other Outpatient Care Centers",
  "621511": "Medical Laboratories",
  "621610": "Home Health Care Services",
  "621999": "All Other Miscellaneous Ambulatory Health Care Services",
  "622110": "General Medical and Surgical Hospitals",
  "622310": "Psychiatric and Substance Abuse Hospitals",
  "623110": "Nursing Care Facilities",
  "623220": "Residential Mental Health and Substance Abuse Facilities",
  "624120": "Services for the Elderly and Persons with Disabilities",
  "624190": "Other Individual and Family Services",
  "624230": "Emergency and Other Relief Services",
  "624310": "Vocational Rehabilitation Services",
  // Transportation, warehousing, utilities
  "484121": "General Freight Trucking, Long-Distance, Truckload",
  "484122": "General Freight Trucking, Long-Distance, Less Than Truckload",
  "488119": "Other Airport Operations",
  "493110": "General Warehousing and Storage",
  "517111": "Wired Telecommunications Carriers",
  "517312": "Wireless Telecommunications Carriers (except Satellite)",
  "517919": "All Other Telecommunications",
  "518210": "Data Processing, Hosting, and Related Services",
  // Repair & maintenance
  "811210": "Electronic and Precision Equipment Repair and Maintenance",
  "811310": "Commercial and Industrial Machinery and Equipment Repair and Maintenance",
  // Public administration / national security
  "921110": "Executive Offices",
  "922160": "Fire Protection",
  "922190": "Other Justice, Public Order, and Safety Activities",
  "923120": "Administration of Public Health Programs",
  "924110": "Administration of Air and Water Resource and Solid Waste Management Programs",
  "925110": "Administration of Housing Programs",
  "926110": "Administration of General Economic Programs",
  "927110": "Space Research and Technology",
  "928110": "National Security",
};

function industryName(naics: string): string {
  // SAM.gov occasionally returns 5-digit codes (e.g. "62151"); resolve the
  // 5-digit prefix to its 6-digit industry when possible.
  if (NAICS_NAMES[naics]) return NAICS_NAMES[naics];
  if (naics.length === 5) {
    const sixDigit = NAICS_NAMES[naics + "1"];
    if (sixDigit) return sixDigit;
  }
  return `NAICS ${naics}`;
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface Opportunity {
  id: number;
  title: string;
  agency: string;
  description: string | null;
  location: string | null;
  category: string | null;
  due_date: string | null;
  estimated_value: string;
  source_url: string | null;
  set_aside: string | null;
  naics_code: string | null;
}

interface SetAsidePageData {
  notFound: boolean;
  setAside: string; // canonical label, e.g. "8(a)"
  setAsideSlug: string; // e.g. "8a"
  naics: string; // e.g. "541330"
  industryName: string;
  opportunities: Opportunity[];
  relatedNaics: string[];
  activeTabs: { slug: string; label: string }[]; // set-asides present for this NAICS
}

// ── Server function ────────────────────────────────────────────────────────────
const getSetAsideOpportunities = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: { setAside: string; naics: string } }): Promise<SetAsidePageData> => {
    const setAside = normalizeSetAsideParam(data.setAside);
    const naics = data.naics.trim();
    if (!setAside || !/^\d{5,6}$/.test(naics)) {
      return {
        notFound: true,
        setAside: setAside ?? data.setAside,
        setAsideSlug: data.setAside,
        naics,
        industryName: industryName(naics),
        opportunities: [],
        relatedNaics: [],
        activeTabs: [],
      };
    }
    const slug = slugForLabel(setAside);
    const db = sql();
    // Column safety: the sync job creates these, but keep the query tolerant of
    // databases that predate them (same pattern as /awards).
    try { await db`ALTER TABLE bids ADD COLUMN IF NOT EXISTS set_aside TEXT`; } catch {}
    try { await db`ALTER TABLE bids ADD COLUMN IF NOT EXISTS naics_code TEXT`; } catch {}
    const rows = await db`
      SELECT id, title, agency, description, location, category, due_date,
             estimated_value, source_url, set_aside, naics_code
      FROM bids
      WHERE set_aside = ${setAside} AND naics_code = ${naics}
      ORDER BY due_date ASC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 100
    `;
    const opportunities: Opportunity[] = (rows as any[]).map((r) => ({
      id: Number(r.id),
      title: r.title || "Untitled opportunity",
      agency: r.agency || "Unknown agency",
      description: r.description || null,
      location: r.location || null,
      category: r.category || null,
      due_date: r.due_date ? String(r.due_date) : null,
      estimated_value: r.estimated_value || "Not specified",
      source_url: r.source_url || null,
      set_aside: r.set_aside || null,
      naics_code: r.naics_code || null,
    }));
    // Related NAICS codes under the same set-aside (cross-links).
    const relatedRows = await db`
      SELECT DISTINCT naics_code FROM bids
      WHERE set_aside = ${setAside} AND naics_code IS NOT NULL AND naics_code <> ${naics}
      ORDER BY naics_code LIMIT 24
    `;
    const relatedNaics = (relatedRows as any[]).map((r) => String(r.naics_code));
    // Which of the four set-aside labels actually have bids in this NAICS.
    const asideRows = await db`
      SELECT DISTINCT set_aside FROM bids
      WHERE naics_code = ${naics} AND set_aside IS NOT NULL
    `;
    const present = new Set((asideRows as any[]).map((r) => String(r.set_aside)));
    const activeTabs = SET_ASIDE_TABS.filter((t) => present.has(t.label));
    return {
      notFound: false,
      setAside,
      setAsideSlug: slug ?? data.setAside,
      naics,
      industryName: industryName(naics),
      opportunities,
      relatedNaics,
      activeTabs,
    };
  },
);

// ── Route ──────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/opportunities/$setaside/$naics")({
  loader: ({ params }) =>
    getSetAsideOpportunities({ data: { setAside: params.setaside, naics: params.naics } }),
  head: ({ loaderData }) => {
    const d = loaderData;
    const title = d.notFound
      ? "Set-Aside Opportunities | Contrax"
      : `${d.setAside} ${d.industryName} Contracts — Set-Aside Opportunities | Contrax`;
    const description = d.notFound
      ? "Browse active set-aside contract opportunities for 8(a), SDVOSB, WOSB, and HUBZone-certified small businesses."
      : `Browse active ${d.setAside} set-aside contract opportunities in NAICS ${d.naics} (${d.industryName}). Incumbent pricing, award history, and solicitation details for certified small businesses.`;
    const url = d.notFound
      ? "https://www.contrax.company/opportunities"
      : `https://www.contrax.company/opportunities/${d.setAsideSlug}/${d.naics}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "robots", content: d.notFound ? "noindex, nofollow" : "index, follow" },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:alt", content: title },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:site_name", content: "Contrax" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: "https://www.contrax.company/logo-square.png" },
        { name: "twitter:image:alt", content: title },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: SetAsideOpportunitiesPage,
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtDate(d: string | null | undefined): string {
  if (!d) return "Not specified";
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? "Not specified"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Component ──────────────────────────────────────────────────────────────────
function SetAsideOpportunitiesPage() {
  const d = Route.useLoaderData();

  if (d.notFound) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
            <a href="/" className="inline-flex items-center gap-2">
              <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
            </a>
            <a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-700">Dashboard</a>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-16 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">404</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Opportunity page not found</h1>
          <p className="mt-3 text-slate-600">
            We couldn't find a valid set-aside and NAICS combination for{" "}
            <span className="font-medium text-slate-800">/opportunities/{d.setAsideSlug}/{d.naics}</span>.
            Check the URL or browse all opportunities below.
          </p>
          <a
            href="/awards"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Browse all opportunities
          </a>
        </main>
      </div>
    );
  }

  const count = d.opportunities.length;
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-700">Dashboard</a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li><a href="/" className="hover:text-slate-800">Home</a></li>
            <li aria-hidden="true">›</li>
            <li><a href="/awards" className="hover:text-slate-800">Opportunities</a></li>
            <li aria-hidden="true">›</li>
            <li><a href={`/awards`} className="hover:text-slate-800">{d.setAside}</a></li>
            <li aria-hidden="true">›</li>
            <li className="font-medium text-slate-800" aria-current="page">{d.naics}</li>
          </ol>
        </nav>

        {/* Title */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {d.setAside} Set-Aside: {d.industryName}
          </h1>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
            NAICS {d.naics}
          </span>
        </div>
        <p className="mt-3 max-w-3xl text-slate-600">
          {count > 0
            ? `${count} active ${d.setAside} set-aside contract opportunity${count === 1 ? "" : "ies"} in NAICS ${d.naics} (${d.industryName}).`
            : `No ${d.setAside} set-aside opportunities are currently open in NAICS ${d.naics} (${d.industryName}). Check related codes below or return to the full list.`}{" "}
          Contrax monitors SAM.gov and city procurement portals daily so certified small businesses see every eligible solicitation.
        </p>

        {/* Set-aside tabs for this NAICS */}
        <div className="mt-6 flex flex-wrap gap-2">
          {SET_ASIDE_TABS.map((t) => {
            const active = t.label === d.setAside;
            return (
              <a
                key={t.slug}
                href={`/opportunities/${t.slug}/${d.naics}`}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset ${
                  active
                    ? "bg-slate-900 text-white ring-slate-900"
                    : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {t.label}
              </a>
            );
          })}
        </div>

        {/* Count strip */}
        <div className="mt-8 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {count} active {d.setAside} opportunity{count === 1 ? "" : "ies"}
            </p>
            <p className="text-sm text-slate-500">NAICS {d.naics} · {d.industryName}</p>
          </div>
          <a
            href="/awards"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800"
          >
            ← All opportunities
          </a>
        </div>

        {/* Opportunity cards */}
        {count === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <p className="text-2xl">📭</p>
            <h2 className="mt-3 text-lg font-semibold text-slate-900">No open {d.setAside} opportunities right now</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">
              Set-aside solicitations cycle constantly. Check the related NAICS codes below, browse all
              opportunities, or set up bid alerts so you never miss an eligible notice.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <a href="/awards" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                Browse all opportunities
              </a>
              <a href="/alerts" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100">
                Set up bid alerts
              </a>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {d.opportunities.map((op) => (
              <article
                key={op.id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold leading-snug text-slate-900">
                      {op.source_url ? (
                        <a href={op.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600">
                          {op.title}
                        </a>
                      ) : (
                        op.title
                      )}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">{op.agency}</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    {op.estimated_value}
                  </span>
                </div>
                {op.description && (
                  <p className="mt-3 line-clamp-3 text-sm text-slate-600">{op.description}</p>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
                  {op.location && (
                    <span className="inline-flex items-center gap-1.5">
                      <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {op.location}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Due {fmtDate(op.due_date)}
                  </span>
                  {op.category && (
                    <span className="inline-flex items-center gap-1.5 text-slate-500">
                      <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      {op.category}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {/* Related NAICS cross-links */}
        {d.relatedNaics.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-bold text-slate-900">Related NAICS codes for {d.setAside} set-asides</h2>
            <p className="mt-1 text-sm text-slate-500">Other industries with active {d.setAside} solicitations.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {d.relatedNaics.map((code) => (
                <a
                  key={code}
                  href={`/opportunities/${d.setAsideSlug}/${code}`}
                  className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 hover:text-slate-900"
                >
                  {code} · {industryName(code)}
                </a>
              ))}
            </div>
          </section>
        )}

        {/* All set-aside cross-links for this NAICS */}
        {d.activeTabs.length > 1 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-slate-900">{d.industryName} across other set-asides</h2>
            <p className="mt-1 text-sm text-slate-500">Opportunities in NAICS {d.naics} available under other certifications.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {d.activeTabs
                .filter((t) => t.label !== d.setAside)
                .map((t) => (
                  <a
                    key={t.slug}
                    href={`/opportunities/${t.slug}/${d.naics}`}
                    className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 hover:text-slate-900"
                  >
                    {t.label} set-aside in NAICS {d.naics}
                  </a>
                ))}
            </div>
          </section>
        )}

        {/* Back link */}
        <div className="mt-10 border-t border-slate-200 pt-6 text-sm">
          <a href="/awards" className="font-semibold text-blue-600 hover:text-blue-800">
            ← Back to all opportunities
          </a>
          <span className="mx-3 text-slate-300">|</span>
          <a href="/" className="font-semibold text-blue-600 hover:text-blue-800">Home</a>
        </div>
      </main>
    </div>
  );
}
