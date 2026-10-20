import { useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  MapPin,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import type { County, LocalAwardsResult } from "~/lib/local-awards/model";
import { STATE_NAMES } from "~/lib/contract-map";
import { useCountUp } from "~/components/WinCalculator";
import { BidAlertCapture } from "~/components/BidAlertCapture";
import { trackEvent } from "~/lib/track";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
const select =
  "mt-1 min-w-0 max-w-full rounded-xl border border-white/25 bg-[#172e52] px-3 py-3 text-white focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-50";
export function LocalAwards() {
  const [counties, setCounties] = useState<County[]>([]);
  const [state, setState] = useState("VA");
  const [county, setCounty] = useState("51570");
  const [naics, setNaics] = useState("");
  const [result, setResult] = useState<LocalAwardsResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState<"awards" | "recipients" | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/county-locations", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setCounties)
      .catch(() => {
        if (!controller.signal.aborted)
          setError("The county list is unavailable. Please try again shortly.");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!county) {
      setResult(null);
      setStatus("idle");
      setError("");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    setError("");
    setResult(null);
    setDetail(null);
    fetch(
      `/api/local-awards?county=${encodeURIComponent(county)}${naics ? `&naics=${encodeURIComponent(naics)}` : ""}`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Figures unavailable.");
        return body as LocalAwardsResult;
      })
      .then((data) => {
        setResult(data);
        setStatus("idle");
        trackEvent("local_awards_view", `${county}:${naics || "all"}`);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [county, naics, attempt]);
  const animatedTotal = useCountUp(result?.totalCents ?? 0);
  const animatedRecipients = useCountUp(result?.recipientCount ?? 0);
  const animatedLargest = useCountUp(result?.awards[0]?.cents ?? 0);
  const area = counties.find((c) => c.fips === county);
  const states = [...new Set(counties.map((c) => c.state))].sort((a, b) =>
    (STATE_NAMES[a] || a).localeCompare(STATE_NAMES[b] || b),
  );
  const maxIndustry = Math.max(
    1,
    ...(result?.industries.map((i) => Math.abs(i.cents)) || []),
  );
  const pickIndustry = (code: string) => {
    if (/^\d{6}$/.test(code)) {
      setNaics(code);
      setAttempt((n) => n + 1);
    }
  };
  return (
    <section
      aria-labelledby="local-awards-title"
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#14213d] via-[#1f3a6b] to-[#0b1f45] p-6 text-white shadow-xl sm:p-10"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue-400/20 blur-3xl"
      />
      <p className="relative flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-blue-200">
        <MapPin size={15} /> Explore actual federal awards
      </p>
      <h2
        id="local-awards-title"
        className="relative mt-3 text-3xl font-extrabold sm:text-4xl"
      >
        What federal work happens here?
      </h2>
      <p className="relative mt-3 max-w-2xl leading-relaxed text-slate-200">
        See who received federal contract obligations for work performed in your
        chosen county or independent city. Recipients may be based elsewhere.
      </p>
      <div className="relative mt-7 grid gap-4 sm:grid-cols-[.6fr_1fr]">
        <label className="flex min-w-0 flex-col text-sm font-semibold">
          State
          <select
            className={select}
            aria-label="State"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setCounty("");
              setNaics("");
              setResult(null);
              setError("");
              setStatus("idle");
            }}
          >
            {!states.length && <option value="VA">Virginia</option>}
            {states.map((s) => (
              <option key={s} value={s}>
                {STATE_NAMES[s] || s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col text-sm font-semibold">
          County or independent city
          <select
            className={select}
            aria-label="County or independent city"
            value={county}
            disabled={!counties.length}
            onChange={(e) => {
              setCounty(e.target.value);
              setNaics("");
            }}
          >
            <option value="">Choose a place</option>
            {counties
              .filter((c) => c.state === state)
              .map((c) => (
                <option key={c.fips} value={c.fips}>
                  {c.name}, {c.state}
                </option>
              ))}
          </select>
        </label>
      </div>
      {area && (
        <p className="relative mt-4 text-sm text-blue-100">
          Showing federal work performed in{" "}
          <b>
            {area.name}, {area.state}
          </b>{" "}
          · County FIPS {area.fips.slice(0, 2)}-{area.fips.slice(2)}
        </p>
      )}
      {status === "loading" && (
        <p
          role="status"
          className="relative mt-8 flex items-center gap-3 text-slate-200"
        >
          <RefreshCw
            size={19}
            className="animate-spin motion-reduce:animate-none"
          />
          Checking the complete spending records. Larger areas can take longer.
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="relative mt-6 rounded-xl border border-amber-200/30 bg-amber-200/10 p-4"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="mt-3 font-semibold text-amber-200 underline"
          >
            Try again
          </button>
        </div>
      )}
      {result && status === "idle" && (
        <div className="relative mt-7" aria-live="polite">
          <label className="flex max-w-xl flex-col text-sm font-semibold">
            Industry
            <select
              className={select}
              aria-label="Industry"
              value={naics}
              onChange={(e) => setNaics(e.target.value)}
            >
              <option value="">All industries</option>
              {result.choices
                .filter((i) => /^\d{6}$/.test(i.code))
                .map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.name} · {i.code}
                  </option>
                ))}
            </select>
          </label>
          <p className="mt-4 text-sm text-slate-300">
            {result.start} through {result.end} · Refreshed{" "}
            {new Date(result.fetchedAt).toLocaleString("en-US", {
              timeZone: "America/New_York",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            ET
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <button
              type="button"
              onClick={() => setDetail(detail === "awards" ? null : "awards")}
              className="rounded-2xl border border-amber-200/30 bg-amber-200/10 p-5 text-left hover:bg-amber-200/15"
            >
              <TrendingUp size={20} className="text-amber-200" />
              <span className="mt-4 block text-sm text-slate-200">
                Net federal contract obligations
              </span>
              <strong
                aria-label={money(result.totalCents)}
                aria-live="off"
                className="mt-2 block font-[Georgia,serif] text-3xl tabular-nums text-amber-200"
              >
                {money(animatedTotal)}
              </strong>
              <span className="mt-3 block text-xs text-slate-300">
                In this 12-month window · explore awards →
              </span>
            </button>
            <button
              type="button"
              onClick={() =>
                setDetail(detail === "recipients" ? null : "recipients")
              }
              className="rounded-2xl border border-white/15 bg-white/5 p-5 text-left hover:bg-white/10"
            >
              <Building2 size={20} className="text-blue-200" />
              <span className="mt-4 block text-sm text-slate-200">
                Distinct recipients with reported UEIs
              </span>
              <strong
                aria-label={String(result.recipientCount)}
                aria-live="off"
                className="mt-2 block font-[Georgia,serif] text-3xl tabular-nums"
              >
                {animatedRecipients.toLocaleString()}
              </strong>
              <span className="mt-3 block text-xs text-slate-300">
                Names deduplicated by UEI · explore recipients →
              </span>
            </button>
            <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
              <p className="text-sm text-slate-200">
                Largest award by net obligations in this window
              </p>
              {result.awards[0] ? (
                <>
                  <p className="mt-3 font-[Georgia,serif] text-3xl font-bold tabular-nums text-emerald-200">
                    {money(animatedLargest)}
                  </p>
                  <p className="mt-3 text-sm text-slate-200">
                    {result.awards[0].recipient}
                  </p>
                  <a
                    href={result.awards[0].href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-block text-sm font-semibold text-blue-200 underline"
                  >
                    View source award →
                  </a>
                </>
              ) : (
                <p className="mt-4 text-slate-300">
                  No contract actions reported in this window.
                </p>
              )}
            </div>
          </div>
          {detail && (
            <div className="mt-5 overflow-x-auto rounded-2xl border border-white/15 bg-black/10 p-5">
              <h3 className="font-bold">
                {detail === "awards"
                  ? "Top awards by net obligations in this window"
                  : "Recipients by net obligations in this window"}
              </h3>
              <p className="mt-2 text-xs text-slate-300">
                {detail === "awards"
                  ? "Up to 20 awards shown. Amounts include all positive and negative actions in this area and date window."
                  : "Up to 50 recipients shown. Counts use all reported UEIs, including recipients with zero or negative net obligations."}
              </p>
              <ul className="mt-4 divide-y divide-white/10">
                {detail === "awards"
                  ? result.awards.map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap justify-between gap-3 py-3 text-sm"
                      >
                        <div>
                          <a
                            href={a.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-blue-200 underline"
                          >
                            {a.awardId} →
                          </a>
                          <p className="mt-1 text-slate-300">{a.recipient}</p>
                        </div>
                        <b>{money(a.cents)}</b>
                      </li>
                    ))
                  : result.recipients.map((r) => (
                      <li
                        key={r.uei}
                        className="flex flex-wrap justify-between gap-3 py-3 text-sm"
                      >
                        <span>
                          {r.name}
                          <span className="mt-1 block text-xs text-slate-400">
                            UEI {r.uei}
                          </span>
                        </span>
                        <b>{money(r.cents)}</b>
                      </li>
                    ))}
              </ul>
            </div>
          )}
          <div className="mt-7 rounded-2xl border border-white/15 bg-white/5 p-5">
            <h3 className="font-bold">Leading industries by net obligations</h3>
            <p className="mt-1 text-xs text-slate-300">
              Select an industry to explore its awards.
            </p>
            <div className="mt-5 space-y-4">
              {result.industries.map((i) => (
                <button
                  key={i.code}
                  type="button"
                  onClick={() => pickIndustry(i.code)}
                  disabled={i.code === "unreported"}
                  className="block w-full text-left disabled:cursor-default"
                >
                  <span className="flex justify-between gap-4 text-sm">
                    <span className="max-w-[75%] break-words text-slate-200">
                      {i.name}
                    </span>
                    <b className="shrink-0">{money(i.cents)}</b>
                  </span>
                  <span className="mt-2 block h-2 overflow-hidden rounded-full bg-white/10">
                    <span
                      className={`block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${i.cents < 0 ? "bg-rose-300" : "bg-blue-300"}`}
                      style={{
                        width: `${Math.max(1, (Math.abs(i.cents) / maxIndustry) * 100)}%`,
                      }}
                    />
                  </span>
                </button>
              ))}
            </div>
            {!result.industries.length && (
              <p className="mt-3 text-sm text-slate-300">
                No industry figures reported for this selection.
              </p>
            )}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href={`/radar?${new URLSearchParams({ state: result.county.state, ...(naics ? { trade: naics } : {}) })}`}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-300 px-5 py-3 font-bold text-slate-950 hover:bg-amber-200"
            >
              Find open opportunities
              {naics ? " in this industry" : " in this state"}
              <ArrowRight size={16} />
            </a>
            {naics && (
              <a
                href="#local-awards-alerts"
                className="rounded-xl border border-white/30 px-5 py-3 font-semibold"
              >
                Get matching bid alerts
              </a>
            )}
          </div>
          {naics && (
            <div id="local-awards-alerts">
              <p className="mt-5 text-xs text-slate-300">
                Alerts match this industry and state, rather than being limited
                to this county.
              </p>
              <BidAlertCapture
                naicsCode={naics}
                stateCode={result.county.state}
              />
            </div>
          )}
          <details className="mt-6 text-xs leading-relaxed text-slate-300">
            <summary className="cursor-pointer font-semibold text-blue-200">
              Sources and how these figures are calculated
            </summary>
            <p className="mt-3">
              Net obligations are commitments, not revenue, payments received or
              money available to bid on. Negative actions (de-obligations) are
              included. Contract types A, B, C and D only; IDV parent vehicles
              are excluded. Missing UEIs are excluded from the recipient count (
              {result.missingUeiActions} actions in this selection).{" "}
              {result.negativeActions} negative actions are included.
            </p>
            <p className="mt-3">
              County names and FIPS are from the Census Bureau’s 2025 Gazetteer.
              Spending uses county-level place of performance, not recipient
              headquarters. Defense awards appear after about 90 days, so recent
              figures are incomplete. All amounts are rounded for display;
              calculations retain cents.
            </p>
            <p className="mt-3">
              <a
                href="https://www.usaspending.gov/search"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Compare in USAspending Advanced Search
              </a>
              : contracts only; {result.start}–{result.end}; place of
              performance {result.county.name}, {result.county.state}; county
              FIPS {result.county.fips};{" "}
              {naics ? `NAICS ${naics}` : "all industries"}. Each award above
              links to its original record, whose lifetime total can differ from
              our windowed amount.
            </p>
          </details>
          <p className="mt-5 text-xs text-slate-400">
            Source: USAspending.gov · Work performed here, not necessarily local
            businesses · Defense reporting lags about 90 days.
          </p>
        </div>
      )}
    </section>
  );
}
