import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";

const PROD_URL = "https://www.contrax.company";
// FAR/DFARS clause numbers: 1–3 digit part, 3–4 digit section, optional -NNNN
// suffix (e.g. 52.212-4, 2.101, 252.204-7012). Verified against all 4,630
// distinct clause_number values in the production far_clauses table.
const CLAUSE_NUMBER_RE = /^\d{1,3}\.\d{3,4}(?:-\d{1,4})?$/;

interface ClauseData {
  clause_number: string;
  title: string;
  full_text: string;
  source: string;
}

interface ClausePageData {
  notFound: boolean;
  clause: ClauseData | null;
  requested: string;
}

// Server function (never client code): validates the format, then looks up the
// clause by exact clause_number. A malformed number OR a well-formed number
// that isn't in far_clauses both resolve to notFound:true → the clean
// "Clause not found" page below.
const getClauseByNumber = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: string }): Promise<ClausePageData> => {
    const requested = data.trim();
    if (!CLAUSE_NUMBER_RE.test(requested)) {
      return { notFound: true, clause: null, requested };
    }
    const db = sql();
    const rows = await db`SELECT clause_number, title, full_text, source FROM far_clauses WHERE clause_number = ${requested} LIMIT 1`;
    if (!rows.length) {
      return { notFound: true, clause: null, requested };
    }
    const r = rows[0] as any;
    return {
      notFound: false,
      requested,
      clause: {
        clause_number: String(r.clause_number),
        title: String(r.title),
        full_text: String(r.full_text),
        source: String(r.source || "far"),
      },
    };
  },
);

export const Route = createFileRoute("/clauses/$clauseNumber")({
  loader: ({ params }) => getClauseByNumber({ data: params.clauseNumber }),
  head: ({ loaderData }) => {
    const d = loaderData;
    const clauseNumber = d.clause?.clause_number ?? d.requested;
    const title = d.notFound
      ? "Clause Not Found | Contrax"
      : `FAR ${clauseNumber} — ${d.clause!.title} | Contrax`;
    const description = d.notFound
      ? "The requested FAR or DFARS clause could not be found."
      : `${d.clause!.title} — full text of FAR clause ${clauseNumber}, sourced from acquisition.gov.`;
    const url = `${PROD_URL}/clauses/${d.requested}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        // FAR/DFARS text is public domain and these pages are genuinely useful
        // content — indexable, no noindex (not-found variants are noindexed).
        { name: "robots", content: d.notFound ? "noindex, nofollow" : "index, follow" },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:site_name", content: "Contrax" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: ClausePage,
});

function ClausePage() {
  const d = Route.useLoaderData();
  if (d.notFound || !d.clause) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
            <a href="/" className="inline-flex items-center gap-2">
              <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
            </a>
            <a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-700">
              Dashboard
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">404</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">Clause not found</h1>
          <p className="mx-auto mt-3 max-w-md text-slate-600">
            We couldn&apos;t find a FAR or DFARS clause matching{" "}
            <span className="font-medium text-slate-800">/clauses/{d.requested}</span>.
            Clause numbers look like <span className="font-medium">52.212-4</span> or{" "}
            <span className="font-medium">252.204-7012</span>.
          </p>
          <a
            href="/"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            &larr; Back to Contrax
          </a>
        </main>
      </div>
    );
  }
  const clause = d.clause;
  const sourceLabel = clause.source === "dfars" ? "DFARS" : "FAR";
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-700">
            Dashboard
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <a href="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          &larr; Back
        </a>
        <h1 className="mt-4 text-2xl font-bold text-slate-900 sm:text-3xl">FAR {clause.clause_number}</h1>
        <p className="mt-2 text-lg font-medium text-slate-700">{clause.title}</p>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{clause.full_text}</p>
        </div>
        <p className="mt-4 text-xs text-slate-400">Source: acquisition.gov — {sourceLabel}</p>
      </main>
    </div>
  );
}
