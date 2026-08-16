import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
const PROD_URL = "https://www.contrax.company";

// Public, indexable library index for the FAR/DFARS clause corpus (4,630 real
// clauses in production). Crawl hub: every clause page is linked from here in
// ≤1 click. Data comes from far_clauses at SSR time — no client-side fetching,
// no fabricated numbers. If the query fails, the page still renders with
// honest generic copy ("thousands of real clauses") rather than a 500.
interface ClausePartGroup {
  part: string; // e.g. "52", "252"
  label: string; // "FAR" | "DFARS"
  count: number;
  clauses: string[];
}
interface ClauseLibraryData {
  ok: boolean;
  total: number | null;
  parts: ClausePartGroup[];
}

const getClauseLibrary = createServerFn({ method: "GET" }).handler(
  async (): Promise<ClauseLibraryData> => {
    try {
      const db = sql();
      const [countRows, rows] = await Promise.all([
        db`SELECT COUNT(*)::int AS count FROM far_clauses`,
        db`SELECT clause_number, part, source FROM far_clauses`,
      ]);
      const total = Number((countRows[0] as any)?.count || 0);
      if (total <= 0) return { ok: true, total: null, parts: [] };
      const byPart = new Map<string, { clauses: string[]; source: string }>();
      for (const r of rows as { clause_number: string; part: string | null; source: string | null }[]) {
        const key = r.part?.trim() || "misc";
        const entry = byPart.get(key) ?? { clauses: [], source: r.source ?? "" };
        entry.clauses.push(r.clause_number);
        if (!entry.source) entry.source = r.source ?? "";
        byPart.set(key, entry);
      }
      const parts = [...byPart.entries()]
        .map(([part, { clauses, source }]) => ({
          part,
          label: source === "dfars" ? "DFARS" : Number(part) >= 200 ? "DFARS" : "FAR",
          count: clauses.length,
          clauses: clauses.sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
        }))
        .sort((a, b) => {
          const na = Number(a.part);
          const nb = Number(b.part);
          const aNum = Number.isFinite(na);
          const bNum = Number.isFinite(nb);
          if (aNum && bNum) return na - nb;
          if (aNum !== bNum) return aNum ? -1 : 1;
          return a.part.localeCompare(b.part);
        });
      return { ok: true, total, parts };
    } catch (err) {
      console.error("[clauses] failed to load clause library:", err);
      return { ok: false, total: null, parts: [] };
    }
  },
);

export const Route = createFileRoute("/clauses/")({
  loader: (): Promise<ClauseLibraryData> => getClauseLibrary(),
  head: ({ loaderData }) => {
    // loaderData can be undefined pre-hydration in this repo's TanStack typing;
    // fall back to the empty shape so the head still renders.
    const d = loaderData ?? { ok: false, total: null, parts: [] };
    const total = d.total && d.total > 0 ? d.total : null;
    const countText = total ? `${total.toLocaleString()} Real Clauses` : "Real Clauses";
    const title = `FAR & DFARS Clause Library — ${countText} | Contrax`;
    const description = total
      ? `Browse all ${total.toLocaleString()} real FAR and DFARS clauses — exact regulatory text sourced from acquisition.gov, free.`
      : "Browse thousands of real FAR and DFARS clauses — exact regulatory text sourced from acquisition.gov, free.";
    const url = `${PROD_URL}/clauses`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        // Public-domain regulatory text + genuinely useful content — indexable.
        { name: "robots", content: "index, follow" },
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
  component: ClausesIndexPage,
});

function ClausesIndexPage() {
  const d = Route.useLoaderData();
  const total = d.total && d.total > 0 ? d.total : null;
  const headingCount = total ? `${total.toLocaleString()}` : "thousands of";
  const bodyCount = total ? `All ${total.toLocaleString()} clauses on this page are real` : "Every clause on this page is real";
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
      <main className="mx-auto max-w-4xl px-4 py-10">
        <a href="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          &larr; Back to Contrax
        </a>
        <h1 className="mt-4 text-2xl font-bold text-slate-900 sm:text-3xl">
          FAR &amp; DFARS Clause Library
        </h1>
        <p className="mt-2 text-base text-slate-600">
          {headingCount} real FAR and DFARS clauses, grouped by part. Every clause links to its
          full regulatory text — sourced from acquisition.gov, which publishes the Federal
          Acquisition Regulation and the Defense Federal Acquisition Regulation Supplement as
          public domain. No summaries, no paywall: just the exact language that governs federal
          contracts.
        </p>
        <p className="mt-3 text-sm text-slate-500">
          {bodyCount} FAR/DFARS text drawn straight from acquisition.gov — the same text the
          government itself publishes. Use it to check what a solicitation&apos;s clauses actually
          require before you write a proposal.
        </p>
        {d.parts.length > 0 ? (
          <>
            <nav aria-label="Parts" className="mt-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Jump to part</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
                {d.parts.map((p: ClausePartGroup) => (
                  <a
                    key={p.part}
                    href={`#part-${p.part}`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    {p.part}
                  </a>
                ))}
              </div>
            </nav>
            <div className="mt-8 space-y-8">
              {d.parts.map((p: ClausePartGroup) => (
                <section key={p.part} id={`part-${p.part}`} className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="flex flex-wrap items-baseline gap-x-2 text-lg font-bold text-slate-900">
                    Part {p.part}
                    <span className="text-sm font-medium text-slate-500">
                      {p.label} &middot; {p.count.toLocaleString()} {p.count === 1 ? "clause" : "clauses"}
                    </span>
                  </h2>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                    {p.clauses.map((n: string) => (
                      <a
                        key={n}
                        href={`/clauses/${n}`}
                        className="font-mono text-sm text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        {n}
                      </a>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-8 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            {total === null
              ? "The clause library is temporarily unavailable — please check back shortly."
              : "The clause library has no entries yet."}
          </p>
        )}
      </main>
    </div>
  );
}
