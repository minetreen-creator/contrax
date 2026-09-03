import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { SeoLanding, seoHead, fmtDue } from "~/lib/seo-landing";
import { trackEvent } from "~/lib/track";

/**
 * /contracts-hvac-mechanical — mechanical & facilities trades landing page.
 *
 * Program-consistent sibling of /contracts-by-industry and /contracts-in/{state}
 * (same SeoLanding layout, seoHead meta, honesty banner, footer links), scoped
 * to the mechanical & facilities trades:
 *   238220 HVAC / mechanical / plumbing · 236220 commercial construction ·
 *   541330 engineering & controls · 561720 facility maintenance ·
 *   561210 facilities support.
 *
 * Honesty rules (same as every SEO landing surface):
 *   - Every count is a LIVE query of the `bids` table (fed by the SAM.gov sync
 *     GH Action every 4h) — open = due_date > NOW(); set-aside = the four
 *     certifications the product targets. Counts re-render fresh on each SSR
 *     pass, so the copy never goes stale and never fabricates.
 *   - Bid cards are REAL rows (DISTINCT ON (title, agency) dedupe + the shared
 *     LOW_CONTENT_SQL predicate, identical to the homepage LiveOpportunities
 *     strip). The section hides itself entirely when the query returns nothing
 *     — no fake cards, ever.
 *   - Each card's "Analyze this opportunity" button routes signed-out visitors
 *     through the established contextual signup pattern
 *     (/signup?title=…&plan=basic&next=/bid/<id>) into the AI Executive Brief.
 *     No new auth, no allowance bypass — the analyze endpoint owns all gating.
 *   - DB failure fails open to empty sections (logged, never a 500).
 */

// The five mechanical & facilities NAICS codes, verified against prod.
const MECH_NAICS = ["238220", "236220", "541330", "561720", "561210"];

interface MechCount {
  naics: string;
  open: number;
  setAside: number;
}

interface MechBid {
  id: number;
  title: string;
  agency: string;
  location: string | null;
  category: string | null;
  set_aside: string | null;
  due_date: string | null;
}

interface MechPageData {
  counts: MechCount[];
  totalSetAside: number;
  bids: MechBid[];
}

// ── Server function ────────────────────────────────────────────────────────────
const getMechanicalPageData = createServerFn({ method: "GET" }).handler(
  async (): Promise<MechPageData> => {
    let counts: MechCount[] = [];
    let bids: MechBid[] = [];
    try {
      const db = sql();
      // Live per-NAICS counts. Plain predicate (no LOW_CONTENT_SQL) so the
      // headline numbers match the verified research baseline exactly; the
      // cards below apply the shared low-content filter like every other
      // public listing surface.
      const countRows = (await db`
        SELECT naics_code,
               COUNT(*)::int AS open_n,
               COUNT(*) FILTER (
                 WHERE set_aside IN ('8(a)', 'SDVOSB', 'WOSB', 'HUBZone')
               )::int AS setaside_n
        FROM bids
        WHERE due_date > NOW()
          AND naics_code = ANY(${MECH_NAICS}::text[])
        GROUP BY naics_code
      `) as { naics_code: string; open_n: number; setaside_n: number }[];
      counts = countRows.map((r) => ({
        naics: String(r.naics_code ?? "").trim(),
        open: Number(r.open_n ?? 0),
        setAside: Number(r.setaside_n ?? 0),
      }));
      // Real open set-aside solicitations across the five codes — same query
      // shape as the homepage LiveOpportunities strip, scoped by NAICS.
      const bidRows = (await db`
        SELECT id, title, agency, location, category, set_aside, due_date
        FROM (
          SELECT DISTINCT ON (title, agency)
                 id, title, agency, location, category, set_aside, due_date, created_at
          FROM bids
          WHERE due_date > NOW()
            AND set_aside IN ('8(a)', 'SDVOSB', 'WOSB', 'HUBZone')
            AND naics_code = ANY(${MECH_NAICS}::text[])
            AND ${db.unsafe(LOW_CONTENT_SQL)}
          ORDER BY title, agency, created_at DESC NULLS LAST
        ) t
        ORDER BY t.created_at DESC NULLS LAST
        LIMIT 6
      `) as Record<string, unknown>[];
      bids = bidRows.map((r) => ({
        id: Number(r.id),
        title: String(r.title ?? "").trim() || "Untitled solicitation",
        agency: String(r.agency ?? "").trim() || "Unknown agency",
        location: r.location ? String(r.location) : null,
        category: r.category ? String(r.category) : null,
        set_aside: r.set_aside ? String(r.set_aside) : null,
        due_date: r.due_date ? String(r.due_date) : null,
      }));
    } catch (err) {
      // Fail open: empty sections render, the page itself never 500s.
      console.error("[contracts-hvac-mechanical] data load failed:", err);
    }
    const totalSetAside = counts.reduce((sum, c) => sum + c.setAside, 0);
    return { counts, totalSetAside, bids };
  },
);

