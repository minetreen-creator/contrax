import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { SaveToPipeline } from "~/components/SaveToPipeline";
import { getCurrentUser } from "~/lib/auth";
import { getSavedBidIds } from "~/lib/saved-matches";
import { NAICS_NAMES } from "~/lib/naics-names";

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
// Friendly industry-name map lives in src/lib/naics-names.ts (single source
// of truth — also consumed by the NAICS inference tagger in src/lib/naics-infer.ts).
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
    // set_aside and naics_code are migration-created columns present in
    // src/db/schema.sql (set_aside: schema.sql migration block; naics_code:
    // migrations 007/012) — the old per-render `ALTER TABLE bids ADD COLUMN IF
    // NOT EXISTS` DDLs (DB writes on every SEO set-aside/NAICS page render) are
    // removed, same as /awards and the homepage.
    const rows = await db`
      SELECT id, title, agency, description, location, category, due_date,
             estimated_value, source_url, set_aside, naics_code
      FROM bids
      WHERE set_aside = ${setAside} AND naics_code = ${naics}
        AND due_date > NOW()
        AND ${db.unsafe(LOW_CONTENT_SQL)}
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
        AND due_date > NOW()
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
  loader: async ({ params }) => {
    // Resolve the current user + their saved bid ids so SSR renders the correct
    // logged-in/logged-out button state (and the saved state) in the HTML.
    const currentUser = await getCurrentUser();
    const [d, savedBidIds] = await Promise.all([
      getSetAsideOpportunities({ data: { setAside: params.setaside, naics: params.naics } }),
      currentUser
        ? getSavedBidIds({ data: { userId: currentUser.id } })
        : Promise.resolve([] as number[]),
    ]);
    return { ...d, currentUser, savedBidIds };
  },
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
            ? `${count} active ${d.setAside} set-aside contract ${count === 1 ? "opportunity" : "opportunities"} in NAICS ${d.naics} (${d.industryName}).`
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
              {count} active {d.setAside} {count === 1 ? "opportunity" : "opportunities"}
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
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      {op.estimated_value}
                    </span>
                    <SaveToPipeline
                      bidId={op.id}
                      user={d.currentUser}
                      initiallySaved={d.savedBidIds.includes(op.id)}
                      savedCount={d.savedBidIds.length}
                      returnPath={`/opportunities/${d.setAsideSlug}/${d.naics}`}
                    />
                  </div>
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
