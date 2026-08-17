import { createFileRoute } from "@tanstack/react-router";
import { trackEvent } from "~/lib/track";
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import { ClauseCtaCard } from "~/components/ClauseCtaCard";
import { ClausePartPage } from "~/components/ClausePartPage";
import { buildClauseMetaDescription } from "~/lib/clause-meta";
import {
  getPartPageData,
  partLabel,
  partName,
  relatedParts,
  type PartPageData,
  type RelatedPart,
} from "~/lib/far-parts";

const PROD_URL = "https://www.contrax.company";
// FAR/DFARS clause numbers: 1–3 digit part, 3–4 digit section, optional -NNNN
// suffix (e.g. 52.212-4, 2.101, 252.204-7012). Verified against all 4,630
// distinct clause_number values in the production far_clauses table.
const CLAUSE_NUMBER_RE = /^\d{1,3}\.\d{3,4}(?:-\d{1,4})?$/;
// Part-page discriminant: a pure 1–3 digit integer is a part number
// (e.g. /clauses/52, /clauses/252). Clause numbers always contain a dot, so
// there is no ambiguity between the two routes.
const PART_RE = /^\d{1,3}$/;

interface ClauseData {
  clause_number: string;
  title: string;
  full_text: string;
  source: string;
  part: string | null;
}
interface ClausePageData {
  kind: "clause";
  notFound: boolean;
  clause: ClauseData | null;
  requested: string;
  prev: string | null;
  next: string | null;
  related: RelatedPart[];
}
type RouteData = ClausePageData | PartPageData;

// Server function (never client code): validates the format, then looks up the
// clause by exact clause_number. A malformed number OR a well-formed number
// that isn't in far_clauses both resolve to notFound:true → the clean
// "Clause not found" page below. Also loads prev/next clause within the part
// and related parts for the footer nav (one extra indexed query set).
const getClauseByNumber = createServerFn({ method: "GET" }).handler(
  async ({ data }: { data: string }): Promise<ClausePageData> => {
    const requested = data.trim();
    if (!CLAUSE_NUMBER_RE.test(requested)) {
      return { kind: "clause", notFound: true, clause: null, requested, prev: null, next: null, related: [] };
    }
    const db = sql();
    const rows = await db`SELECT clause_number, title, full_text, source, part FROM far_clauses WHERE clause_number = ${requested} LIMIT 1`;
    if (!rows.length) {
      return { kind: "clause", notFound: true, clause: null, requested, prev: null, next: null, related: [] };
    }
    const r = rows[0] as any;
    const clause: ClauseData = {
      clause_number: String(r.clause_number),
      title: String(r.title),
      full_text: String(r.full_text),
      source: String(r.source || "far"),
      part: r.part != null ? String(r.part) : null,
    };
    // Prev/next within the same part + related parts (DB-gated).
    let prev: string | null = null;
    let next: string | null = null;
    let related: RelatedPart[] = [];
    try {
      const [partRows, partDistinct] = await Promise.all([
        clause.part
          ? db`SELECT clause_number FROM far_clauses WHERE part = ${clause.part} ORDER BY clause_number`
          : Promise.resolve([] as { clause_number: string }[]),
        db`SELECT DISTINCT part FROM far_clauses WHERE part IS NOT NULL`,
      ]);
      const numbers = (partRows as { clause_number: string }[]).map((x) => String(x.clause_number));
      const idx = numbers.indexOf(clause.clause_number);
      if (idx > 0) prev = numbers[idx - 1];
      if (idx >= 0 && idx < numbers.length - 1) next = numbers[idx + 1];
      if (clause.part) {
        const existingParts = new Set((partDistinct as { part: string | null }[]).map((x) => String(x.part)));
        related = relatedParts(clause.part, existingParts);
      }
    } catch (err) {
      // Prev/next and related are enhancement nav — never break the clause page.
      console.error("[clauses] prev/next lookup failed:", err);
    }
    return { kind: "clause", notFound: false, clause, requested, prev, next, related };
  },
);