// ── Static page content ────────────────────────────────────────────────────────
/** Friendly label per NAICS code (live counts render next to these). */
const NAICS_LABELS: Record<string, string> = {
  "238220": "HVAC · mechanical · plumbing contractors",
  "236220": "Commercial construction & fit-out",
  "541330": "Engineering & controls design",
  "561720": "Facility maintenance services",
  "561210": "Facilities support services",
};

/** The six trades, each mapped to the NAICS its count comes from. */
const TRADES: { name: string; naics: string[]; blurb: string }[] = [
  {
    name: "HVAC",
    naics: ["238220"],
    blurb:
      "Rooftop-unit replacements, chiller and boiler service, and base-wide HVAC maintenance — reserved work that needs your state license, not a federal IDV.",
  },
  {
    name: "Mechanical",
    naics: ["238220"],
    blurb:
      "Piping, hydronics, and mechanical-room upgrades inside larger set-aside renovations at VA, DoD, and federal buildings.",
  },
  {
    name: "Plumbing",
    naics: ["238220"],
    blurb:
      "Domestic water, sanitary, backflow, and medical-gas work — the licensed trade federal facilities can't skip, posted as set-aside solicitations.",
  },
  {
    name: "Controls",
    naics: ["541330"],
    blurb:
      "Controls engineering and integration documentation on building-upgrade projects — engineering set-asides that compete on quals, not price wars.",
  },
  {
    name: "BAS",
    naics: ["238220", "541330"],
    blurb:
      "Building-automation installs and DDC integration, posted under either the mechanical or the engineering code depending on the agency.",
  },
  {
    name: "Facility Maintenance",
    naics: ["561720", "561210"],
    blurb:
      "Recurring O&M and facilities-support contracts — often multi-year, the steadiest set-aside revenue a certified trade contractor can land.",
  },
];

function setAsideBadgeLabel(raw: string | null): string {
  if (!raw) return "Set-aside";
  return raw;
}

/** Contextual /signup href — mirrors LiveOpportunities.analyzeSignupHref exactly. */
function analyzeSignupHref(bid: MechBid): string {
  const p = new URLSearchParams();
  if (bid.title && bid.title.trim()) p.set("title", bid.title.trim().slice(0, 300));
  p.set("plan", "basic");
  p.set("next", `/bid/${bid.id}`);
  return `/signup?${p.toString()}`;
}

function countFor(counts: MechCount[], naics: string): MechCount | undefined {
  return counts.find((c) => c.naics === naics);
}

// ── Route ──────────────────────────────────────────────────────────────────────
export const Route = createFileRoute("/contracts-hvac-mechanical")({
  loader: () => getMechanicalPageData(),
  head: () =>
    seoHead({
      title: "HVAC & Mechanical Set-Aside Contracts (8(a), SDVOSB, WOSB, HUBZone) | Contrax",
      description:
        "Open federal set-aside solicitations for HVAC, mechanical, plumbing, controls, BAS, and facility maintenance contractors — live counts and real bid postings for 8(a), SDVOSB, WOSB, and HUBZone firms, synced every 4 hours.",
      canonical: "https://www.contrax.company/contracts-hvac-mechanical",
    }),
  component: ContractsHvacMechanical,
});

