import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { STATE_NAMES } from "~/lib/contract-map";
import type { CompanySearchHit } from "~/lib/company-pages";
import { SAM_SOURCE_NOTE } from "~/lib/sam-registrants";
import { SeoLanding, seoHead } from "~/lib/seo-landing";
import { trackEvent } from "~/lib/track";

/**
 * /company — "Find your company" (owner 2026-11-12, "add it"): a contractor types their business
 * name and lands on its company page (src/lib/company-pages.ts) with the bids open for it. A plain
 * GET form, so it works without scripts and a result link can be shared.
 */
const findCompanies = createServerFn({ method: "GET" })
  .validator((d: unknown) => {
    const o = (d ?? {}) as { q?: unknown; state?: unknown };
    return { q: String(o.q ?? "").slice(0, 80), state: String(o.state ?? "").toUpperCase().slice(0, 2) };
  })
  .handler(async ({ data }): Promise<{ q: string; state: string; hits: CompanySearchHit[] }> => {
    const q = data.q.trim();
    const state = STATE_NAMES[data.state] ? data.state : "";
    if (q.length < 3) return { q, state, hits: [] };
    const { searchCompanyPages } = await import("~/lib/company-pages.server");
    return { q, state, hits: await searchCompanyPages(q, state || null) };
  });

export const Route = createFileRoute("/company/")({
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s.q === "string" ? s.q : undefined,
    state: typeof s.state === "string" ? s.state : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => findCompanies({ data: deps }),
  head: ({ loaderData }) => {
    const head = seoHead({
      title: "Find your company: government bids open for your business | Contrax",
      description:
        "Type your business name to see the government bids open now in your state for the trades on your SAM.gov registration. No account needed.",
      canonical: "https://www.contrax.company/company",
    });
    // A search result is one visitor's lookup, not a page for search engines.
    if (loaderData?.q) {
      head.meta = head.meta.map((m) => ("name" in m && m.name === "robots" ? { name: "robots", content: "noindex, follow" } : m));
    }
    return head;
  },
  component: FindCompany,
});

const STATES = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

function FindCompany() {
  const d = Route.useLoaderData();
  const searched = d.q.length >= 3;
  return (
    <SeoLanding
      eyebrow="Find your company"
      headline="See the government bids open for your business"
      subhead="If your business is registered on SAM.gov, it has a page here with the bids open now in your state for your registered trades. Type its name to find it."
      radarHref="/radar"
      radarLabel="Search open government bids"
      honesty={
        <>
          {SAM_SOURCE_NOTE} Only businesses registered as small in a trade Contrax tracks are listed. Not registered? Pick
          your trade and state on Contract Radar instead.
        </>
      }
    >
      <form method="get" action="/company" onSubmit={() => trackEvent("company_search", "submit")} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label htmlFor="company-q" className="block text-sm font-semibold text-slate-900">Business name</label>
        <input
          id="company-q"
          name="q"
          type="search"
          required
          minLength={3}
          maxLength={80}
          defaultValue={d.q}
          autoComplete="organization"
          placeholder="Acme Paving"
          className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-900"
        />
        <label htmlFor="company-state" className="mt-4 block text-sm font-semibold text-slate-900">State (optional)</label>
        <select id="company-state" name="state" defaultValue={d.state} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900">
          <option value="">Any state</option>
          {STATES.map(([code, name]) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
        <button type="submit" className="mt-4 w-full rounded-xl bg-amber-500 px-5 py-3 text-base font-bold text-slate-950 hover:bg-amber-400">
          Find my company →
        </button>
      </form>

      {searched ? (
        <section className="mt-8" aria-live="polite">
          <h2 className="text-xl font-bold text-slate-900">
            {d.hits.length ? `Businesses matching “${d.q}”` : `No registered business matches “${d.q}”`}
          </h2>
          {d.hits.length ? (
            <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {d.hits.map((h) => (
                <li key={h.path} className="flex">
                  <a
                    href={h.path}
                    onClick={() => trackEvent("company_search_result_click", h.state)}
                    className="flex w-full flex-col rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm hover:border-blue-400 hover:shadow-md"
                  >
                    <span className="text-base font-semibold text-slate-900">{h.name}</span>
                    <span className="mt-0.5 text-sm text-slate-600">{[h.city, STATE_NAMES[h.state] ?? h.state].filter(Boolean).join(", ")}</span>
                    <span className="mt-2 text-sm font-semibold text-blue-700">See the bids open for this business →</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-700">
              Check the spelling, try fewer words, or leave the state open. A business appears here only if it is registered on
              SAM.gov as small in a trade we track.{" "}
              <a href="/radar" className="font-semibold text-blue-700 hover:underline">See open bids by trade and state →</a>
            </p>
          )}
          {d.hits.length >= 10 ? <p className="mt-3 text-sm text-slate-600">Showing the first 10. Add a word or pick a state to narrow it.</p> : null}
        </section>
      ) : null}
    </SeoLanding>
  );
}
