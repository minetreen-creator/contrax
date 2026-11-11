import type { Crumb } from "~/lib/bid-facts";

/** The trail above a bid: Contrax › Virginia contracts › Janitorial › the bid (owner 2026-11-11). */
export function BidBreadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className="mt-4 text-xs text-slate-400">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {crumbs.map((c, i) => (
          <li key={`${c.name}-${i}`} className="flex min-w-0 items-center gap-x-1.5">
            {i > 0 && <span aria-hidden="true">›</span>}
            {c.href ? (
              <a href={c.href} className="font-medium text-slate-300 hover:text-white">
                {c.name}
              </a>
            ) : (
              <span aria-current="page" className="line-clamp-1">
                {c.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The facts we hold about a bid, free for every visitor and in the page a search engine reads. */
export function BidKeyFacts({ facts }: { facts: [string, string][] }) {
  if (!facts.length) return null;
  return (
    <section aria-label="Key facts" className="mt-5 rounded-2xl border border-slate-700 bg-slate-900 px-5 py-4">
      <h2 className="text-sm font-bold text-white">Key facts</h2>
      <dl className="mt-2 divide-y divide-slate-800 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
            <dt className="shrink-0 text-slate-400 sm:w-52">{label}</dt>
            <dd className="text-slate-100">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