export const Route = createFileRoute("/clauses/$clauseNumber")({
  loader: ({ params }) =>
    PART_RE.test(params.clauseNumber)
      ? getPartPageData({ data: params.clauseNumber })
      : getClauseByNumber({ data: params.clauseNumber }),
  head: ({ loaderData }) => {
    // head() runs pre-hydration where loaderData can be undefined — fall back
    // to a generic library head so the shell always renders (index pattern).
    const d = loaderData as RouteData | undefined;
    if (!d) {
      const fallbackTitle = "FAR & DFARS Clause Library | Contrax";
      return {
        meta: [
          { title: fallbackTitle },
          { name: "description", content: "Browse real FAR and DFARS clauses — exact regulatory text sourced from acquisition.gov, free." },
          { name: "robots", content: "index, follow" },
        ],
        links: [{ rel: "canonical", href: `${PROD_URL}/clauses` }],
      };
    }
    if (d.kind === "part") {
      const label = d.label;
      const name = d.name && d.name !== "Reserved" ? d.name : null;
      const heading = `${label} Part ${d.part}`;
      const title = name ? `${heading} — ${name} | Contrax` : `${heading} | Contrax`;
      const description = d.notFound
        ? "The requested FAR or DFARS part could not be found."
        : d.failed
          ? `Browse ${label} Part ${d.part} — exact regulatory text sourced from acquisition.gov, free.`
          : `${heading}${name ? ` — ${name}` : ""} — ${d.count.toLocaleString()} clauses with the exact regulatory text from acquisition.gov, free.`;
      const url = `${PROD_URL}/clauses/${d.part}`;
      return {
        meta: [
          { title },
          { name: "description", content: description },
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
    }
    // Clause branch — plain-English meta description generated at SSR time
    // from the loaded clause (rule-based, see src/lib/clause-meta.ts).
    const clauseNumber = d.clause?.clause_number ?? d.requested;
    const sourceLabel = d.clause?.source === "dfars" ? "DFARS" : "FAR";
    const title = d.notFound
      ? "Clause Not Found | Contrax"
      : `${sourceLabel} ${clauseNumber} — ${d.clause!.title} | Contrax`;
    const description = d.notFound
      ? "The requested FAR or DFARS clause could not be found."
      : buildClauseMetaDescription({
          clause_number: d.clause!.clause_number,
          title: d.clause!.title,
          part: d.clause!.part,
          source: d.clause!.source,
          full_text: d.clause!.full_text,
        });
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
  component: ClauseOrPartPage,
});

function ClauseOrPartPage() {
  const d = Route.useLoaderData();
  if (d.kind === "part") {
    return <ClausePartPage data={d} />;
  }
  return <ClausePageInner d={d} />;
}

function ClausePageInner({ d }: { d: ClausePageData }) {
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
  const part = clause.part;
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
        <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
          <a href="/" className="hover:text-slate-700">Home</a>
          <span className="mx-1.5">/</span>
          <a href="/clauses" className="hover:text-slate-700">Clause Library</a>
          {part ? (
            <>
              <span className="mx-1.5">/</span>
              <a href={`/clauses/${part}`} className="hover:text-slate-700">
                Part {part}
              </a>
            </>
          ) : null}
          <span className="mx-1.5">/</span>
          <span className="font-medium text-slate-800">{clause.clause_number}</span>
        </nav>
        <h1 className="mt-4 text-2xl font-bold text-slate-900 sm:text-3xl">{sourceLabel} {clause.clause_number}</h1>
        <p className="mt-2 text-lg font-medium text-slate-700">{clause.title}</p>
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{clause.full_text}</p>
        </div>
        <p className="mt-4 text-xs text-slate-400">Source: acquisition.gov — {sourceLabel}</p>
        {(d.prev || d.next) && (
          <div className="mt-6 flex items-center justify-between gap-3 text-sm">
            {d.prev ? (
              <a href={`/clauses/${d.prev}`} className="font-medium text-blue-600 hover:text-blue-700 hover:underline">
                &larr; {d.prev}
              </a>
            ) : (
              <span />
            )}
            {d.next ? (
              <a href={`/clauses/${d.next}`} className="font-medium text-blue-600 hover:text-blue-700 hover:underline">
                {d.next} &rarr;
              </a>
            ) : (
              <span />
            )}
          </div>
        )}
        {d.related.length > 0 && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">More parts</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              {d.related.map((r) => {
                const name = partName(r.part);
                const text =
                  r.type === "prev"
                    ? `Previous part: ${partLabel(r.part)} ${r.part}`
                    : r.type === "next"
                      ? `Next part: ${partLabel(r.part)} ${r.part}`
                      : `${partLabel(r.part)} counterpart: ${r.part}`;
                return (
                  <a
                    key={`${r.type}-${r.part}`}
                    href={`/clauses/${r.part}`}
                    className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    {text}
                    {name && name !== "Reserved" ? (
                      <span className="text-slate-500"> — {name}</span>
                    ) : null}
                  </a>
                );
              })}
            </div>
          </div>
        )}
        <ClauseCtaCard />
      </main>
    </div>
  );
}
