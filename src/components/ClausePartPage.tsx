import type { PartPageData, RelatedPart } from "~/lib/far-parts";
import { partLabel, partName, subpartOfClause } from "~/lib/far-parts";
import { ClauseCtaCard } from "~/components/ClauseCtaCard";

/**
 * Part landing page for /clauses/{part} (e.g. /clauses/52).
 *
 * Honesty rules:
 *  - Part name comes from the acquisition.gov title map (or falls back to
 *    "Part {N}"); the summary sentence only states counts + sourcing — no
 *    interpretive claims about the part's content.
 *  - Subpart headers are numeric-only ("Subpart 52.2") derived from real
 *    clause numbers; subpart titles are NOT in the DB and are never invented.
 */

function RelatedPartLinks({ related, part }: { related: RelatedPart[]; part: string }) {
  if (related.length === 0) return null;
  return (
    <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-bold text-slate-900">More parts</h2>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {related.map((r) => {
          const label = partLabel(r.part);
          const name = partName(r.part);
          const text =
            r.type === "prev"
              ? `← Previous: ${label} Part ${r.part}`
              : r.type === "next"
                ? `Next: ${label} Part ${r.part} →`
                : `${label} counterpart: Part ${r.part} (mirrors FAR Part ${Number(r.part) - 200})`;
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
  );
}

export function ClausePartPage({ data }: { data: PartPageData }) {
  const { part, count, clauses, related } = data;
  const label = data.label;
  const name = partName(part);
  const heading = `${label} Part ${part}`;
  const title = name && name !== "Reserved" ? `${heading} — ${name}` : heading;

  // Group clauses by derived subpart (numeric-only labels).
  const groups = new Map<string, string[]>();
  for (const n of clauses) {
    const sp = subpartOfClause(n);
    const list = groups.get(sp) ?? [];
    list.push(n);
    groups.set(sp, list);
  }

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
        <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
          <a href="/" className="hover:text-slate-700">Home</a>
          <span className="mx-1.5">/</span>
          <a href="/clauses" className="hover:text-slate-700">Clause Library</a>
          <span className="mx-1.5">/</span>
          <span className="font-medium text-slate-800">Part {part}</span>
        </nav>
        <h1 className="mt-4 text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {count.toLocaleString()} {count === 1 ? "clause" : "clauses"} · {label} · Source:
          acquisition.gov — {label}
        </p>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-700">
          {label} Part {part}
          {name && name !== "Reserved" ? ` (${name})` : ""} contains {count.toLocaleString()}{" "}
          {count === 1 ? "provision or clause" : "provisions and clauses"} that appear in
          federal solicitations and contracts. Every clause below links to its full, exact
          regulatory text — sourced from acquisition.gov and free to read.
        </p>
        <div className="mt-8 space-y-6">
          {[...groups.entries()].map(([sp, list]) => (
            <section key={sp} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-bold text-slate-900">
                Subpart {sp}
                <span className="ml-2 text-sm font-medium text-slate-500">
                  {list.length.toLocaleString()} {list.length === 1 ? "clause" : "clauses"}
                </span>
              </h2>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                {list.map((n) => (
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
        <RelatedPartLinks related={related} part={part} />
        <ClauseCtaCard />
      </main>
    </div>
  );
}
