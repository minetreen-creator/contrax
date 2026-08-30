import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { LOW_CONTENT_SQL } from "~/lib/low-content";

type Bid = {
  title: string;
  agency: string;
  estimated_value: string | null;
  due_date: string | null;
  location: string | null;
  category?: string | null;
  description?: string | null;
};

const HEALTHCARE_KEYWORDS = [
  "health", "medical", "nurse", "nursing", "physician", "clinician", "clinical",
  "hospital", "tricare", "medicare", "medicaid", "pharma", "pharmacy", "dental",
  "behavioral", "mental health", "substance abuse", "telehealth",
  "telemedicine", "emr", "ehr", "hipaa",
];
/**
 * Construction/vehicle/utilities terms checked against the TITLE only. Many of
 * these words (road, street, gas, vehicle, van, bus, gate, fence, waste,
 * trash, recycling, sanitation, fuel, elevator…) routinely appear inside the
 * *descriptions* of genuine healthcare bids (street addresses, lab supplies,
 * medical transport, etc.), so a description-level check would wrongly drop
 * them — e.g. "…Babcock Road Medical Center…" in a real cardiology notice.
 * The original code checked only the title; that conservative behavior is
 * preserved here, plus "facility"/"facilities", which are safe only in titles
 * (healthcare descriptions are full of "…at the health care facility…"
 * boilerplate).
 */
const HEALTHCARE_EXCLUSIONS = [
  "truck", "trailer", "vehicle", "van", "bus", "bulldozer", "excavator", "crane",
  "forklift", "paving", "roofing", "concrete", "dumpster", "fence", "gate",
  "landscaping", "janitorial", "elevator", "hvac", "plumbing", "electrical",
  "generator", "fuel", "gas", "diesel", "manhole", "sewer", "drainage", "pipeline",
  "asphalt", "pavement", "sidewalk", "curb", "gutter", "road", "highway", "bridge",
  "culvert", "demolition", "waste", "trash", "recycling", "sanitation",
  "street", "wastewater", "rehabilitation", "renewal",
  "facility", "facilities",
];
/**
 * Unambiguous construction/facilities terms, checked against BOTH the title
 * and the description. These words never describe a healthcare *service*:
 * "roof"/"roof top"/"rtu" (rooftop unit) identify roofing/HVAC work,
 * "construction"/"renovation" identify facilities work, "stormwater"
 * identifies civil infrastructure.
 *
 * Deliberately NOT included: "repair", "replacement", "maintenance" — they are
 * over-broad and would wrongly exclude genuine healthcare bids, e.g. "medical
 * equipment repair" or the Defense Health Agency "…Asset Tracking System
 * Installation and Maintenance Services" notice (a real, wanted entry in this
 * section). See the category escape hatch below for how an explicit healthcare
 * category always wins.
 */
const HEALTHCARE_TEXT_EXCLUSIONS = [
  "roof", "roof top", "rtu", "construction", "renovation", "stormwater",
];

/**
 * Moved verbatim from the homepage (src/routes/index.tsx) — the healthcare
 * classification used by the /healthcare-contracting open feed. Kept
 * unit-testable without a database.
 */
export function isHealthcareBid(bid: {
  title: string;
  description: string;
  category: string;
}): boolean {
  const title = (bid.title ?? "").toLowerCase();
  const category = (bid.category ?? "").toLowerCase();
  const description = (bid.description ?? "").toLowerCase();
  const categoryMatchesHealthcare = HEALTHCARE_KEYWORDS.some((keyword) =>
    category.includes(keyword),
  );
  const text = `${title} ${description}`;
  const healthcareMatchCount = HEALTHCARE_KEYWORDS.filter((keyword) =>
    text.includes(keyword),
  ).length;
  const hasStrongHealthcareSignal = categoryMatchesHealthcare || healthcareMatchCount >= 1;
  const hasExcludedTerm =
    HEALTHCARE_EXCLUSIONS.some((term) => title.includes(term)) ||
    HEALTHCARE_TEXT_EXCLUSIONS.some((term) => text.includes(term));
  return hasStrongHealthcareSignal && (!hasExcludedTerm || categoryMatchesHealthcare);
}

/**
 * Open healthcare solicitations ONLY (due_date > NOW() inherited from PR #185),
 * deduped on (title, agency) and filtered through isHealthcareBid. Reused from
 * the homepage feed unchanged so the /healthcare-contracting page never shows
 * expired opportunities.
 */
