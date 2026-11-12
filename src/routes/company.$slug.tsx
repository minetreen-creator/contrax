import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { agencyCardLabel } from "~/lib/bid-job-summary";
import {
  companyDescription,
  companyIndexable,
  companySubhead,
  companyTitle,
  EMPTY_COMPANY_PAGE,
  lowerTrade,
  topCount,
  ueiFromSlug,
  type CompanyBid,
  type CompanyPageData,
} from "~/lib/company-pages";
import { publishedDateOnlyFor } from "~/lib/deadline-label";
import { SAM_SOURCE_NOTE } from "~/lib/sam-registrants";
import { fmtDue, SeoLanding, seoHead } from "~/lib/seo-landing";
import { trackEvent } from "~/lib/track";

/**
 * /company/{name}-{uei} — one SAM.gov registered small business and the government bids open now
 * that fit its registered trades and state (owner 2026-11-12, src/lib/company-pages.ts). Public
 * registration facts only; the business is never contacted.
 */
const getCompanyPage = createServerFn({ method: "GET" })
  .validator((d: unknown) => ({ slug: String((d as { slug?: unknown })?.slug ?? "").slice(0, 120) }))
  .handler(async ({ data }): Promise<CompanyPageData> => {
    const uei = ueiFromSlug(data.slug);
    if (!uei) return EMPTY_COMPANY_PAGE;
    const { loadCompanyPage } = await import("~/lib/company-pages.server");
    return loadCompanyPage(uei);
  });

export const Route = createFileRoute("/company/$slug")({
  loader: ({ params }) => getCompanyPage({ data: { slug: params.slug } }),
  head: ({ loaderData }) => {
    const d = loaderData ?? EMPTY_COMPANY_PAGE;
    const head = seoHead({
      title: companyTitle(d),
      description: companyDescription(d),
      canonical: `https://www.contrax.company${d.path ?? "/radar"}`,
    });
    // A page with no open bids on it, or no business behind it, stays out of search results.
    if (!companyIndexable(d)) {
      head.meta = head.meta.map((m) => ("name" in m && m.name === "robots" ? { name: "robots", content: "noindex, follow" } : m));
    }
    return head;
  },
  component: CompanyPage,
});

