import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/SiteHeader";
import {
  BID_PACK_FILES, BID_PACK_FORMAT_NOTE, BID_PACK_HONEST_NOTE, BID_PACK_NAME, BID_PACK_PATH, BID_PACK_PRICE,
  BID_PACK_SESSION_RE, bidPackDownloadHref,
} from "~/lib/bid-pack";
import { seoHead } from "~/lib/seo-landing";
import { trackEvent } from "~/lib/track";

/**
 * /bid-pack — the Public Bid Paperwork Pack (owner 2026-11-27, src/lib/bid-pack.ts): the sales page,
 * and where Stripe returns a buyer (?session=cs_…). The return view shows nothing private: the
 * download itself checks the Stripe session.
 */
export const Route = createFileRoute("/bid-pack")({
  validateSearch: (s: Record<string, unknown>): { session?: string; pack?: string } => ({
    ...(typeof s.session === "string" && BID_PACK_SESSION_RE.test(s.session) ? { session: s.session } : {}),
    ...(s.pack === "cancelled" ? { pack: "cancelled" } : {}),
  }),
  head: () =>
    seoHead({
      title: "Government Bid Templates for Contractors: Paperwork Pack | Contrax",
      description:
        "Six fill-in Word templates for small contractors bidding public work: capability statement, bid cover letter, bid or no-bid checklist, bid day checklist and quote request form. $19, one time.",
      canonical: `https://www.contrax.company${BID_PACK_PATH}`,
    }),
  component: BidPackPage,
});

function BuyButton({ place }: { place: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function buy() {
    setBusy(true);
    setError("");
    trackEvent("bid_pack_checkout", place);
    try {
      const res = await fetch("/api/bid-pack/checkout", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && j.url) { window.location.href = j.url; return; }
      setError(j.error || "Checkout is unavailable right now. Please try again.");
    } catch {
      setError("Checkout is unavailable right now. Please try again.");
    }
    setBusy(false);
  }
  return (
    <div>
      <button type="button" onClick={buy} disabled={busy} className="rounded-xl bg-amber-400 px-6 py-3 text-base font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-60">
        {busy ? "Opening checkout…" : `Get the pack for ${BID_PACK_PRICE} →`}
      </button>
      <p className="mt-2 text-sm text-slate-600">One payment. Nothing renews. Download right after you pay.</p>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}

function BidPackPage() {
  const { session, pack } = Route.useSearch();
  useEffect(() => {
    trackEvent("bid_pack_view", session ? "paid" : pack === "cancelled" ? "cancelled" : "sales");
  }, [session, pack]);

  if (session) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900">
        <SiteHeader />
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Payment received</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Your pack is ready</h1>
          <a
            href={bidPackDownloadHref(session)}
            onClick={() => trackEvent("bid_pack_download")}
            className="mt-6 inline-block rounded-xl bg-slate-900 px-6 py-3 font-bold text-white no-underline hover:bg-slate-800"
          >
            Download my pack →
          </a>
          <p className="mt-4 text-sm text-slate-600">{BID_PACK_FORMAT_NOTE}</p>
          <p className="mt-2 text-sm text-slate-600">
            Start with the capability statement: it is the one you will reuse on every bid. We also emailed you this link, and it keeps
            working. Something wrong with a file? Write to{" "}
            <a href="mailto:contrax.companyllc@gmail.com" className="text-blue-700">contrax.companyllc@gmail.com</a>.
          </p>
          <p className="mt-8 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            Need bids to use these on? Contrax lists open government bids by trade and state, with new ones emailed at 6 AM.{" "}
            <a href="/radar" className="font-semibold text-blue-700">Search open bids →</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <SiteHeader />
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-600">For small contractors bidding public work</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{BID_PACK_NAME}</h1>
        <p className="mt-3 max-w-2xl text-lg text-slate-700">
          Most bids that get thrown out are thrown out for paperwork, not price: a missing signature, an addendum nobody acknowledged, a
          form left blank. These are the six documents that stop that, ready to fill in.
        </p>
        {pack === "cancelled" && (
          <p className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700">No payment was taken. The pack is still here when you want it.</p>
        )}
        <div className="mt-6">
          <BuyButton place="top" />
        </div>

        <img
          src="/bid-pack-preview.jpg"
          alt="Three pages from the pack: the capability statement, the bid or no-bid checklist and the bid day checklist"
          width={2152}
          height={936}
          loading="lazy"
          className="mt-8 w-full rounded-2xl border border-slate-200 shadow-sm"
        />

        <h2 className="mt-10 text-xl font-bold">What is in the pack</h2>
        <ul className="mt-4 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm">
          {BID_PACK_FILES.map((f) => (
            <li key={f.name} className="px-4 py-3">
              <p className="font-semibold text-slate-900">{f.name}</p>
              <p className="text-sm text-slate-600">{f.what}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-slate-600">{BID_PACK_FORMAT_NOTE}</p>

        <h2 className="mt-10 text-xl font-bold">Who it is for</h2>
        <p className="mt-3 text-slate-700">
          A cleaning, landscaping, construction or trades business that wants city, county, school, state or federal work and has not
          built its bid paperwork yet. If you have been bidding for years, you already have your own versions of these.
        </p>

        <h2 className="mt-10 text-xl font-bold">What it is not</h2>
        <p className="mt-3 text-slate-700">{BID_PACK_HONEST_NOTE}</p>

        <div className="mt-8 rounded-2xl border-2 border-amber-400 bg-white p-6 shadow-sm">
          <p className="text-lg font-bold">{BID_PACK_NAME}: {BID_PACK_PRICE}, one time</p>
          <div className="mt-4">
            <BuyButton place="bottom" />
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
          <a href="/radar" className="text-blue-700 hover:text-blue-800">Search open government bids by trade and state →</a>
          <a href="/pricing" className="text-blue-700 hover:text-blue-800">See the $9 a month plan →</a>
        </div>
      </div>
    </main>
  );
}
