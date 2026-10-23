import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import { TownZipForm } from "~/components/TownZipForm";

/**
 * /town — "What's Your Town Buying?" (owner 2026-10-23: something catchy to
 * bring people in). Type a ZIP, see the open government bids from the towns
 * around it (src/lib/town/town.ts), share it.
 */
const TITLE = "What's Your Town Buying? See local government contracts by ZIP | Contrax";
const DESC = "Type your ZIP code and see what your city, county and the towns around you are buying from local businesses right now. Free.";
const OG = "https://www.contrax.company/og/town.png";

export const Route = createFileRoute("/town/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "What's your town buying? 👀" },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { property: "og:image", content: OG },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: OG },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/town" }],
  }),
  component: TownIndex,
});

function TownIndex() {
  return (
    <div className="min-h-screen bg-slate-950">
      <SiteHeader />
      <section className="bg-gradient-to-b from-[#0a1f44] to-slate-950 px-4 py-20 text-center text-white">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-400">Free · No signup</p>
        <h1 className="mx-auto mt-4 max-w-3xl text-5xl font-extrabold tracking-tight sm:text-6xl">
          What&apos;s your town <span className="text-amber-400">buying?</span> 👀
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-blue-100">
          Your city, county and school district buy cleaning, landscaping, roofing, HVAC and hundreds of other services from local businesses. Type your ZIP and
          see what&apos;s open right now.
        </p>
        <div className="mt-8">
          <TownZipForm />
        </div>
        <p className="mt-6 text-sm text-slate-400">From 220 government sources, updated every 4 hours on weekdays.</p>
      </section>
    </div>
  );
}
