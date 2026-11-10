import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { STATE_NAMES } from "~/lib/contract-map";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { certNames } from "~/lib/sub-finder";
import { trackEvent } from "~/lib/track";

/**
 * /sub-finder/claim?uei=… — "Claim your business" (owner 2026-11-10, subs for primes item 1). A
 * small business registered in SAM.gov claims its entry: the profile fills in from the
 * registration and is listed for primes. One account per business. Contrax contacts no one; the
 * business comes here itself.
 */
const getClaim = createServerFn({ method: "GET" })
  .validator((d: unknown) => ({ uei: String((d as { uei?: unknown })?.uei ?? "").toUpperCase().slice(0, 12) }))
  .handler(async ({ data }) => {
    const { getRegistrant, claimOwner } = await import("~/lib/sam-registrants.server");
    const r = await getRegistrant(data.uei);
    let userId: number | null = null;
    try {
      const { getCurrentUser } = await import("~/lib/auth");
      userId = (await getCurrentUser())?.id ?? null;
    } catch {
      /* visitors see the page */
    }
    let claimedBy: "you" | "other" | null = null;
    if (r) {
      try {
        const owner = await claimOwner(r.uei);
        claimedBy = owner == null ? null : owner === userId ? "you" : "other";
      } catch {
        claimedBy = null;
      }
    }
    return { registrant: r, signedIn: userId != null, claimedBy };
  });

const claim = createServerFn({ method: "POST" })
  .validator((d: unknown) => ({ uei: String((d as { uei?: unknown })?.uei ?? "").toUpperCase().slice(0, 12) }))
  .handler(async ({ data }) => {
    const { getCurrentUser } = await import("~/lib/auth");
    const user = await getCurrentUser();
    if (!user) return { ok: false as const, error: "Sign in first." };
    const { claimRegistrant } = await import("~/lib/sam-registrants.server");
    return claimRegistrant(user.id, String(user.email ?? ""), data.uei);
  });

export const Route = createFileRoute("/sub-finder_/claim")({
  validateSearch: (s: Record<string, unknown>) => ({ uei: typeof s.uei === "string" ? s.uei : "" }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getClaim({ data: deps }),
  head: () => ({ meta: [{ title: "Claim your business on Sub Finder | Contrax" }, { name: "robots", content: "noindex" }] }),
  component: ClaimPage,
});

function ClaimPage() {
  const d = Route.useLoaderData();
  const { uei } = Route.useSearch();
  const [state, setState] = useState<"idle" | "saving" | "done">(d.claimedBy === "you" ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [emailMatch, setEmailMatch] = useState(false);
  const r = d.registrant;
  const here = `/sub-finder/claim?uei=${encodeURIComponent(uei)}`;

  const go = async () => {
    setState("saving");
    setError(null);
    const res = await claim({ data: { uei } }).catch(() => ({ ok: false as const, error: "Could not save just now. Please try again." }));
    if (!res.ok) {
      setState("idle");
      return setError(res.error);
    }
    setEmailMatch(res.emailMatch);
    setState("done");
    trackEvent("sub_finder_claimed", res.emailMatch ? "email_match" : "no_match");
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <main className="mx-auto max-w-xl px-4 py-10">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          <a href="/sub-finder/join" className="hover:underline">Sub Finder</a> · Claim your business
        </p>
        {!r ? (
          <>
            <h1 className="mt-1 text-2xl font-bold">We couldn't find that business</h1>
            <p className="mt-2 text-slate-700">
              It may have left SAM.gov, or the link is incomplete. <a href="/sub-finder/join" className="font-semibold text-blue-700">Search for your business →</a>
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-1 text-2xl font-bold">Claim {r.name}</h1>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
              <p className="font-semibold text-slate-900">{r.name}</p>
              <p className="text-slate-600">{[r.city, STATE_NAMES[r.state] ?? r.state].filter(Boolean).join(", ")}</p>
              <p className="mt-1 text-slate-700">{r.trades.map((t) => SEO_TRADE_BY_SLUG[t]?.label ?? t).join(", ")}</p>
              {r.certs.length ? <p className="text-emerald-700">{certNames(r.certs.filter((c) => c !== "vosb" || !r.certs.includes("sdvosb"))).join(", ")}</p> : null}
              <p className="mt-2 text-xs text-slate-500">From this business's SAM.gov registration.</p>
            </div>

            {state === "done" ? (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm">
                <p className="font-bold text-slate-900">Claimed. Your business is listed for primes.</p>
                <p className="mt-1 text-slate-700">
                  Primes using Sub Finder can now send you quote requests by email for {r.trades.length > 1 ? "your trades" : "your trade"} in {STATE_NAMES[r.state] ?? r.state}. Every request has a link to stop.
                </p>
                {emailMatch ? <p className="mt-1 text-emerald-800">Your email matches the website on this registration.</p> : null}
                <div className="mt-3 flex flex-wrap gap-3 font-semibold">
                  <a href="/sub-finder#listing" className="text-blue-700">Manage your listing →</a>
                  <a href="/dashboard" className="text-blue-700">See open bids for your business →</a>
                </div>
              </div>
            ) : d.claimedBy === "other" ? (
              <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                This business was already claimed by another account. If that's wrong, email <a href="mailto:contrax.companyllc@gmail.com" className="font-semibold">contrax.companyllc@gmail.com</a>.
              </p>
            ) : (
              <div className="mt-5 rounded-2xl border-2 border-slate-900 bg-white p-5 text-sm">
                <h2 className="text-lg font-bold">What claiming does</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
                  <li>Your Contrax profile fills in from this registration: name, trade, state and certifications.</li>
                  <li>Your business is listed for primes, so they can send you quote requests by email for real government jobs.</li>
                  <li>You can stop being listed any time, and every request has a one-click way to stop.</li>
                </ul>
                <p className="mt-2 text-xs text-slate-500">Only claim a business you own or work for. One account per business.</p>
                {error ? <p className="mt-2 text-red-700">{error}</p> : null}
                {d.signedIn ? (
                  <button type="button" onClick={() => void go()} disabled={state === "saving"} className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50">
                    {state === "saving" ? "Claiming…" : `Claim ${r.name} and get listed`}
                  </button>
                ) : (
                  <>
                    <a
                      href={`/signup?source=sub_finder_claim&next=${encodeURIComponent(here)}`}
                      onClick={() => trackEvent("sub_finder_claim_signup", r.uei)}
                      className="mt-4 block w-full rounded-lg bg-slate-900 px-4 py-2.5 text-center font-semibold text-white"
                    >
                      Create an account to claim it
                    </a>
                    <p className="mt-2 text-center text-xs text-slate-600">
                      Already have an account? <a href="/login" className="font-semibold text-blue-700">Sign in</a>, then open this page again.
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
