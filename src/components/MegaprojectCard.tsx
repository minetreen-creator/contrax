import { MEGA_SECTORS, megaMoney, megaprojectHref, type Megaproject } from "~/lib/megaprojects";
import { STATE_CODE_TO_NAME } from "~/lib/location-state";
import { trackEvent } from "~/lib/track";

/** One megaproject: sourced facts and how to get on the sub list. Used by the list, state and project pages. */
export function checkedLabel(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function MegaprojectCard({ p, linkTitle = true }: { p: Megaproject; linkTitle?: boolean }) {
  const sector = MEGA_SECTORS[p.sector];
  const money = megaMoney(p.amount);
  return (
    <li id={p.slug} className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
        {sector.icon} {sector.label} · {p.city}, {STATE_CODE_TO_NAME[p.state] ?? p.state}
      </p>
      <p className="mt-1 text-xl font-extrabold text-slate-900">
        {linkTitle ? (
          <a href={megaprojectHref(p)} className="hover:text-blue-800 hover:underline">
            {p.company}: {p.project}
          </a>
        ) : (
          <>
            {p.company}: {p.project}
          </>
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {money ? (
          <span className="font-bold text-emerald-700">
            💰 {money}
            {p.amountNote ? <span className="font-normal text-slate-500"> ({p.amountNote})</span> : null}
          </span>
        ) : null}
        {p.jobs ? (
          <span className="font-bold text-blue-800">
            👷 {p.jobs.toLocaleString("en-US")} jobs
            {p.jobsNote ? <span className="font-normal text-slate-500"> ({p.jobsNote})</span> : null}
          </span>
        ) : null}
        <span className="text-slate-600">🏗️ {p.status}</span>
      </div>
      <p className="mt-3 text-slate-700">{p.summary}</p>
      <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-slate-800">
        <p className="font-bold">How to get on the sub list</p>
        <p className="mt-1">
          {p.generalContractor ? (
            <>
              Built by{" "}
              {p.generalContractor.url ? (
                <a href={p.generalContractor.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">
                  {p.generalContractor.name}
                </a>
              ) : (
                <b>{p.generalContractor.name}</b>
              )}
              . Register with them as a subcontractor.{" "}
            </>
          ) : (
            <>The general contractor hasn&apos;t been announced publicly; watch local news and county permits. </>
          )}
          {p.supplierUrl ? (
            <a href={p.supplierUrl.url} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("megaprojects_supplier_click", p.slug)} className="font-semibold text-blue-700 underline">
              {p.supplierUrl.label} →
            </a>
          ) : null}
        </p>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Source:{" "}
        <a href={p.source.url} target="_blank" rel="noopener noreferrer" className="underline">
          {p.source.name}
        </a>{" "}
        · checked {checkedLabel(p.checked)}
      </p>
    </li>
  );
}
