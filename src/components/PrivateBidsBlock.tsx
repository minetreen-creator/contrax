import { POST_PROJECT_PATH } from "~/lib/private-bid-post";
import { privateBidsForPlace, publishedPrivateBids } from "~/lib/private-bids";

/**
 * Businesses taking bids, and the card for owners to post a project (owner 2026-11-18). On the
 * homepage ("home") and, since most Facebook visitors land on a state page and never see the
 * homepage, on the state pages too ("page"). Shows only published requests; nothing renders when
 * there are none.
 */
export function PrivateBidsBlock({ variant = "home", stateCode = null }: { variant?: "home" | "page"; stateCode?: string | null }) {
  const requests = privateBidsForPlace(publishedPrivateBids(), variant, stateCode);
  // The homepage shows nothing when there are no requests; a state page still shows the card to post one.
  if (requests.length === 0 && variant === "home") return null;
  return (
    <section aria-labelledby="private-bids-block-title" className={variant === "home" ? "bg-amber-50 px-4 py-8 text-slate-900 sm:px-8 sm:py-10" : "mx-auto mt-8 max-w-3xl rounded-2xl bg-amber-50 px-4 py-6 text-left text-slate-900 sm:px-6"}>
      <div className={variant === "home" ? "mx-auto max-w-7xl" : ""}>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Private bid requests</p>
        <h2 id="private-bids-block-title" className="mt-1 text-2xl font-extrabold">{requests.length ? "Businesses taking bids right now" : "Private businesses can take bids here too"}</h2>
        <ul className={requests.length ? "mt-4 grid gap-3 sm:grid-cols-2" : "hidden"}>
          {requests.slice(0, 4).map((r) => (
            <li key={r.slug} className="flex flex-col rounded-xl border border-amber-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700">{r.trade}</p>
              <a href={`/private-bids/${r.slug}`} className="mt-1 font-bold text-slate-900 underline-offset-4 hover:underline">{r.title}</a>
              <p className="mt-1 text-sm text-slate-600">{r.buyer} · {r.locations.length === 1 ? r.locations[0] : `${r.locations.length} locations in ${r.states.join(" and ")}`}</p>
              <a href={`/private-bids/${r.slug}`} className="mt-3 inline-block self-start rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">View details and how to bid →</a>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-col gap-4 rounded-2xl bg-slate-900 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">For business owners</p>
            <h3 className="mt-1 text-xl font-extrabold">Need work done at your business?</h3>
            <p className="mt-1 text-sm text-slate-300">Post the job free. We review it and list it here, and contractors send their bids straight to you. No fee, no account.</p>
          </div>
          <a href={POST_PROJECT_PATH} className="shrink-0 self-start rounded-xl bg-amber-500 px-6 py-3 text-center font-bold text-slate-950 hover:bg-amber-400 sm:self-center">Post your project free →</a>
        </div>
      </div>
    </section>
  );
}