const getHealthcareBids = createServerFn({ method: "GET" }).handler(async () => {
  const { sql } = await import("~/db");
  const patterns = HEALTHCARE_KEYWORDS.map((keyword) => `%${keyword}%`);
  const rows = await sql()`
    SELECT title, agency, estimated_value, due_date, location, category, description
    FROM (
      SELECT DISTINCT ON (title, agency)
             title, agency, estimated_value, due_date, location, category, description, created_at
      FROM bids
      WHERE (LOWER(category) ILIKE ANY(${patterns}::text[])
         OR LOWER(title) ILIKE ANY(${patterns}::text[])
         OR LOWER(description) ILIKE ANY(${patterns}::text[]))
        AND due_date > NOW()
        AND ${sql().unsafe(LOW_CONTENT_SQL)}
      ORDER BY title, agency, created_at DESC NULLS LAST
    ) t
    ORDER BY t.created_at DESC NULLS LAST
    LIMIT 12
  `;
  return (rows as Bid[]).filter((bid) =>
    isHealthcareBid({
      title: bid.title ?? "",
      description: bid.description ?? "",
      category: bid.category ?? "",
    }),
  );
});

export const Route = createFileRoute("/healthcare-contracting")({
  loader: async () => {
    const bids = await getHealthcareBids();
    return { bids };
  },
  component: HealthcarePage,
  head: () => ({
    meta: [
      { title: "Healthcare Government Contracting Opportunities | Contrax" },
      {
        name: "description",
        content:
          "Live healthcare government contracting opportunities for certified small businesses. VA, HHS, DHA, and IHS spend billions annually — Contrax tracks the open set-aside healthcare solicitations you qualify for.",
      },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.contrax.company/healthcare-contracting" },
      { property: "og:title", content: "Healthcare Government Contracting Opportunities | Contrax" },
      {
        property: "og:description",
        content:
          "Live healthcare government contracting opportunities for certified small businesses — VA, HHS, DHA, and IHS set-aside solicitations, tracked in real time.",
      },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:site_name", content: "Contrax" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Healthcare Government Contracting Opportunities | Contrax" },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/healthcare-contracting" }],
  }),
});

function HealthcarePage() {
  const { bids } = Route.useLoaderData();
  const formatValue = (value: string | null) => {
    if (!value) return null;
    const amount = Number(value);
    return Number.isFinite(amount)
      ? amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
      : value;
  };
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="bg-gradient-to-br from-blue-50 via-white to-blue-50/40 py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="text-3xl" aria-hidden="true">🏥</span>
            <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">Healthcare Government Contracting</h1>
          </div>
          <p className="mx-auto mt-5 max-w-3xl text-lg leading-relaxed text-gray-600">
            The federal government is the largest healthcare purchaser in the United States — VA, HHS, DHA, and IHS spend billions annually on staffing, IT, supplies, and facilities contracts. Many are set aside for certified small businesses.
          </p>
          <p className="mt-6 text-sm font-semibold text-blue-700">
            {bids.length} active healthcare opportunities tracked
          </p>
        </div>
      </section>

      {/* Feed */}
      <section className="bg-white py-10 sm:py-14">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bids.map((bid, i) => {
              const value = formatValue(bid.estimated_value);
              return (
                <div key={i} className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md">
                  <span className="mb-3 inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                    {bid.agency.length > 40 ? bid.agency.slice(0, 40) + "..." : bid.agency}
                  </span>
                  <p className="line-clamp-2 text-sm font-semibold text-slate-800" title={bid.title}>{bid.title}</p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    {value ? <span className="text-sm font-bold text-emerald-600">{value}</span> : <span />}
                    {bid.due_date && <span className="text-sm font-semibold text-amber-700">Due {new Date(bid.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
                  </div>
                  {bid.location && <p className="mt-3 text-xs text-gray-500">📍 {bid.location}</p>}
                </div>
              );
            })}
          </div>
          {bids.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-500">
              We’re scanning federal healthcare opportunities now. Sign up to be among the first to hear when a strong-fit contract is found.
            </p>
          )}
          <div className="mt-10 text-center">
            <a href="/awards?search=healthcare" className="font-semibold text-blue-700 transition-colors hover:text-blue-900">
              View all healthcare opportunities →
            </a>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Ready to win healthcare contracts?</h2>
          <p className="mt-4 text-lg text-blue-100/70">14-day free trial. No credit card required.</p>
          <a href="/signup" className="mt-8 inline-flex items-center rounded-xl bg-amber-500 px-8 py-4 font-semibold text-white shadow-lg shadow-amber-500/25 transition hover:bg-amber-400">Start Free Trial <span className="ml-2">→</span></a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
          <a href="/" className="text-sm text-gray-400 transition-colors hover:text-gray-600">← Back to Contrax</a>
          <div className="flex gap-6 text-sm">
            <a href="/compare" className="text-gray-400 transition-colors hover:text-white">Compare</a>
            <a href="/pricing" className="text-gray-400 transition-colors hover:text-white">Pricing</a>
            <a href="/awards" className="text-gray-400 transition-colors hover:text-white">Awards</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
