import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { STATE_NAMES } from "~/lib/contract-map";
import { SEO_TRADE_BY_SLUG } from "~/lib/seo-trades";
import { certNames } from "~/lib/sub-finder";
import { trackEvent } from "~/lib/track";

/**
 * /sub-finder/join — for subcontractors (owner 2026-11-10, subs for primes item 3): get quote
 * requests from primes. Find your business (SAM.gov registration) and claim it, or create an
 * account and list. The page the Facebook posts point to. Contrax contacts no one from it.
 */
const STATE_OPTIONS = Object.entries(STATE_NAMES)
  .filter(([c]) => c.length === 2 && !["PR", "GU", "VI", "AS", "MP"].includes(c))
  .sort((a, b) => a[1].localeCompare(b[1]));

const getJoin = createServerFn({ method: "GET" }).handler(async () => {
  const out = { primesWithPlans: 0, registered: 0 };
  try {
    const { sql } = await import("~/db");
    const [p, r] = await Promise.all([
      sql()`SELECT COUNT(DISTINCT uei)::int AS n FROM subcontract_primes`.catch(() => [{ n: 0 }]),
      sql()`SELECT COUNT(*)::int AS n FROM sam_registrants`.catch(() => [{ n: 0 }]),
    ]);
    out.primesWithPlans = Number((p as { n: number }[])[0]?.n ?? 0);
    out.registered = Number((r as { n: number }[])[0]?.n ?? 0);
  } catch {
    /* page still works */
  }
  return out;
});

const findMine = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const o = (d ?? {}) as { name?: unknown; state?: unknown };
    const st = String(o.state ?? "").toUpperCase();
    return { name: String(o.name ?? "").slice(0, 80), state: STATE_NAMES[st] ? st : null };
  })
  .handler(async ({ data }) => {
    const { searchRegistrants } = await import("~/lib/sam-registrants.server");
    return searchRegistrants(data.name, data.state, 10);
  });

export const Route = createFileRoute("/sub-finder_/join")({
  // The homepage card sends ?name=…&state=… so the search runs as the page opens (owner 2026-11-10).
  validateSearch: (s: Record<string, unknown>): { name?: string; state?: string } => ({
    ...(typeof s.name === "string" && s.name.trim() ? { name: s.name.slice(0, 80) } : {}),
    ...(typeof s.state === "string" && STATE_NAMES[s.state.toUpperCase()] ? { state: s.state.toUpperCase() } : {}),
  }),
  loader: () => getJoin(),
  head: () => ({
    meta: [
      { title: "Subcontractors: Get Quote Requests from Prime Contractors | Contrax Sub Finder" },
      {
        name: "description",
        content: "Prime contractors bidding government jobs are looking for local subs. Find your business and claim it, or list it in two minutes, and get quote requests by email.",
      },
    ],
    links: [{ rel: "canonical", href: "https://www.contrax.company/sub-finder/join" }],
  }),
  component: JoinPage,
});

type Found = Awaited<ReturnType<typeof findMine>>;

function JoinPage() {
  const d = Route.useLoaderData();
  const initial = Route.useSearch();
  const [name, setName] = useState(initial.name ?? "");
  const [st, setSt] = useState(initial.state ?? "");
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async (q = name, state = st) => {
    if (q.trim().length < 3) return;
    setBusy(true);
    const rows = await findMine({ data: { name: q, state } }).catch(() => [] as Found);
    setFound(rows);
    setBusy(false);
    trackEvent("sub_finder_join_search", rows.length ? "found" : "none");
  };
  useEffect(() => {
    if (initial.name) void search(initial.name, initial.state ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
          <a href="/sub-finder" className="hover:underline">Sub Finder</a> · For subcontractors
        </p>
        <h1 className="mt-1 text-3xl font-bold sm:text-4xl">Get quote requests from prime contractors</h1>
        <p className="mt-2 max-w-2xl text-slate-700">
          Primes bidding government jobs need local subs, often on short notice. List your business on Sub Finder and they can send you the scope and deadline by email. You
          answer the ones you want.
        </p>
        {d.primesWithPlans > 0 ? (
          <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm text-slate-800">
            <strong>{d.primesWithPlans.toLocaleString("en-US")}</strong> prime contractors hold federal subcontracting plans, which means they must give part of their work to
            small businesses.
          </p>
        ) : null}

        <section className="mt-6 rounded-2xl border-2 border-slate-900 bg-white p-5">
          <h2 className="text-lg font-bold">Registered in SAM.gov? Find your business</h2>
          <p className="mt-1 text-sm text-slate-600">
            {d.registered > 0 ? `${d.registered.toLocaleString("en-US")} small businesses are already in Sub Finder from SAM.gov. ` : ""}Find yours and claim it: your profile fills in
            from your registration.
          </p>
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[1fr_180px_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name" aria-label="Business name" className="rounded-lg border border-slate-300 px-3 py-2" />
            <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="State" className="rounded-lg border border-slate-300 px-3 py-2">
              <option value="">Any state</option>
              {STATE_OPTIONS.map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </select>
            <button type="submit" disabled={busy || name.trim().length < 3} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
              {busy ? "Searching…" : "Find my business"}
            </button>
          </form>
          {found ? (
            found.length ? (
              <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {found.map((r) => (
                  <li key={r.uei} className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-slate-600">
                        {[r.city, r.state, r.trades.map((t) => SEO_TRADE_BY_SLUG[t]?.label ?? t).join(", ")].filter(Boolean).join(" · ")}
                      </p>
                      {r.certs.length ? <p className="text-xs text-emerald-700">{certNames(r.certs.filter((c) => c !== "vosb" || !r.certs.includes("sdvosb"))).join(", ")}</p> : null}
                    </div>
                    <a href={`/sub-finder/claim?uei=${r.uei}`} onClick={() => trackEvent("sub_finder_claim_click", "join")} className="shrink-0 rounded-lg bg-blue-700 px-3 py-1.5 text-center font-semibold text-white">
                      This is mine: claim it
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-700">No match. Sub Finder only includes small businesses in its trades. You can still list your business below.</p>
            )
          ) : null}
        </section>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          <h2 className="text-lg font-bold">Not registered, or can't find it?</h2>
          <p className="mt-1 text-slate-700">Create an account, tell us your trade and states, and check "List my business for primes". It takes about two minutes.</p>
          <a
            href={`/signup?source=sub_finder_join&next=${encodeURIComponent("/sub-finder#listing")}`}
            onClick={() => trackEvent("sub_finder_join_signup")}
            className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white"
          >
            Create an account and get listed →
          </a>
        </section>

        <section className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["1. Get listed", "Claim your SAM.gov registration or create a profile with your trade, states and certifications."],
            ["2. Get requests", "A prime picks you for a job in your trade and state. You get the scope and quote deadline by email."],
            ["3. Answer the ones you want", "Send your quote on the job's page. The prime gets it and replies to you directly."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <p className="font-bold">{t}</p>
              <p className="mt-1 text-slate-700">{b}</p>
            </div>
          ))}
        </section>

        <p className="mt-5 text-xs text-slate-500">
          You choose to be listed, and you can stop any time; every request has a one-click way to stop. Each prime can send a limited number of requests per job. Certifications
          are shown as self-reported. Questions: contrax.companyllc@gmail.com.
        </p>
      </main>
    </div>
  );
}