function ContractsHvacMechanical() {
  const d = Route.useLoaderData();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "HVAC & Mechanical Set-Aside Contracts",
    description:
      "Open federal set-aside solicitations for HVAC, mechanical, plumbing, controls, BAS, and facility maintenance contractors — live counts and real bid postings for 8(a), SDVOSB, WOSB, and HUBZone firms.",
    url: "https://www.contrax.company/contracts-hvac-mechanical",
    isPartOf: {
      "@type": "WebSite",
      name: "Contrax",
      url: "https://www.contrax.company",
    },
  };

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SeoLanding
        eyebrow="⚙ SET-ASIDE CONTRACTS FOR THE MECHANICAL & FACILITIES TRADES"
        headline={
          <>
            Your HVAC / mechanical license unlocks set-aside contracts you&rsquo;re
            missing.
          </>
        }
        subhead={
          <>
            Federal agencies reserve HVAC, plumbing, controls, and
            facility-maintenance work exclusively for 8(a), SDVOSB, WOSB, and
            HUBZone-certified firms. If you hold the license and the
            certification, that solicitation is yours to bid — without competing
            against every large prime in the region. See what&rsquo;s open right
            now, free.
          </>
        }
        radarHref="/radar?trade=HVAC&size=under1m"
        radarLabel="Scan live HVAC & mechanical set-asides free with Contract Radar — no signup"
        honesty={
          <>
            Every count and card on this page is a live query of open
            solicitations in NAICS 238220, 236220, 541330, 561720, and 561210 —
            synced from SAM.gov and state &amp; city sources every 4 hours. Only
            real, currently-open set-asides appear; when none exist the section
            stays empty. Nothing is fabricated.
          </>
        }
      >
        {/* ── Live count strip ─────────────────────────────────────────────── */}
        <section aria-label="Live set-aside counts for these trades">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            {d.totalSetAside > 0 ? (
              <p className="text-lg font-bold text-slate-900">
                {d.totalSetAside} set-aside solicitations are open right now
                across these trades
              </p>
            ) : (
              <p className="text-lg font-bold text-slate-900">
                Set-aside solicitations for these trades, counted live
              </p>
            )}
            <p className="mt-1 text-sm text-slate-500">
              Open set-aside postings by NAICS code · synced every 4 hours
            </p>
            {d.counts.length > 0 && (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {d.counts
                  .filter((c) => NAICS_LABELS[c.naics])
                  .sort((a, b) => b.setAside - a.setAside)
                  .map((c) => (
                    <li
                      key={c.naics}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <p className="text-sm font-bold text-slate-900">
                        {c.setAside} set-aside
                        <span className="font-medium text-slate-500">
                          {" "}
                          · {c.open} open total
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        NAICS {c.naics} — {NAICS_LABELS[c.naics]}
                      </p>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </section>

        {/* ── Six-trade section ────────────────────────────────────────────── */}
        <section className="mt-10" aria-label="The six trades and their set-aside work">
          <h2 className="text-xl font-extrabold text-slate-900">
            Six trades, one certification advantage
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            What agencies actually post set-aside for each licensed trade.
          </p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {TRADES.map((t) => {
              const c = t.naics
                .map((n) => countFor(d.counts, n))
                .find((x) => x && x.setAside > 0);
              return (
                <article
                  key={t.name}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-bold text-slate-900">{t.name}</h3>
                    {c && (
                      <span className="shrink-0 rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
                        {c.setAside} set-aside open
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {t.blurb}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    {t.naics.map((n) => `NAICS ${n}`).join(" · ")}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        {/* ── Real live bids — hides itself when empty, never fake cards ──── */}
        {d.bids.length > 0 && (
          <section className="mt-10" aria-label="Open set-aside solicitations in these trades">
            <h2 className="text-xl font-extrabold text-slate-900">
              Open set-aside solicitations, on the table right now
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Real postings across the mechanical &amp; facilities trades — pick
              one and see what the RFP actually requires.
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {d.bids.map((bid) => {
                const due = fmtDue(bid.due_date);
                return (
                  <article
                    key={bid.id}
                    className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-300 hover:shadow-xl hover:shadow-slate-900/10"
                  >
                    <div className="flex flex-1 flex-col p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
                          {setAsideBadgeLabel(bid.set_aside)}
                        </span>
                        {bid.category && (
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                            {bid.category}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-3 line-clamp-2 text-sm font-bold leading-snug text-slate-900">
                        {bid.title}
                      </h3>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        {bid.agency}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        {bid.location && (
                          <>
                            <span aria-hidden="true">📍</span>
                            <span>{bid.location}</span>
                          </>
                        )}
                        {due && (
                          <>
                            {bid.location && <span aria-hidden="true">·</span>}
                            <span className="font-semibold text-slate-700">
                              Due {due}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="border-t border-slate-100 p-4">
                      <a
                        href={analyzeSignupHref(bid)}
                        onClick={() => trackEvent("mech_live_opp_analyze", String(bid.id))}
                        className="inline-flex w-full items-center justify-center gap-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-amber-400 active:scale-[0.98]"
                      >
                        ✦ Analyze this opportunity <span aria-hidden="true">→</span>
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
            <p className="mt-5 text-center text-xs text-slate-500">
              Source: synced from SAM.gov and state &amp; city solicitations ·
              updated every 4 hours · your free account includes AI Executive
              Briefs
            </p>
          </section>
        )}

        {/* ── Mid-page CTA band — same two CTAs as the hero, scroll depth ─── */}
        <section className="mt-10 rounded-2xl bg-slate-950 px-6 py-10 text-center">
          <h2 className="text-2xl font-extrabold text-white">
            Stop scrolling SAM.gov. Start seeing your set-asides.
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-blue-100/80">
            Contract Radar scans live solicitations for your trade and
            certification in seconds. Your first 3 matches are free — no signup.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="/radar?trade=HVAC&size=under1m"
              onClick={() => trackEvent("mech_cta_click", "radar_activate")}
              className="inline-block rounded-2xl bg-white px-7 py-3.5 text-base font-bold text-slate-950 shadow-xl transition-all hover:bg-blue-50 active:scale-[0.99]"
            >
              📡 Scan HVAC & mechanical set-asides free →
            </a>
            <a
              href="/signup?plan=professional"
              onClick={() => trackEvent("mech_cta_click", "start_trial")}
              className="inline-block rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 px-7 py-3.5 text-base font-extrabold text-slate-950 shadow-xl shadow-amber-500/25 transition-all hover:from-amber-300 hover:to-amber-400 active:scale-[0.99]"
            >
              🚀 Start your 14-day FREE Professional trial →
            </a>
          </div>
          <p className="mt-3 text-xs font-medium text-blue-200/60">
            No credit card required · Full Professional features on your first
            use · Auto-downgrades to free Basic after 14 days
          </p>
        </section>

        {/* ── Cross-links: certification deep links + back to hub ─────────── */}
        <section className="mt-10">
          <h2 className="text-lg font-bold text-slate-900">
            Browse these trades by certification
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="/opportunities/8a/238220"
              className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 hover:text-slate-900"
            >
              8(a) set-asides in NAICS 238220
            </a>
            <a
              href="/opportunities/sdvosb/238220"
              className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 hover:text-slate-900"
            >
              SDVOSB set-asides in NAICS 238220
            </a>
            <a
              href="/opportunities/wosb/238220"
              className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 hover:text-slate-900"
            >
              WOSB set-asides in NAICS 238220
            </a>
            <a
              href="/opportunities/hubzone/238220"
              className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 hover:text-slate-900"
            >
              HUBZone set-asides in NAICS 238220
            </a>
          </div>
          <div className="mt-8 border-t border-slate-200 pt-6 text-sm">
            <a
              href="/contracts-by-industry"
              className="font-semibold text-blue-600 hover:text-blue-800"
            >
              ← All industries (NAICS)
            </a>
            <span className="mx-3 text-slate-300">|</span>
            <a href="/" className="font-semibold text-blue-600 hover:text-blue-800">
              Home
            </a>
          </div>
        </section>
      </SeoLanding>
    </div>
  );
}
