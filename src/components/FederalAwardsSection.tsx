import { US_STATES } from "~/lib/states";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";
import { trackEvent } from "~/lib/track";
import { awardMoney, type FederalAwardsData } from "~/lib/federal-awards-view";

/**
 * /awards: real federal contract awards, who won and for how much (owner 2026-11-08). The
 * summary, top agencies and top winners are open to everyone; the itemized list shows a short
 * sample to free viewers and the full newest list to members (the server only sends the sample).
 */
const day = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

export function FederalAwardsSection({ data }: { data: FederalAwardsData }) {
  const s = data.summary;
  const scope = [data.q ? `"${data.q}"` : "", data.state].filter(Boolean).join(" in ");
  const range = s.p25 != null && s.p75 != null ? `${awardMoney(s.p25)} – ${awardMoney(s.p75)}` : "—";
  const more = Math.min(s.count, data.memberLimit) - data.awards.length;
  return (
    <section className="mb-12">
      <h1 className="text-3xl font-bold text-slate-900">Federal contract awards: who won, for how much</h1>
      <p className="mt-2 text-lg text-slate-500">
        Real federal contracts from USAspending.gov. Use them to price your bid, size up the competition and find the agencies that buy what you do.
      </p>

      <form method="get" action="/awards" className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={() => trackEvent("awards_federal_search", data.state || "all", "/awards")}>
        <label htmlFor="fed-award-q" className="sr-only">
          Search federal awards
        </label>
        <input
          id="fed-award-q"
          name="search"
          defaultValue={data.q}
          placeholder="e.g. janitorial, HVAC, roofing, or a company name"
          className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <select
          name="state"
          defaultValue={data.state}
          aria-label="Place of performance state"
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
        >
          <option value="">All states</option>
          {US_STATES.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-xl bg-amber-400 px-6 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-300">
          Search awards
        </button>
      </form>

      {data.error ? (
        <p className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Award data isn&apos;t available right now. Please try again in a minute.</p>
      ) : s.count === 0 ? (
        <p className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          No federal awards match {scope || "that search"}. Try a broader word, like &quot;cleaning&quot; instead of a product name.
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat big={s.count.toLocaleString("en-US")} label={`contracts awarded${scope ? ` · ${scope}` : ""}`} />
            <Stat big={awardMoney(s.median)} label="median value" />
            <Stat big={range} label="typical range (middle half)" />
            <Stat big={awardMoney(s.total)} label="total value" />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Table title="Agencies that buy the most" rows={s.topAgencies} />
            <Table title="Top winners" rows={s.topWinners} />
          </div>

          <h2 className="mt-8 text-xl font-bold text-slate-900">Newest awards</h2>
          <ul className="mt-3 space-y-3">
            {data.awards.map((a) => (
              <li key={a.awardKey} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{a.description || a.naicsDescription || "Federal contract"}</p>
                  <p className="text-sm font-bold text-green-700">{awardMoney(a.amount)}</p>
                </div>
                <p className="mt-1 text-sm text-slate-700">
                  <b>{a.recipient}</b>
                  {a.agency ? <span className="text-slate-500"> · {a.subAgency || a.agency}</span> : null}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {a.awardId}
                  {a.naicsCode ? ` · NAICS ${a.naicsCode}${a.naicsDescription ? ` ${a.naicsDescription}` : ""}` : ""}
                  {a.state ? ` · ${a.state}` : ""} · Started {day(a.startDate)} · Ends {day(a.endDate)}
                </p>
              </li>
            ))}
          </ul>
          {!data.paid && more > 0 ? (
            <div className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-center">
              <p className="font-bold text-slate-900">
                {more.toLocaleString("en-US")} more of the newest awards{scope ? ` for ${scope}` : ""}, with winners, amounts and end dates
              </p>
              <a
                href="/upgrade?plan=starter&source=awards"
                onClick={() => trackEvent("awards_federal_unlock", data.state || "all", "/awards")}
                className="mt-3 inline-block rounded-xl bg-amber-500 px-5 py-2.5 font-bold text-slate-950 hover:bg-amber-400"
              >
                See them all: ${STARTER_FIRST_MONTH_PRICE} for 30 days
              </a>
              <p className="mt-2 text-xs text-slate-500">One time. No automatic renewal.</p>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-slate-500">
            Federal contracts in the trades Contrax tracks, from USAspending.gov. Values are the contract&apos;s award amount; each contract is counted once.
          </p>
        </>
      )}
    </section>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xl font-extrabold text-slate-900 sm:text-2xl">{big}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}

function Table({ title, rows }: { title: string; rows: { name: string; contracts: number; total: number }[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="font-bold text-slate-900">{title}</p>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="py-1 font-medium">Name</th>
            <th className="py-1 text-right font-medium">Contracts</th>
            <th className="py-1 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 6).map((r) => (
            <tr key={r.name} className="border-t border-slate-100">
              <td className="py-1.5 pr-2 text-slate-700">{r.name}</td>
              <td className="py-1.5 text-right text-slate-600">{r.contracts.toLocaleString("en-US")}</td>
              <td className="py-1.5 text-right font-semibold text-slate-900">{awardMoney(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
