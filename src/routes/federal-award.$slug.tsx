import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { SupplierRequestForm } from "~/components/SupplierRequestForm";
import {
  awardDescription,
  awardIdFromSlug,
  awardLongDay,
  awardOutOfState,
  awardTitle,
  onFileLine,
  type AwardPageData,
} from "~/lib/award-pages";
import { federalWinnersStateHref } from "~/lib/federal-construction";
import { seoHead } from "~/lib/seo-landing";
import { stateSlugOf } from "~/lib/sub-finder";
import { SUPPLIER_PRICE, supplierDay, supplierMoney } from "~/lib/supplier-report";
import { trackEvent } from "~/lib/track";

/**
 * /federal-award/{company}-{state}-{id} — who won one large federal construction contract
 * (owner 2026-11-24, src/lib/award-pages.ts). Public USAspending.gov facts; the winner's contact
 * details stay in the weekly supplier report.
 */
const getAwardPage = createServerFn({ method: "GET" })
  .validator((d: unknown) => ({ slug: String((d as { slug?: unknown })?.slug ?? "").slice(0, 140) }))
  .handler(async ({ data }): Promise<AwardPageData | null> => {
    const id = awardIdFromSlug(data.slug);
    if (!id) return null;
    try {
      const { loadAwardPage } = await import("~/lib/award-pages.server");
      return await loadAwardPage(id);
    } catch (e) {
      console.error("[federal-award] load failed:", (e as Error).message);
      return null;
    }
  });

export const Route = createFileRoute("/federal-award/$slug")({
  loader: ({ params }) => getAwardPage({ data: { slug: params.slug } }),
  head: ({ loaderData: d }) => {
    const head = seoHead({
      title: d ? awardTitle(d) : "Federal construction contract winners | Contrax",
      description: d ? awardDescription(d) : "Who won federal construction contracts, from USAspending.gov records.",
      canonical: `https://www.contrax.company${d?.path ?? "/suppliers"}`,
    });
    if (!d) head.meta = head.meta.map((m) => ("name" in m && m.name === "robots" ? { name: "robots", content: "noindex, follow" } : m));
    return head;
  },
  component: AwardPage,
});

function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="font-semibold text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

function AwardPage() {
  const d = Route.useLoaderData();
  useEffect(() => {
    if (d) trackEvent("award_page_view", d.state);
  }, [d]);

  if (!d) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900">
        <SiteHeader />
        <div className="mx-auto max-w-3xl px-4 py-16">
          <h1 className="text-2xl font-bold">We couldn't find that award</h1>
          <p className="mt-3 text-slate-600">It may be too small for its own page, or the link is mistyped.</p>
          <a href="/suppliers" className="mt-4 inline-block font-semibold text-blue-700">See who is winning work in your state →</a>
        </div>
      </main>
    );
  }

  const money = supplierMoney(d.amount);
  const onFile = onFileLine(d.onFile);
  const stateHref = federalWinnersStateHref(stateSlugOf(d.stateName));
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Contrax", item: "https://www.contrax.company/" },
                { "@type": "ListItem", position: 2, name: `Federal construction winners in ${d.stateName}`, item: `https://www.contrax.company${stateHref}` },
                { "@type": "ListItem", position: 3, name: d.company },
              ],
            }),
          }}
        />
        <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Federal construction award · {d.stateName}</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          {d.company} won a {money} federal construction contract in {d.stateName}
        </h1>
        {d.what ? <p className="mt-3 max-w-2xl text-lg text-slate-700">{d.what}</p> : null}

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">The award</h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <Fact label="Winner" value={d.company} />
            <Fact label="Based in" value={d.basedIn} />
            <Fact label="Amount" value={money} />
            <Fact label="Awarded" value={awardLongDay(d.awardedOn)} />
            <Fact label="Agency" value={[d.agency, d.subAgency].filter((x, i, all) => x && all.indexOf(x) === i).join(" · ")} />
            <Fact label="Work is in" value={d.stateName} />
          </dl>
          <p className="mt-4 text-sm">
            <a
              href={d.recordUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("award_page_record_click", d.state)}
              className="font-semibold text-blue-700 underline underline-offset-4 hover:text-blue-900"
            >
              See the federal record on USAspending.gov →
            </a>
          </p>
        </section>

        <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-lg font-bold">Selling to the winner?</h2>
          <p className="mt-2 text-sm text-slate-800">
            {awardOutOfState(d)
              ? `${d.company} is based outside ${d.stateName}, so it will be buying materials, renting equipment and hiring labor near the job. `
              : `${d.company} has the job in hand and is buying materials, renting equipment and hiring labor for it now. `}
            The Contrax supplier report lists every new federal construction winner in {d.stateName} each week, with the jobs still open
            for bids and the contracts about to end.
          </p>
          {onFile ? <p className="mt-2 text-sm font-semibold text-slate-900">{onFile} It comes with the report.</p> : null}
          <p className="mt-2 text-sm text-slate-800">
            Your first report is free. After that it is {SUPPLIER_PRICE} a month, and you can cancel anytime.
          </p>
        </section>

        <div className="mt-6">
          <SupplierRequestForm where="award_page" />
        </div>

        {d.others.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-bold">Other recent federal construction winners in {d.stateName}</h2>
            <ul className="mt-4 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm">
              {d.others.map((o) => (
                <li key={o.path}>
                  <a href={o.path} onClick={() => trackEvent("award_page_other_click", d.state)} className="flex items-baseline justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className="font-semibold text-blue-700">{o.company}</span>
                    <span className="shrink-0 text-sm text-slate-600">
                      {supplierMoney(o.amount)} · {supplierDay(o.awardedOn)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <h2 className="mt-10 text-xl font-bold">Where this comes from</h2>
        <p className="mt-3 text-sm text-slate-700">
          The winner, amount, date and agency are from USAspending.gov, the federal government's public spending record. The amount is the
          contract's total at the time we read it and can change if the contract is modified. Contrax is not affiliated with {d.company} or
          the agency. Subcontracts are not included.
        </p>

        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
          <a href={stateHref} className="text-blue-700 hover:text-blue-800">Who won federal construction work in {d.stateName} →</a>
          <a href="/suppliers" className="text-blue-700 hover:text-blue-800">See a sample supplier report →</a>
          <a href={`/contracts-in/${stateSlugOf(d.stateName)}/construction`} className="text-blue-700 hover:text-blue-800">Construction bids open in {d.stateName} now →</a>
        </div>
      </div>
    </main>
  );
}
