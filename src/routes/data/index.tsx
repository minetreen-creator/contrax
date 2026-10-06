import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { SiteHeader } from "~/components/SiteHeader";
import { DATA_REQUEST_USE_CASES, FEED_MAX_LIMIT } from "~/lib/data-feed";

/**
 * /data — the Contrax bid data feed for businesses (owner 2026-10-06: sell the
 * bid data). Live headline numbers, what the feed contains, the API shape, and a
 * request-access form (pricing is quoted per customer by email).
 */
const PROD_URL = "https://www.contrax.company";
const TITLE = "Government Bid Data API | Contrax";
const DESC =
  "Open federal, state and local government bids in one clean feed: real deadlines, official notice links, NAICS, set-asides and state, updated every 4 hours on weekdays.";

const getFeedSummary = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { feedSummary } = await import("~/lib/data-feed.server");
    return await feedSummary();
  } catch {
    return null;
  }
});

export const Route = createFileRoute("/data/")({
  loader: () => getFeedSummary(),
  component: () => (
    <>
      <SiteHeader />
      <DataPage />
    </>
  ),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${PROD_URL}/data` },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:image", content: `${PROD_URL}/logo-square.png` },
      { property: "og:site_name", content: "Contrax" },
    ],
    links: [{ rel: "canonical", href: `${PROD_URL}/data` }],
  }),
});

const FIELDS: [string, string][] = [
  ["title, agency, description", "As posted by the buying agency"],
  ["state", "Two-letter state where the work is, when the notice proves it"],
  ["due_date", "The real response deadline (ISO 8601, UTC)"],
  ["source_url", "Link to the official notice"],
  ["naics_code, psc", "Industry and product/service codes when the notice has them"],
  ["set_aside", "SDVOSB, 8(a), WOSB, HUBZone and other set-asides when listed"],
  ["notice_type, solicitation_number", "Solicitation type and the agency's own number"],
  ["first_seen_at, updated_at", "When Contrax first saw the bid and last refreshed it"],
];

const PARAMS: [string, string][] = [
  ["state", "One or more codes, e.g. VA,NC"],
  ["updated_since", "Only bids new or changed since an ISO date"],
  ["naics", "NAICS prefixes, e.g. 2382,561720"],
  ["set_aside", "Set-aside text, e.g. SDVOSB"],
  ["limit", `Rows per page, 1–${FEED_MAX_LIMIT} (default 100)`],
  ["after", "Paging: pass next_after from the previous page"],
];

const EXAMPLE = `curl -H "Authorization: Bearer $CONTRAX_KEY" \\
  "${PROD_URL}/api/v1/feed?state=RI&limit=1"

{
  "data": [{
    "id": 1234567,
    "title": "2026 Statewide Steel Repairs",
    "agency": "State of Rhode Island, Dept of Transportation",
    "state": "RI",
    "due_date": "2026-10-23T17:00:00.000Z",
    "notice_type": "RIDOT Construction Bid",
    "solicitation_number": "TCB27006870",
    "source_url": "https://webprocure.proactiscloud.com/…",
    "set_aside": null,
    "naics_code": null,
    "…": "…"
  }],
  "next_after": 1234567,
  "count": 1
}`;

function DataPage() {
  const summary = Route.useLoaderData();
  return (
    <main className="bg-white">
      <section className="bg-slate-950 px-4 py-14 text-white sm:py-20">
        <div className="mx-auto max-w-4xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">Contrax data feed</p>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-5xl">Government bid data, cleaned and ready to use</h1>
          <p className="mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">
            Open federal, state and local bids in one feed, with real deadlines and a link to every official notice. Built for
            teams that need the data, not another search screen.
          </p>
          {summary && summary.open > 0 && (
            <dl className="mt-8 grid max-w-xl grid-cols-3 gap-3">
              {[
                ["Open bids now", summary.open.toLocaleString("en-US")],
                ["States", String(summary.states)],
                ["Sources", String(summary.sources)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <dt className="text-xs text-slate-400">{k}</dt>
                  <dd className="mt-1 text-2xl font-bold">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-4 text-xs text-slate-500">Live counts. Updated every 4 hours on weekdays and daily on weekends.</p>
          <a href="#request" className="mt-8 inline-block rounded-xl bg-amber-500 px-6 py-3 font-bold text-slate-950 hover:bg-amber-400">
            Request access
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-12">
        <h2 className="text-xl font-bold text-slate-900">Who uses it</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            "Proposal writers and bid consultants who track opportunities for clients",
            "Estimators and plan rooms that need public construction work early",
            "Software platforms that want bid data inside their own product",
            "Researchers and analysts studying public procurement",
          ].map((t) => (
            <li key={t} className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">{t}</li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-12">
        <h2 className="text-xl font-bold text-slate-900">What each bid includes</h2>
        <dl className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {FIELDS.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[16rem_1fr]">
              <dt className="font-mono text-sm text-slate-900">{k}</dt>
              <dd className="text-sm text-slate-600">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-slate-500">
          Only open opportunities: award notices and empty placeholder listings are left out. Nothing is guessed. A field the
          notice doesn&rsquo;t state is null.
        </p>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-12">
        <h2 className="text-xl font-bold text-slate-900">The API</h2>
        <p className="mt-2 text-sm text-slate-600">
          One JSON endpoint, <code className="font-mono">GET /api/v1/feed</code>, with your key in an Authorization header.
        </p>
        <dl className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {PARAMS.map(([k, v]) => (
            <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[10rem_1fr]">
              <dt className="font-mono text-sm text-slate-900">{k}</dt>
              <dd className="text-sm text-slate-600">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs font-semibold text-slate-500">Example (abridged)</p>
        <pre className="mt-1 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">{EXAMPLE}</pre>
        <p className="mt-2 text-xs text-slate-500">The id shown is illustrative; the bid is a real Rhode Island DOT solicitation.</p>
      </section>

      <section id="request" className="bg-slate-50 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-xl font-bold text-slate-900">Request access</h2>
          <p className="mt-2 text-sm text-slate-600">
            Pricing depends on the states and volume you need. Tell us about your use and we&rsquo;ll reply by email with a
            quote and a sample.
          </p>
          <RequestForm />
        </div>
      </section>
    </main>
  );
}

function RequestForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/data-access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(f.entries())),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  };
  if (state === "sent") {
    return (
      <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
        Thanks, we got your request and will reply by email within one business day.
      </p>
    );
  }
  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none";
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Name
          <input name="name" required maxLength={120} className={input} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Work email
          <input name="email" type="email" required maxLength={200} className={input} />
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-700">
        Company
        <input name="company" required maxLength={160} className={input} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        What you&rsquo;ll use it for
        <select name="useCase" className={input} defaultValue="">
          <option value="" disabled>
            Choose one
          </option>
          {DATA_REQUEST_USE_CASES.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-700">
        States you need <span className="font-normal text-slate-400">(or &ldquo;all&rdquo;)</span>
        <input name="states" maxLength={300} className={input} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Anything else <span className="font-normal text-slate-400">(optional)</span>
        <textarea name="message" rows={3} maxLength={2000} className={input} />
      </label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      {state === "error" && <p className="text-sm text-rose-700">{error}</p>}
      <button
        type="submit"
        disabled={state === "sending"}
        className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Request access"}
      </button>
    </form>
  );
}
