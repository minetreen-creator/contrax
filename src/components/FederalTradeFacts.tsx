/**
 * Federal spending and contracts ending soon for one trade in one state
 * (owner 2026-10-13). Shown on /contracts-in/{state}/{trade}. Every figure is
 * a stored USAspending.gov record synced by src/jobs/federal-trade-sync.ts; a
 * part with no data is left out, never filled with an example.
 */
import {
  awardUrl,
  FEDERAL_TRADE_NAICS,
  fiscalYearLabel,
  formatDollars,
  recompetesHref,
  setAsideShare,
  type Recompete,
  type TradeSpending,
} from "~/lib/federal-trade-data";

export interface FederalTradeFactsData {
  spending: TradeSpending | null;
  ending: { count: number; total: number; rows: Recompete[] };
}

export function fmtEndDate(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function RecompeteRow({ c }: { c: Recompete }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-slate-900">{c.recipient_name}</p>
        <p className="text-sm font-semibold text-amber-700">Ends {fmtEndDate(c.end_date)}</p>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        {[c.sub_agency || c.agency, formatDollars(c.amount), c.naics_code].filter(Boolean).join(" · ")}
      </p>
      {c.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{c.description}</p>}
      <a href={awardUrl(c.award_key)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-blue-700 hover:underline">
        View contract {c.award_id} on USAspending.gov
      </a>
    </li>
  );
}

export function FederalTradeFacts({
  data,
  tradeSlug,
  tradeLabel,
  stateCode,
  stateName,
}: {
  data: FederalTradeFactsData | null;
  tradeSlug: string;
  tradeLabel: string;
  stateCode: string;
  stateName: string;
}) {
  if (!data) return null;
  const { spending, ending } = data;
  const share = spending ? setAsideShare(spending) : null;
  const lower = tradeLabel.toLowerCase();
  if (!spending && ending.count === 0) return null;
  return (
    <section className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-6">
      {spending && spending.total_amount > 0 && (
        <div>
          <h2 className="text-xl font-bold text-slate-900">Federal {lower} spending in {stateName}</h2>
          <p className="mt-2 text-slate-700">
            From {fiscalYearLabel(spending.fiscal_year)} (fiscal year {spending.fiscal_year}), federal agencies obligated{" "}
            <strong>{formatDollars(spending.total_amount)}</strong> on {lower} contracts performed in {stateName}.
            {share != null && (
              <>
                {" "}
                <strong>{formatDollars(spending.set_aside_amount)} ({share}%)</strong> went through small-business set-asides.
              </>
            )}
          </p>
          {spending.top_agencies.length > 0 && (
            <p className="mt-2 text-sm text-slate-600">
              Top buyers: {spending.top_agencies.map((a) => `${a.name} (${formatDollars(a.amount)})`).join(", ")}.
            </p>
          )}
        </div>
      )}
      {ending.count > 0 && (
        <div className={spending ? "mt-8" : ""}>
          <h2 className="text-xl font-bold text-slate-900">
            {ending.count.toLocaleString("en-US")} federal {lower} contract{ending.count === 1 ? "" : "s"} in {stateName} end in the next 12 months
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Worth {formatDollars(ending.total)} together. An expiring contract is often rebid, so these are the ones to prepare for now. Soonest first.
          </p>
          <ul className="mt-4 grid gap-3">
            {ending.rows.map((c) => (
              <RecompeteRow key={c.award_key} c={c} />
            ))}
          </ul>
          <a href={recompetesHref(tradeSlug, stateCode, 12)} className="mt-4 inline-block rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-700">
            See all contracts ending soon →
          </a>
        </div>
      )}
      <p className="mt-6 text-xs text-slate-500">
        Source: USAspending.gov contract records for NAICS {(FEDERAL_TRADE_NAICS[tradeSlug] ?? []).join(", ")}, by place of performance.
        Amounts are net obligations. End dates are the current end date on file; an agency can extend a contract, exercise
        options or choose not to rebid, so an end date does not promise a new solicitation.
      </p>
    </section>
  );
}
