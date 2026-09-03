/**
 * SEO landing template + shared data resolvers (P1 of the SEO landing-page
 * program, scope: /home/team/shared/seo-landing-pages-scope.md).
 *
 * ONE shared component and a small set of server fns power every set-aside hub
 * page (/8a-contracts, ...) and every region page (/contracts-in/{state}).
 *
 * HONESTY (Contrax hard rule): every number is a LIVE query result — we reuse
 * `setAsidePred`/`LOW_CONTENT_SQL`/`buildContractMap`/`deriveStateCode`/
 * `parseStatedValue` verbatim and never hardcode a count or fabricate a bid,
 * match %, state, or value. The only free-trial CTA routes to
 * /signup?plan=professional and fires `start_trial` (same event names as the
 * verified live homepage hero). No "unlimited" claims anywhere.
 */
import { createServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import { setAsidePred } from "~/lib/open-bids";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { NAICS_NAMES } from "~/lib/naics-names";
import {
  buildContractMap,
  STATE_NAMES,
  formatCompactMoney,
  type ContractMapTotals,
  type StateAggregate,
} from "~/lib/contract-map";
import { trackEvent } from "~/lib/track";

// ─────────────────────────────────────────────────────────────────────────────
// Set-aside cert hub taxonomy (canonical slugs reused everywhere: trades.tsx
// CERT_IDS, radar.tsx RADAR_CERTS, open-bids.ts ASCII_CODE_TO_SET_ASIDE).
// ─────────────────────────────────────────────────────────────────────────────
export interface CertHubDef {
  slug: string; // 8a | sdvosb | wosb | hubzone | sb
  path: string; // public URL
  label: string; // short label shown on chips/buttons
  name: string; // display name for H1 / headings
  blurb: string; // one-line honest descriptor
}

export const CERT_HUBS: CertHubDef[] = [
  {
    slug: "8a",
    path: "/8a-contracts",
    label: "8(a)",
    name: "8(a) Business Development",
    blurb:
      "SBA 8(a) Business Development set-aside contracts reserved for certified 8(a) firms.",
  },
  {
    slug: "sdvosb",
    path: "/sdvosb-contracts",
    label: "SDVOSB",
    name: "Service-Disabled Veteran-Owned Small Business",
    blurb:
      "SDVOSB set-aside contracts reserved for service-disabled veteran-owned small businesses (VOSB-restricted).",
  },
  {
    slug: "wosb",
    path: "/wosb-contracts",
    label: "WOSB",
    name: "Women-Owned Small Business",
    blurb:
      "WOSB and EDWOSB set-aside contracts reserved for women-owned and economically disadvantaged women-owned small businesses.",
  },
  {
    slug: "hubzone",
    path: "/hubzone-contracts",
    label: "HUBZone",
    name: "HUBZone",
    blurb:
      "HUBZone set-aside contracts reserved for small businesses in historically underutilized business zones.",
  },
  {
    slug: "sb",
    path: "/small-business-contracts",
    label: "Small Business",
    name: "Small Business Set-Aside Contracts",
    blurb:
      "Every federal small-business set-aside — 8(a), SDVOSB, WOSB, HUBZone and more.",
  },
];

export const CERT_BY_SLUG: Record<string, CertHubDef> = Object.fromEntries(
  CERT_HUBS.map((c) => [c.slug, c]),
);

// ── Bid shape returned to the client (same projection as radar runRadarScan) ──
export interface SeoBid {
  id: number;
  title: string;
  agency: string | null;
  description: string | null;
  due_date: string | null;
  estimated_value: string | null;
  naics_code: string | null;
  location: string | null;
  set_aside: string | null;
  source_url: string | null;
}

function mapSeoBid(r: any): SeoBid {
  return {
    id: Number(r.id),
    title: String(r.title ?? ""),
    agency: r.agency ? String(r.agency) : null,
    description: r.description ? String(r.description) : null,
    due_date: r.due_date ? String(r.due_date) : null,
    estimated_value: r.estimated_value ? String(r.estimated_value) : null,
    naics_code: r.naics_code ? String(r.naics_code) : null,
    location: r.location ? String(r.location) : null,
    set_aside: r.set_aside ? String(r.set_aside) : null,
    source_url: r.source_url ? String(r.source_url) : null,
  };
}

/** "sb" = every set-aside row (mirrors /trades + /radar); else cert's patterns. */
function certPred(slug: string, sql: any) {
  if (slug === "sb") return sql().unsafe(`AND set_aside IS NOT NULL`);
  return setAsidePred(slug, sql);
}

// ── Server fn: set-aside hub data (real open count + up to 25 real bids) ──────
export const getCertHubData = createServerFn({ method: "GET" })
  .validator((d: unknown) => String((d as any)?.slug ?? ""))
  .handler(async ({ data }) => {
    const slug = data;
    const def = CERT_BY_SLUG[slug] ?? null;
    let count = 0;
    let bids: SeoBid[] = [];
    if (def) {
      const { sql } = await import("~/db");
      try {
        const c = await sql()`
          SELECT COUNT(*)::int AS n FROM (
            SELECT DISTINCT ON (title, agency) id
            FROM bids
            WHERE due_date > NOW() AND ${sql().unsafe(LOW_CONTENT_SQL)} ${certPred(def.slug, sql)}
          ) d
        `;
        count = Number((c as any)[0]?.n ?? 0);
        const rows = await sql()`
          SELECT id, title, agency, description, due_date, estimated_value,
                 naics_code, location, set_aside, source_url
          FROM (
            SELECT DISTINCT ON (title, agency)
                   id, title, agency, description, due_date, estimated_value,
                   naics_code, location, set_aside, source_url, created_at
            FROM bids
            WHERE due_date > NOW() AND ${sql().unsafe(LOW_CONTENT_SQL)} ${certPred(def.slug, sql)}
            ORDER BY title, agency, created_at DESC NULLS LAST
          ) t
          ORDER BY t.due_date ASC NULLS LAST
          LIMIT 25
        `;
        bids = (rows as any[]).map(mapSeoBid);
      } catch (e) {
        // Fail-open: never 500 the page on a DB failure — honest zeros.
        console.error("[seo-landing] cert hub query failed:", e);
        count = 0;
        bids = [];
      }
    }
    return {
      slug,
      def: def
        ? { path: def.path, label: def.label, name: def.name, blurb: def.blurb }
        : null,
      count,
      bids,
      generatedAt: new Date().toISOString(),
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Region pages — aggregate over ALL open bids via buildContractMap (the exact
// /map data path), with set-aside an honest sub-count. Covers all 50 states + DC.
// ─────────────────────────────────────────────────────────────────────────────
// P2 (PR #278): every state + DC now has enough real open bids (>=15, verified
// live 2026-08-30 — the sparsest, DE, still has 17), so we cover all 50 + DC.
export const REGION_CODES = [
  // P1 top-20 (highest volume)
  "CA", "DC", "MD", "TX", "VA", "NY", "OH", "NC", "FL", "LA",
  "AZ", "IL", "NM", "GA", "OK", "HI", "KS", "WA", "ID", "MO",
  // P2 remaining states (all >=15 real open bids in the live DB)
  "NJ", "NH", "SC", "CO", "PA", "AL", "MT", "ND", "OR", "MI",
  "RI", "MA", "WI", "AR", "TN", "AK", "IN", "UT", "NE", "WV",
  "MS", "CT", "MN", "WY", "IA", "ME", "NV", "KY", "VT", "DE",
  "SD",
] as const;
export const REGION_SET = new Set<string>(REGION_CODES);

/** slug -> code: full slugified state name ("north-carolina") OR 2-letter code. */
const STATE_SLUG_TO_CODE: Record<string, string> = {};
for (const [code, name] of Object.entries(STATE_NAMES)) {
  STATE_SLUG_TO_CODE[name.toLowerCase().replace(/\s+/g, "-")] = code;
  STATE_SLUG_TO_CODE[code.toLowerCase()] = code;
}

export interface RegionData {
  slug: string;
  code: string | null;
  name: string | null;
  agg: StateAggregate | null;
  totals: ContractMapTotals | null;
  generatedAt: string;
}

export const getRegionData = createServerFn({ method: "GET" })
  .validator((d: unknown) => String((d as any)?.slug ?? ""))
  .handler(async ({ data }) => {
    const raw = String(data ?? "").toLowerCase();
    const code = STATE_SLUG_TO_CODE[raw] ?? null;
    let agg: StateAggregate | null = null;
    let totals: ContractMapTotals | null = null;
    if (code && REGION_SET.has(code)) {
      const { sql } = await import("~/db");
      try {
        const rows = await sql()`
          SELECT location, set_aside, estimated_value, agency, category, due_date
          FROM bids
          WHERE (due_date IS NULL OR due_date::date >= NOW()::date)
            AND ${sql().unsafe(LOW_CONTENT_SQL)}
        `;
        const map = buildContractMap(rows as any);
        agg = map.states[code] ?? null;
        totals = map.totals;
      } catch (e) {
        console.error("[seo-landing] region query failed:", e);
        agg = null;
        totals = null;
      }
    }
    return {
      slug: raw,
      code: code && REGION_SET.has(code) ? code : null,
      name: code ? (STATE_NAMES[code] ?? null) : null,
      agg,
      totals,
      generatedAt: new Date().toISOString(),
    };
  });

// ─── Server fn: /set-aside-contracts index (live count per cert hub) ────────
export const getSetAsideIndex = createServerFn({ method: "GET" }).handler(
  async () => {
    const { sql } = await import("~/db");
    const counts: Record<string, number> = {};
    try {
      await Promise.all(
        CERT_HUBS.map(async (def) => {
          const c = await sql()`
            SELECT COUNT(*)::int AS n FROM (
              SELECT DISTINCT ON (title, agency) id
              FROM bids
              WHERE due_date > NOW() AND ${sql().unsafe(LOW_CONTENT_SQL)} ${certPred(def.slug, sql)}
            ) d
          `;
          counts[def.slug] = Number((c as any)[0]?.n ?? 0);
        }),
      );
    } catch (e) {
      console.error("[seo-landing] index counts failed:", e);
      for (const def of CERT_HUBS) counts[def.slug] = 0;
    }
    return { counts, generatedAt: new Date().toISOString() };
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// /contracts-by-industry hub — live open set-aside bids grouped by NAICS.
// Only industries with a real count appear; never fabricated. Each industry
// links to the canonical /opportunities/{setaside}/{naics} pages.
// ─────────────────────────────────────────────────────────────────────────────
export interface SeoIndustry {
  code: string;
  name: string;
  count: number;
  slug: string | null; // keystone set-aside slug for /opportunities/{slug}/{code}, else null
}
export interface IndustryHubData {
  industries: SeoIndustry[];
  generatedAt: string;
}

/** Friendly NAICS name (mirrors /opportunities industryName). */
function industryName(naics: string): string {
  if (NAICS_NAMES[naics]) return NAICS_NAMES[naics];
  if (naics.length === 5 && NAICS_NAMES[naics + "1"]) return NAICS_NAMES[naics + "1"];
  return `NAICS ${naics}`;
}
/** Map a literal set_aside value to a keystone opportunity-page slug (or null). */
const NAICS_LITERAL_TO_SLUG: Record<string, string> = {
  "8(a)": "8a", "8AN": "8a",
  "SDVOSB": "sdvosb",
  "WOSB": "wosb", "EDWOSB": "wosb",
  "HUBZone": "hubzone",
};

export const getIndustryHubData = createServerFn({ method: "GET" }).handler(
  async (): Promise<IndustryHubData> => {
    const industries: SeoIndustry[] = [];
    try {
      const { sql } = await import("~/db");
      const rows = (await sql()`
        SELECT naics_code, set_aside, COUNT(*)::int AS n
        FROM bids
        WHERE due_date > NOW()
          AND set_aside IS NOT NULL AND btrim(set_aside) <> ''
          AND ${sql().unsafe(LOW_CONTENT_SQL)}
          AND naics_code IS NOT NULL AND btrim(naics_code) <> ''
        GROUP BY naics_code, set_aside
      `) as { naics_code: string; set_aside: string; n: number }[];
      const per = new Map<string, { total: number; byLiteral: Record<string, number> }>();
      for (const r of rows) {
        const code = String(r.naics_code ?? "").trim();
        if (!code) continue;
        const lit = String(r.set_aside ?? "").trim();
        let e = per.get(code);
        if (!e) { e = { total: 0, byLiteral: {} }; per.set(code, e); }
        e.total += Number(r.n ?? 0);
        e.byLiteral[lit] = (e.byLiteral[lit] ?? 0) + Number(r.n ?? 0);
      }
      for (const [code, e] of per) {
        const top = Object.entries(e.byLiteral).sort((a, b) => b[1] - a[1])[0];
        industries.push({
          code,
          name: industryName(code),
          count: e.total,
          slug: top ? (NAICS_LITERAL_TO_SLUG[top[0]] ?? null) : null,
        });
      }
      industries.sort((a, b) => b.count - a.count);
    } catch (e) {
      // Fail-open: never 500 the page on a DB failure — honest empty list.
      console.error("[seo-landing] industry hub query failed:", e);
    }
    return { industries: industries.slice(0, 50), generatedAt: new Date().toISOString() };
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// head() helper — unique title/description, robots index,follow, og/twitter,
// and a self-canonical to the production URL. Mirrors trades.tsx meta exactly.
// ─────────────────────────────────────────────────────────────────────────────
export function seoHead(opts: {
  title: string;
  description: string;
  canonical: string;
}) {
  return {
    meta: [
      { title: opts.title },
      { name: "description", content: opts.description },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: opts.title },
      { property: "og:description", content: opts.description },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://www.contrax.company/logo-square.png" },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: opts.title },
    ],
    links: [{ rel: "canonical", href: opts.canonical }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared layout: hero with the PRIMARY free-trial CTA + secondary Radar CTA,
// the honesty banner, a slot for real content, and a footer of internal links.
// ─────────────────────────────────────────────────────────────────────────────
export function SeoLanding(props: {
  eyebrow: string;
  headline: ReactNode;
  subhead: ReactNode;
  radarHref: string;
  radarLabel: string;
  honesty: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Hero */}
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-400">
            {props.eyebrow}
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            {props.headline}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-blue-100/80 sm:text-lg">
            {props.subhead}
          </p>

          {/* PRIMARY free-trial CTA (verified live-homepage pattern) */}
          <div className="mt-8">
            <a
              href="/signup?plan=professional"
              onClick={() => trackEvent("hero_cta_click", "start_trial")}
              className="inline-block rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 px-8 py-4 text-center text-base font-extrabold text-slate-950 shadow-xl shadow-amber-500/25 transition-all hover:from-amber-300 hover:to-amber-400 active:scale-[0.99] sm:text-lg"
            >
              🚀 Start your 14-day FREE Professional trial →
            </a>
            <p className="mt-2 text-xs font-medium text-blue-200/60">
              No credit card required · Full Professional features on your first
              use · Auto-downgrades to free Basic after 14 days
            </p>
            {/* SECONDARY Radar CTA */}
            <a
              href={props.radarHref}
              onClick={() => trackEvent("hero_cta_click", "radar_activate")}
              className="mt-3 inline-block text-sm font-medium text-blue-200/80 underline-offset-4 transition-colors hover:text-white hover:underline"
            >
              📡 {props.radarLabel}
            </a>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-slate-50 to-transparent" />
      </section>

      {/* Honesty banner */}
      <div className="border-b border-slate-200 bg-slate-100">
        <div className="mx-auto max-w-6xl px-6 py-3 text-sm text-slate-600">
          {props.honesty}
        </div>
      </div>

      {/* Real content */}
      <div className="mx-auto max-w-6xl px-6 py-10">{props.children}</div>

      {/* Footer */}
      <footer className="border-t border-gray-800 bg-slate-900 py-10 text-gray-300">
        <div className="mx-auto max-w-6xl px-6">
          <p className="text-sm font-bold text-white">
            ⬢ Contrax — set-aside intelligence for small federal contractors
          </p>
          <nav className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <SeoFooterLinks />
          </nav>
          <p className="mt-6 text-xs text-gray-500">
            &copy; {new Date().getFullYear()} Contrax. All rights reserved.
          </p>
        </div>
      </footer>
    </main>
  );
}

/** Standard internal-link set shared by every footer ("own set-aside hubs first" for crawl). */
export function SeoFooterLinks() {
  return (
    <>
      <a href="/" className="transition-colors hover:text-white">Home</a>
      <a href="/set-aside-contracts" className="transition-colors hover:text-white">Set-Aside Contracts</a>
      <a href="/8a-contracts" className="transition-colors hover:text-white">8(a) Contracts</a>
      <a href="/sdvosb-contracts" className="transition-colors hover:text-white">SDVOSB Contracts</a>
      <a href="/wosb-contracts" className="transition-colors hover:text-white">WOSB Contracts</a>
      <a href="/hubzone-contracts" className="transition-colors hover:text-white">HUBZone Contracts</a>
      <a href="/small-business-contracts" className="transition-colors hover:text-white">Small Business Contracts</a>
      <a href="/contracts-by-industry" className="transition-colors hover:text-white">Contracts by Industry</a>
      <a href="/contracts-in/california" className="transition-colors hover:text-white">California</a>
      <a href="/contracts-in/texas" className="transition-colors hover:text-white">Texas</a>
      <a href="/contracts-in/virginia" className="transition-colors hover:text-white">Virginia</a>
      <a href="/contracts-in/district-of-columbia" className="transition-colors hover:text-white">D.C.</a>
      <a href="/radar" className="transition-colors hover:text-white">Contract Radar</a>
      <a href="/map" className="transition-colors hover:text-white">Contract Map</a>
      <a href="/pricing" className="transition-colors hover:text-white">Pricing</a>
      <a href="/signup" className="transition-colors hover:text-white">Sign up</a>
    </>
  );
}

// ── Small honest render helpers shared across the landing pages ───────────────
export function fmtDue(d: string | null): string | null {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export { formatCompactMoney };

// ═════════════════════════════════════════════════════════════════════════════
// Shared view components — set-aside hub, region, and index bodies. Every
// displayed number is a live query result passed in from a server fn loader.
// ═════════════════════════════════════════════════════════════════════════════

/** One real bid card. Links the real SAM.gov source_url; never fabricates a match %. */
export function BidCard({ b }: { b: SeoBid }) {
  const due = fmtDue(b.due_date);
  const title = (
    <span className="line-clamp-2 text-base font-semibold text-slate-900">
      {b.title || "Solicitation"}
    </span>
  );
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      {b.source_url ? (
        <a
          href={b.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block transition-colors hover:text-blue-700"
        >
          {title}
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {b.agency || "Federal agency"}
            {b.location ? ` · ${b.location}` : ""}
          </span>
        </a>
      ) : (
        <div>
          {title}
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {b.agency || "Federal agency"}
          </span>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        {due && (
          <span className="inline-flex items-center gap-1 font-medium">
            <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Closes {due}
          </span>
        )}
        {b.estimated_value && (
          <span className="font-semibold text-emerald-700">{b.estimated_value}</span>
        )}
        {b.set_aside && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
            {b.set_aside}
          </span>
        )}
        {b.naics_code && <span>NAICS {b.naics_code}</span>}
      </div>
      {b.description && (
        <p className="mt-3 line-clamp-3 text-sm text-slate-600">{b.description}</p>
      )}
      {b.source_url && (
        <span className="mt-2 inline-block text-xs font-medium text-blue-700">
          Open original notice on SAM.gov ↗
        </span>
      )}
    </li>
  );
}

const chipCls =
  "rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 hover:text-slate-900";

export function CertHubView({
  data,
}: {
  data: { slug: string; count: number; bids: SeoBid[]; def: { path: string; label: string; name: string; blurb: string } | null };
}) {
  const { def, count, bids } = data;
  const otherHubs = CERT_HUBS.filter((c) => c.slug !== data.slug);
  return (
    <div>
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold text-slate-900">
            {def ? `${def.name} solicitations open now` : "Set-aside solicitations"}
          </h2>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
            {count.toLocaleString("en-US")} open
          </span>
        </div>
        {count === 0 ? (
          <p className="mt-3 max-w-3xl text-slate-600">
            No {def?.label} solicitations are open right now — new ones sync every 4
            hours. Explore the other set-aside hubs below, or start a free trial to get
            alerted the moment matching bids land.
          </p>
        ) : (
          <p className="mt-2 max-w-3xl text-slate-600">
            {def?.label} set-asides are reserved for {def?.name.toLowerCase()} firms.
            These are {bids.length > 0 ? `${bids.length} of ` : ""}
            {count.toLocaleString("en-US")} currently open, listed with their real title,
            agency, estimated value and close date — straight from live federal procurement
            sources.
          </p>
        )}
      </section>

      {bids.length > 0 && (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {bids.map((b) => (
            <BidCard key={b.id} b={b} />
          ))}
        </ul>
      )}

      <section className="mt-12 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <h3 className="text-lg font-bold text-slate-900">Explore other set-aside hubs</h3>
        <p className="mt-1 text-sm text-slate-500">
          Every federal small-business set-aside, with live open counts.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="/set-aside-contracts"
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            All set-aside contracts
          </a>
          {otherHubs.map((c) => (
            <a key={c.slug} href={c.path} className={chipCls}>
              {c.label} Contracts
            </a>
          ))}
          <a href="/radar" className={chipCls}>Contract Radar</a>
          <a href="/map" className={chipCls}>U.S. Contract Map</a>
        </div>
      </section>
    </div>
  );
}

/** Honest region aggregate panel (the exact /map data path, `across N of M` denominator). */
export function RegionView({ data }: { data: RegionData }) {
  if (!data.code || !data.agg || !data.name) {
    return (
      <p className="max-w-3xl text-slate-600">
        We don&apos;t have a {data.slug} region page yet — try one of the covered states
        below, or search live set-aside bids with Contract Radar.
      </p>
    );
  }
  const agg = data.agg;
  const name = data.name;
  const valueLabel =
    agg.withValue > 0
      ? `${formatCompactMoney(agg.statedValue)} across ${agg.withValue} of ${agg.count} bids with a stated value`
      : "estimated value not listed for the current open bids";
  return (
    <div>
      {/* Nationwide honesty banner (95% of set-asides are nationwide) */}
      <div className="mb-8 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">
          {agg.setAsideCount} set-aside {agg.setAsideCount === 1 ? "opportunity is" : "opportunities are"} open
          now — most are nationwide and available in {name}.
        </p>
        <p className="mt-1">
          Filter on the <a className="font-semibold text-blue-700 hover:underline" href="/map">U.S. Contract Map</a> or{" "}
          <a className="font-semibold text-blue-700 hover:underline" href={`/radar?state=${data.code}`}>Contract Radar</a> to
          confirm exactly which {name} competitions apply to your certification.
        </p>
      </div>

      <h2 className="text-2xl font-bold text-slate-900">
        Government contracts in {name}
      </h2>
      <p className="mt-2 max-w-3xl text-slate-600">
        Real open federal and state solicitations tied to {name}, counted straight from
        live procurement data and updated every 4 hours.
      </p>

      {/* Stat cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <p className="text-sm font-medium text-slate-500">Currently open in {name}</p>
          <p className="mt-1 text-3xl font-extrabold text-slate-900">{agg.count.toLocaleString("en-US")}</p>
          <p className="mt-1 text-xs text-slate-500">
            {agg.setAsideCount} set-aside (most are nationwide)
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <p className="text-sm font-medium text-slate-500">Closing in the next 7 days</p>
          <p className="mt-1 text-3xl font-extrabold text-amber-600">{agg.closingSoon.toLocaleString("en-US")}</p>
          <p className="mt-1 text-xs text-slate-500">acting fast can be the edge</p>
        </div>
        <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <p className="text-sm font-medium text-slate-500">Stated value (honest)</p>
          <p className="mt-1 text-3xl font-extrabold text-emerald-700">{formatCompactMoney(agg.statedValue)}</p>
          <p className="mt-1 text-xs text-slate-500">{valueLabel}</p>
        </div>
      </div>

      {/* Top agencies + industries (real content to avoid thin pages) */}
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {agg.agencies.length > 0 && (
          <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
            <h3 className="font-bold text-slate-900">Most active agencies in {name}</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              {agg.agencies.map((a) => (
                <li key={a.name} className="flex items-center justify-between gap-3">
                  <span className="truncate">{a.name}</span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{a.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {agg.industries.length > 0 && (
          <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
            <h3 className="font-bold text-slate-900">Top industries in {name}</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              {agg.industries.map((i) => (
                <li key={i.name} className="flex items-center justify-between gap-3">
                  <span className="truncate">{i.name}</span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{i.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Funnel CTA */}
      <div className="mt-10 rounded-2xl bg-slate-900 p-6 text-center text-white">
        <h3 className="text-lg font-bold">
          See every {name} bid and know if you qualify in seconds
        </h3>
        <a
          href="/signup?plan=professional"
          onClick={() => trackEvent("hero_cta_click", "start_trial")}
          className="mt-4 inline-block rounded-xl bg-amber-500 px-7 py-3.5 text-base font-extrabold text-slate-950 shadow-lg transition-all hover:bg-amber-400 active:scale-[0.99]"
        >
          🚀 Start your 14-day FREE Professional trial →
        </a>
        <p className="mt-2 text-xs text-blue-200/60">
          No credit card required · Full Professional features on your first use ·
          Auto-downgrades to free Basic after 14 days
        </p>
      </div>
    </div>
  );
}

/** Index (/set-aside-contracts): every cert hub with its real live count. */
export function SetAsideIndexView({
  counts,
}: {
  counts: Record<string, number>;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900">
        Federal set-aside contracts, by certification
      </h2>
      <p className="mt-2 max-w-3xl text-slate-600">
        Live open counts for every major set-aside category, straight from federal
        procurement data. Pick your certification to see the real solicitations.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CERT_HUBS.map((c) => (
          <a
            key={c.slug}
            href={c.path}
            className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-amber-400 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">{c.label} Contracts</h3>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-sm font-semibold text-emerald-800">
                {(counts[c.slug] ?? 0).toLocaleString("en-US")} open
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.blurb}</p>
            <p className="mt-3 text-sm font-medium text-amber-600 group-hover:text-amber-700">
              View {c.label} solicitations →
            </p>
          </a>
        ))}
      </div>
      <p className="mt-6 text-sm text-slate-500">
        Counts are live queries of open (due in the future) set-aside solicitations,
        deduplicated and excluding low-content listings — updated every 4 hours.
      </p>
    </div>
  );
}

/** All the covered P1 regions, as chunked internal links. */
export function AllRegionLinks() {
  const link = (code: string) => {
    const slug = (STATE_NAMES[code] ?? "").toLowerCase().replace(/\s+/g, "-");
    return (
      <a key={code} href={`/contracts-in/${slug}`} className={chipCls}>
        {STATE_NAMES[code] ?? code}
      </a>
    );
  };
  return (
    <section className="mt-10">
      <h3 className="text-lg font-bold text-slate-900">Contracts in your state</h3>
      <p className="mt-1 text-sm text-slate-500">Real open bid counts by state.</p>
      <div className="mt-4 flex flex-wrap gap-2">{REGION_CODES.map(link)}</div>
      <p className="mt-4 text-sm">
        <a href="/contracts-by-industry" className="font-semibold text-blue-600 hover:text-blue-800">
          Browse contracts by industry (NAICS) →
        </a>
      </p>
    </section>
  );
}

/** /contracts-by-industry body — real open set-aside counts per NAICS industry. */
export function IndustryHubView({ data }: { data: IndustryHubData }) {
  const { industries } = data;
  return (
    <div>
      <section>
        <h2 className="text-2xl font-bold text-slate-900">
          Open set-aside contracts by industry
        </h2>
        <p className="mt-2 max-w-3xl text-slate-600">
          Real open set-aside solicitations grouped by NAICS industry, counted
          straight from live federal procurement data and updated every 4 hours.
          Only industries with open bids appear — nothing is fabricated.
        </p>
      </section>

      {/* Featured trade guide — mechanical & facilities landing page.
          Static card (no numbers of its own; the target page renders the
          live counts), so it never fabricates or goes stale. */}
      <section className="mt-8" aria-label="Featured trade guide">
        <a
          href="/contracts-hvac-mechanical"
          className="group flex h-full flex-col rounded-2xl border border-amber-300 bg-amber-50/60 p-5 shadow-sm transition-all hover:border-amber-400 hover:shadow-md"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <span className="text-xl font-bold text-slate-900">
              HVAC · Mechanical · Plumbing · Controls · BAS · Facility Maintenance
            </span>
            <span className="shrink-0 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-700">
              Trade guide
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            The licensed mechanical &amp; facilities trades: what agencies post
            set-aside for each one, with live open counts across NAICS 238220,
            236220, 541330, 561720, and 561210.
          </p>
          <p className="mt-3 text-sm font-medium text-amber-600 group-hover:text-amber-700">
            Open the mechanical &amp; facilities trade guide →
          </p>
        </a>
      </section>

      {industries.length === 0 ? (
        <p className="mt-6 max-w-3xl text-slate-600">
          We couldn&apos;t load industry counts right now. Browse the set-aside hubs or
          Contract Radar instead — or start a free trial to get alerted the moment
          matching bids land.
        </p>
      ) : (
        <>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((ind) => {
              const href = ind.slug
                ? `/opportunities/${ind.slug}/${ind.code}`
                : "/small-business-contracts";
              return (
                <li key={ind.code}>
                  <a
                    href={href}
                    className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-amber-400 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xl font-bold text-slate-900">{ind.name}</span>
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-sm font-semibold text-emerald-800">
                        {ind.count.toLocaleString("en-US")} open
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-medium text-slate-500">NAICS {ind.code}</p>
                    <p className="mt-3 text-sm font-medium text-amber-600 group-hover:text-amber-700">
                      View set-aside solicitations →
                    </p>
                  </a>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 text-sm text-slate-500">
            Counts are live queries of open set-aside solicitations grouped by NAICS
            code, excluding low-content listings — updated every 4 hours. Each industry
            links to its real set-aside solicitations.
          </p>
        </>
      )}
    </div>
  );
}
