import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { SiteHeader } from "~/components/SiteHeader";
import { PARTNER_CONTACT, PARTNER_TERMS, TAMPA_MARKET, marketBySlug, networkName } from "~/lib/markets";
import { trackEvent } from "~/lib/track";

/**
 * /markets/{slug}/partners — the one-page pitch for a market partner (owner 2026-11-10, item 4): the
 * market's numbers, what a partner gets, how it starts, and the Tampa results so far (live clicks to
 * Casa Blue Collar). For conversations the owner starts; Contrax emails no one from it. noindex.
 */
const getPitch = createServerFn({ method: "GET" })
  .validator((d: unknown) => ({ slug: String((d as { slug?: unknown })?.slug ?? "").toLowerCase().slice(0, 40) }))
  .handler(async ({ data }) => {
    const m = marketBySlug(data.slug);
    if (!m) return null;
    const { partnerClicks } = await import("~/lib/markets.server");
    const tampa = await partnerClicks(TAMPA_MARKET);
    return { slug: m.slug, tampaClicks: tampa.total, tampaVisitors: tampa.visitors };
  });

export const Route = createFileRoute("/markets/$slug_/partners")({
  loader: ({ params }) => getPitch({ data: { slug: params.slug } }),
  head: ({ params }) => {
    const m = marketBySlug(params.slug);
    return { meta: [{ title: m ? `Partner with Contrax in ${m.name} | Contrax` : "Partner with Contrax | Contrax" }, { name: "robots", content: "noindex" }] };
  },
  component: PitchPage,
});

const fmtSince = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function PitchPage() {
  const r = Route.useLoaderData();
  const m = r ? marketBySlug(r.slug) : undefined;
  if (!r || !m) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-12">
          <h1 className="text-2xl font-bold">We don't have that market yet</h1>
          <a href="/markets" className="mt-3 inline-block font-semibold text-blue-700">See our markets →</a>
        </main>
      </div>
    );
  }
  const f = m.facts;
  const mail = `mailto:${PARTNER_CONTACT}?subject=${encodeURIComponent(`${networkName(m)} partner`)}`;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          <a href={m.path} className="hover:underline">{networkName(m)}</a> · For partners
        </p>
        <h1 className="mt-1 text-3xl font-bold">Partner with Contrax in {m.name}</h1>
        <p className="mt-2 text-slate-700">
          Contrax helps contractors find the opportunity, build the team and get the work. In {m.name}, many of them come from out of state for federal jobs and need a place for the
          crew, bonds and equipment. You can be the company we send them to.
        </p>

        <section className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            [f.federalConstruction, `federal construction in ${f.scope.split(" (")[0]}, ${f.asOf.split(" (")[0]}`],
            [f.outOfStateShare, `went to ${f.outOfStateFirms} firms based outside ${m.stateName}`],
            [`${f.endingSoonCount}+`, `contracts worth ${f.endingSoonValue} up for rebid in 12 months`],
          ].map(([v, l]) => (
            <div key={l} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-2xl font-extrabold">{v}</p>
              <p className="text-xs text-slate-600">{l}</p>
            </div>
          ))}
        </section>
        <p className="mt-2 text-xs text-slate-500">Biggest buyers: {f.topBuyers.join(", ")}. Source: {f.source}.</p>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          <h2 className="text-lg font-bold">Who we're looking for</h2>
          <p className="mt-1 text-slate-700">One partner per service in each market:</p>
          <ul className="mt-2 grid gap-1 text-slate-700 sm:grid-cols-2">
            <li>✓ Crew housing (furnished houses, extended stay)</li>
            <li>✓ Surety bonds and contractor insurance</li>
            <li>✓ Equipment rental</li>
            <li>✓ Skilled labor and staffing</li>
          </ul>
        </section>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          <h2 className="text-lg font-bold">What a partner gets</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
            <li>A featured section on the {networkName(m)} page with your services, website and phone number.</li>
            <li>Contractors who use Contrax to find bids and subs in {m.name} see you at the moment they plan the job.</li>
            <li>Tagged links, so you can see the visits we send in your own analytics, and a monthly count of the clicks and calls from Contrax.</li>
            <li>Bookings and prices stay between you and the contractor.</li>
          </ul>
        </section>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          <h2 className="text-lg font-bold">How it starts and what it costs</h2>
          <p className="mt-1 text-slate-700">{PARTNER_TERMS}</p>
          <p className="mt-1 text-slate-600">Each month you get the count of clicks and calls we sent you, so you can judge it yourself.</p>
        </section>

        {r.tampaClicks > 0 ? (
          <section className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sm">
            <h2 className="text-lg font-bold">How it's going in Tampa</h2>
            <p className="mt-1 text-slate-800">
              Since {fmtSince(TAMPA_MARKET.partner!.since)}, contractors have reached our Tampa housing partner, {TAMPA_MARKET.partner!.name}, {r.tampaClicks} time
              {r.tampaClicks === 1 ? "" : "s"} from Contrax ({r.tampaVisitors} {r.tampaVisitors === 1 ? "person" : "different people"}), by website or phone.
            </p>
          </section>
        ) : null}

        <section className="mt-6 rounded-2xl border-2 border-slate-900 bg-white p-5 text-sm">
          <h2 className="text-lg font-bold">Talk to us</h2>
          <p className="mt-1 text-slate-700">Tell us your service and the area you cover.</p>
          <div className="mt-3 flex flex-wrap gap-3 print:hidden">
            <a href={mail} onClick={() => trackEvent("market_partner_contact", m.slug)} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
              Email {PARTNER_CONTACT}
            </a>
            <button type="button" onClick={() => window.print()} className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-800">
              Print this page
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
