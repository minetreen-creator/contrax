import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { TownZipForm } from "~/components/TownZipForm";
import { BidAlertCapture } from "~/components/BidAlertCapture";
import { getTownData, type TownBid, type TownData } from "~/lib/town/data";
import { categoryEmoji, shareText } from "~/lib/town/town";
import { trackEvent } from "~/lib/track";

/**
 * /town/:zip — what the towns around a ZIP are buying right now (owner
 * 2026-10-23). One page per ZIP, made to be shared in local Facebook groups
 * and on Nextdoor; noindex so 41,000 near-identical ZIP pages never compete
 * with the real city pages in search.
 */
const OG = "https://www.contrax.company/og/town.png";

export const Route = createFileRoute("/town/$zip")({
  loader: ({ params }) => getTownData({ data: params.zip }),
  head: ({ loaderData }) => {
    const d = loaderData as TownData | undefined;
    const title = d && !d.notFound
      ? `What is ${d.town}, ${d.state} buying? ${d.nearbyOpen} open local contract${d.nearbyOpen === 1 ? "" : "s"} 👀`
      : "What's your town buying? 👀";
    const desc = d && !d.notFound
      ? `See the government contracts open right now in ${d.town} and the towns within ${d.radiusMiles} miles: cleaning, landscaping, roofing, HVAC and more. Free on Contrax.`
      : "Type your ZIP code and see what your town is buying from local businesses right now.";
    return {
      meta: [
        { title: `${title} | Contrax` },
        { name: "description", content: desc },
        { name: "robots", content: "noindex, follow" },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { property: "og:image", content: OG },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: OG },
      ],
    };
  },
  component: TownPage,
});

function fmtDue(due: string): string {
  return new Date(`${due}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function TownPage() {
  const d: TownData = Route.useLoaderData();
  const [copied, setCopied] = useState(false);
  const pageUrl = `https://www.contrax.company/town/${d.zip}?utm_source=share&utm_medium=social&utm_campaign=town`;
  const text = d.notFound ? "" : shareText(d.town, d.state, d.nearbyOpen);
  const share = (where: string, href: string) => {
    trackEvent("town_share", where);
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <SiteHeader />
      <section className="bg-gradient-to-b from-[#0a1f44] to-[#123a72] px-4 py-14 text-center text-white">
        {d.notFound ? (
          <>
            <h1 className="text-3xl font-extrabold sm:text-4xl">We couldn&apos;t find ZIP {d.zip}</h1>
            <p className="mt-3 text-blue-100">Try another US ZIP code.</p>
            <div className="mt-6">
              <TownZipForm size="sm" />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-400">What&apos;s your town buying?</p>
            <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">
              {d.nearbyOpen > 0 ? (
                <>
                  {d.town}, {d.state} is buying <span className="text-amber-400">{d.nearbyOpen}</span> thing{d.nearbyOpen === 1 ? "" : "s"} right now 👀
                </>
              ) : (
                <>Here&apos;s what {d.town}, {d.state} is buying</>
              )}
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-blue-100">
              Open government contracts from {d.town} and the {Math.max(d.townsSearched - 1, 0)} towns within {d.radiusMiles} miles
              {d.stateOpen > 0 && (
                <>
                  , plus <strong className="text-white">{d.stateOpen.toLocaleString("en-US")}</strong> open across {d.state}
                </>
              )}
              .
            </p>
            {d.categories.length > 0 && (
              <div className="mx-auto mt-6 flex max-w-3xl flex-wrap justify-center gap-2">
                {d.categories.map((c: TownData["categories"][number]) => (
                  <span key={c.category} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold">
                    {categoryEmoji(c.category)} {c.category} · {c.count}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-7 flex flex-wrap justify-center gap-2">
              <button
                onClick={() => share("facebook", `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`)}
                className="rounded-xl bg-[#1877f2] px-4 py-2.5 text-sm font-bold text-white"
              >
                Share on Facebook
              </button>
              <button
                onClick={() => share("nextdoor", `https://nextdoor.com/sharekit/?source=contrax&body=${encodeURIComponent(`${text} ${pageUrl}`)}`)}
                className="rounded-xl bg-[#8ed500] px-4 py-2.5 text-sm font-bold text-slate-900"
              >
                Share on Nextdoor
              </button>
              <button
                onClick={() => share("x", `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`)}
                className="rounded-xl bg-black px-4 py-2.5 text-sm font-bold text-white"
              >
                Share on X
              </button>
              <button
                onClick={async () => {
                  trackEvent("town_share", "copy");
                  try {
                    await navigator.clipboard.writeText(`${text} ${pageUrl}`);
                    setCopied(true);
                  } catch {
                    /* clipboard blocked */
                  }
                }}
                className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-900"
              >
                {copied ? "Copied ✓" : "Copy link"}
              </button>
            </div>
          </>
        )}
      </section>

      {!d.notFound && (
        <main className="mx-auto max-w-4xl px-4 py-10">
          {d.bids.length > 0 ? (
            <ul className="space-y-3">
              {d.bids.map((b: TownBid) => (
                <li key={b.id}>
                  <a href={`/bid/${b.id}?utm_source=town&utm_medium=web&utm_campaign=town`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                    <p className="text-base font-bold text-slate-900">
                      {categoryEmoji(b.category)} {b.title}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {b.agency ?? b.location ?? "Government buyer"} · <span className="font-semibold text-slate-800">due {fmtDue(b.due)}</span>
                    </p>
                  </a>
                </li>
              ))}
              {d.nearbyOpen > d.bids.length && (
                <li className="text-center text-sm text-slate-600">
                  Showing the {d.bids.length} closing soonest of {d.nearbyOpen}.{" "}
                  <a href="/radar" className="font-semibold text-blue-700 underline">
                    Search them all free
                  </a>
                </li>
              )}
            </ul>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
              <p className="text-lg font-bold text-slate-900">No open bids name {d.town} or the towns around it right now.</p>
              <p className="mt-2 text-slate-600">
                {d.stateOpen > 0 ? `But ${d.stateOpen.toLocaleString("en-US")} are open across ${d.state}. ` : ""}
                <a href="/radar" className="font-semibold text-blue-700 underline">
                  See them on Contract Radar
                </a>
                .
              </p>
            </div>
          )}

          <div className="mt-10">
            <BidAlertCapture
              stateCode={d.state}
              source="town_page"
              heading={`Get new ${d.state} government bids in your inbox`}
              note="Free. One confirmation email, then only new matches. Unsubscribe anytime."
              tone="light"
            />
          </div>

          <div className="mt-10 rounded-2xl bg-[#0a1f44] p-6 text-center text-white">
            <p className="text-lg font-bold">Check another town</p>
            <div className="mt-4">
              <TownZipForm size="sm" />
            </div>
          </div>

          <p className="mt-8 text-center text-xs text-slate-500">
            &quot;Near&quot; means the buyer or location names a town within {d.radiusMiles} miles of ZIP {d.zip}. Listings come from each government&apos;s own bid board and SAM.gov; always check the official posting.
          </p>
        </main>
      )}
    </div>
  );
}