function BidRow({ b, trade }: { b: CompanyBid; trade: string }) {
  const due = publishedDateOnlyFor(b.due_date, b.source) ?? fmtDue(b.due_date);
  const agency = agencyCardLabel(b.agency);
  return (
    <li className="flex">
      <a
        href={`/bid/${b.id}`}
        onClick={() => trackEvent("company_bid_click", trade)}
        className="flex w-full flex-col rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm hover:border-blue-400 hover:shadow-md"
      >
        {agency ? <span className="line-clamp-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{agency}</span> : null}
        <span className="mt-0.5 line-clamp-2 text-base font-semibold text-slate-900">{b.title || "Solicitation"}</span>
        <span className="mt-1 text-sm text-slate-600">{[b.location, due && `Due ${due}`].filter(Boolean).join(" · ")}</span>
        <span className="mt-2 text-sm font-semibold text-blue-700">See the job and how to bid →</span>
      </a>
    </li>
  );
}

function CompanyPage() {
  const d = Route.useLoaderData();
  useEffect(() => {
    if (d.found) trackEvent("company_page_view", d.state ?? undefined);
  }, [d.found, d.state]);

  if (!d.found || !d.name) {
    return (
      <SeoLanding
        eyebrow="Registered government contractors"
        headline="We couldn't find that business"
        subhead="It may have left SAM.gov, or its page was removed. You can still see every open bid for your trade and state."
        radarHref="/radar"
        radarLabel="Search open government bids"
        honesty={<>{SAM_SOURCE_NOTE}</>}
      >
        <a href="/company" className="font-semibold text-blue-700 hover:underline">Find a business by name →</a>{" "}
        <a href="/radar" className="font-semibold text-blue-700 hover:underline">Search open bids by trade and state →</a>
      </SeoLanding>
    );
  }

  const place = [d.city, d.stateName].filter(Boolean).join(", ");
  const first = d.trades[0];
  const best = d.trades.find((t) => t.count === topCount(d)) ?? first;
  return (
    <SeoLanding
      eyebrow={`Registered government contractor${place ? ` · ${place}` : ""}`}
      headline={d.name}
      subhead={companySubhead(d)}
      radarHref={best?.radarHref ?? "/radar"}
      signupState={d.state}
      radarLabel={`Search open bids for ${d.name}`}
      honesty={
        <>
          {SAM_SOURCE_NOTE} Contrax is not affiliated with this business and has not contacted it. Bids are matched by
          trade and state, not by this business's qualifications, and nothing here is an award or guaranteed work.
        </>
      }
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Contrax", item: "https://www.contrax.company/" },
              ...(first ? [{ "@type": "ListItem", position: 2, name: `${first.label} bids in ${d.stateName}`, item: `https://www.contrax.company${first.statePath}` }] : []),
              { "@type": "ListItem", position: first ? 3 : 2, name: d.name },
            ],
          }),
        }}
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">On its SAM.gov registration</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          {place ? (
            <div>
              <dt className="font-semibold text-slate-500">Location</dt>
              <dd className="text-slate-900">{place}</dd>
            </div>
          ) : null}
          {d.trades.length ? (
            <div>
              <dt className="font-semibold text-slate-500">Trades (small business)</dt>
              <dd className="text-slate-900">{d.trades.map((t) => t.label).join(", ")}</dd>
            </div>
          ) : null}
          {d.certs.length ? (
            <div>
              <dt className="font-semibold text-slate-500">Business types</dt>
              <dd className="text-slate-900">{d.certs.join(", ")}</dd>
            </div>
          ) : null}
          {d.naics.length ? (
            <div className="sm:col-span-2">
              <dt className="font-semibold text-slate-500">NAICS codes</dt>
              <dd className="text-slate-900">{d.naics.map((n) => (n.name ? `${n.code} ${n.name}` : n.code)).join(" · ")}</dd>
            </div>
          ) : null}
        </dl>
        {d.extractDate ? <p className="mt-3 text-xs text-slate-500">SAM.gov public extract dated {d.extractDate}.</p> : null}
      </section>

      {d.trades.map((t) => (
        <section key={t.slug} className="mt-8">
          <h2 className="text-xl font-bold text-slate-900">
            {t.count > 0
              ? `${t.count.toLocaleString("en-US")} open ${lowerTrade(t.label)} ${t.count === 1 ? "bid" : "bids"} in ${d.stateName}`
              : `${t.label} bids in ${d.stateName}`}
          </h2>
          {t.count > 0 ? (
            <>
              <p className="mt-1 text-sm text-slate-600">Soonest due first. Tap a bid to see the job, the due date and how to bid.</p>
              <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {t.bids.map((b) => (
                  <BidRow key={b.id} b={b} trade={t.slug} />
                ))}
              </ul>
              <a
                href={t.radarHref}
                onClick={() => trackEvent("company_radar_click", t.slug)}
                className="mt-4 inline-block rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400"
              >
                {t.count > t.bids.length ? `See all ${t.count.toLocaleString("en-US")} matches` : "Search these in Contract Radar"} →
              </a>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-700">
              None open in {d.stateName} today
              {t.nationwideCount > 0 ? `, and ${t.nationwideCount.toLocaleString("en-US")} nationwide ${t.nationwideCount === 1 ? "one" : "ones"} open to a business in any state` : ""}.{" "}
              <a href={t.radarHref} onClick={() => trackEvent("company_radar_click", t.slug)} className="font-semibold text-blue-700 hover:underline">
                Search {lowerTrade(t.label)} bids →
              </a>
            </p>
          )}
          <p className="mt-3 text-sm">
            <a href={t.statePath} className="font-semibold text-blue-700 hover:underline">
              All {lowerTrade(t.label)} bids in {d.stateName} →
            </a>
          </p>
        </section>
      ))}

      <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Is this your business?</h2>
        <p className="mt-1 text-sm text-slate-700">
          Claim it to be listed for prime contractors looking for subcontractors, at no charge.{" "}
          <a href={`/sub-finder/claim?uei=${d.uei}`} onClick={() => trackEvent("company_claim_click", d.state ?? undefined)} className="font-semibold text-blue-700 hover:underline">
            Claim this business →
          </a>
        </p>
        <p className="mt-2 text-sm text-slate-700">
          To have this page removed, email{" "}
          <a href={`mailto:contrax.companyllc@gmail.com?subject=${encodeURIComponent(`Remove company page ${d.uei}`)}`} className="font-semibold text-blue-700 hover:underline">
            contrax.companyllc@gmail.com
          </a>{" "}
          and we will take it down.
        </p>
      </section>

      {d.neighbours.length ? (
        <section className="mt-8">
          <h2 className="text-lg font-bold text-slate-900">Other registered businesses in {d.city}</h2>
          <ul className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            {d.neighbours.map((n) => (
              <li key={n.path}>
                <a href={n.path} className="text-blue-700 hover:underline">{n.name}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </SeoLanding>
  );
}
