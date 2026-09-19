import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  FEDERAL_GRANTS_PATH,
  STATE_GRANTS_COVERAGE_CLAIM,
  STATE_GRANTS_NOTICE,
  STATE_GRANT_MAX_CATEGORIES,
  STATE_GRANT_SEARCH_MAX_TERM,
  STATE_GRANT_STATUS_LABELS,
  STATE_GRANT_STATUS_OPTIONS,
  type StateGrantRecordView,
  type StateGrantStatus,
} from "~/lib/state-grants/search";
import {
  coverageCounts,
  isValidatedStatus,
  listStates,
  REGISTRY_STATUS_LABELS,
  type StateGrantRegistryStatus,
} from "~/lib/state-grants/registry";

/**
 * Contrax Grants — STATE GRANTS: coverage + search (owner ROLLOUT order
 * 2026-09-18, part 2; re-cut onto the corrected model, R1 / owner 2026-09-19).
 *
 * WHY THIS PAGE EXISTS, AND WHAT IT MAY NOT SAY
 *   - It states COVERAGE HONESTLY, on the owner's ladder: connected | curated |
 *     limited | unavailable. 50 states + D.C. are listed; only a state whose
 *     connector passed the live source-validation gate holds a validated tier.
 *     VIRGINIA IS `limited` — one tourism source, not a statewide view — and this
 *     page prints the registry's own note saying exactly that.
 *   - It says out loud that this is a growing program, NOT nationwide coverage.
 *   - The registry table comes from the DERIVED registry (registry.ts),
 *     recomputed in the browser and on the server — never from the
 *     state_grant_registry mirror table — so the mirror can never inflate what
 *     we claim.
 *
 * SYNC FACTS (last sync time, record counts) come from
 * GET /api/state-grants/coverage; the search box calls
 * POST /api/state-grants/search. Nothing here talks to a state website or to
 * Grants.gov directly, and the page renders honestly if the store is
 * unreachable: the derived registry stays visible and the sync facts read
 * "Not available".
 *
 * HONESTY ON EVERY CARD: the five-status model (open | upcoming | rolling |
 * closed | unverified — there is no `forecast`), the deadline line and every
 * field are the agency's own values mapped through the shared pure module — a
 * published estimate is labelled "source estimate — not a posted closing date",
 * a missing value reads "Not specified", and each card links to its own page on
 * the official source.
 *
 * ACCESS + ANALYTICS: anonymous and free, exactly like the federal finder — no
 * login, no subscription, no cap, no pricing prompt. This page emits NO
 * analytics event of any kind (no state-grants event exists, by design).
 */
const CLIENT_TIMEOUT_MS = 20_000;
const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";
const LABEL_CLASS = "mb-1.5 block text-sm font-semibold text-slate-800";

export const Route = createFileRoute("/state-grants")({
  head: () => ({
    meta: [
      { title: "State Grant Coverage — Contrax Grants" },
      {
        name: "description",
        content:
          "See exactly which states Contrax reads real grant opportunities from — state by state, with the coverage tier each state has earned and each agency's official source — and search the stored state grants honestly labelled, straight from the agency that published them.",
      },
    ],
  }),
  component: StateGrantsPage,
});

type StatusCounts = Record<StateGrantStatus, number> & { total: number };

interface ValidatedCoverage {
  stateCode: string;
  name: string;
  tier: Exclude<StateGrantRegistryStatus, "unavailable">;
  tierLabel: string;
  note: string | null;
  reason: string;
  connectorId: string | null;
  sourceUrl: string;
  sourceValidationTest: string | null;
  sourceCount: number;
  recordCount: number;
  statusCounts: StatusCounts;
  lastSyncedAt: string | null;
  lastRun: {
    status: "ok" | "error";
    startedAt: string;
    finishedAt: string | null;
    fetchedCount: number;
    insertedCount: number;
    updatedCount: number;
  } | null;
}

interface CoverageResponse {
  ok?: boolean;
  error?: string;
  headline?: string;
  noNationwideCoverage?: string;
  counts?: { total: number; connected: number; curated: number; limited: number; unavailable: number; validated: number };
  validated?: ValidatedCoverage[];
  asOf?: string | null;
  notice?: string;
  federalGrantsUrl?: string;
}

interface SearchResponse {
  ok?: boolean;
  error?: string;
  countLabel?: string;
  asOf?: string | null;
  statesIncluded?: string[];
  statesMatched?: string[];
  uncoveredStates?: string[];
  uncoveredNotice?: string | null;
  totalCount?: number;
  countExact?: boolean;
  returned?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  limitCapped?: boolean;
  notice?: string;
  records?: StateGrantRecordView[];
}

const STATUS_CHIP: Record<StateGrantStatus, string> = {
  open: "bg-emerald-100 text-emerald-900",
  upcoming: "bg-sky-100 text-sky-900",
  rolling: "bg-indigo-100 text-indigo-900",
  closed: "bg-slate-200 text-slate-700",
  unverified: "bg-amber-100 text-amber-900",
};

const TIER_CHIP: Record<StateGrantRegistryStatus, string> = {
  connected: "bg-emerald-100 text-emerald-900",
  curated: "bg-teal-100 text-teal-900",
  limited: "bg-amber-100 text-amber-900",
  unavailable: "bg-slate-100 text-slate-600",
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "Not available";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not available";
  return `${d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  })} ET`;
}

function StatusCountLine({ counts }: { counts: StatusCounts }) {
  return (
    <span className="text-xs font-semibold text-slate-600">
      {counts.total} {counts.total === 1 ? "record" : "records"} stored
      {" · "}
      {STATE_GRANT_STATUS_OPTIONS.map((s) => `${counts[s]} ${s}`).join(" / ")}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="whitespace-nowrap font-semibold text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}

function StateGrantsPage() {
  // The derived registry — pure, recomputed on every render, never the mirror table.
  const states = listStates();
  const counts = coverageCounts();
  const validatedEntries = states.filter((s) => isValidatedStatus(s.status));
  const alphabetical = [...states].sort((a, b) => a.name.localeCompare(b.name));

  const [coverage, setCoverage] = useState<CoverageResponse | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);

  const [stateCode, setStateCode] = useState("");
  const [status, setStatus] = useState<"" | StateGrantStatus>("");
  const [term, setTerm] = useState("");
  const [eligibleApplicants, setEligibleApplicants] = useState("");
  const [eligibleGeography, setEligibleGeography] = useState("");
  const [categories, setCategories] = useState("");
  const [awardRange, setAwardRange] = useState("");
  const [awardMinAmount, setAwardMinAmount] = useState("");
  const [awardMaxAmount, setAwardMaxAmount] = useState("");
  const [totalFunding, setTotalFunding] = useState("");
  const [matchingRequirement, setMatchingRequirement] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [data, setData] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    void (async () => {
      try {
        const res = await fetch("/api/state-grants/coverage", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await res.json()) as CoverageResponse;
        if (!res.ok || body.ok === false) {
          setCoverageError(body.error ?? "Coverage details are unavailable right now.");
        } else {
          setCoverage(body);
        }
      } catch {
        setCoverageError("Coverage details are unavailable right now.");
      } finally {
        window.clearTimeout(timer);
        setCoverageLoading(false);
      }
    })();
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const validatedDetail = coverage?.validated ?? [];
  const detailFor = (code: string): ValidatedCoverage | undefined =>
    validatedDetail.find((c) => c.stateCode === code);

  // The headline is computed from the DERIVED registry, so it is correct even
  // when the coverage request fails. "Validated source" — never "connected
  // states", because `limited` is not statewide coverage.
  const headline = `State grant coverage: ${counts.validated} of ${counts.total} ${
    counts.total === 1 ? "state has" : "states have"
  } a validated source (${counts.connected} connected, ${counts.curated} curated, ${counts.limited} limited)`;

  const onSearch = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (searching) return;
      setSearching(true);
      setSearchError(null);
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
      const categoryList = categories
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
        .slice(0, STATE_GRANT_MAX_CATEGORIES);
      const amount = (raw: string): number | undefined => {
        const n = Number(raw);
        return raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : undefined;
      };
      try {
        const res = await fetch("/api/state-grants/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            stateCodes: stateCode ? [stateCode] : [],
            status: status || undefined,
            term: term.trim() || undefined,
            eligibleApplicants: eligibleApplicants.trim() || undefined,
            eligibleGeography: eligibleGeography.trim() || undefined,
            categories: categoryList.length > 0 ? categoryList : undefined,
            awardRange: awardRange.trim() || undefined,
            awardMinAmount: amount(awardMinAmount),
            awardMaxAmount: amount(awardMaxAmount),
            totalFunding: totalFunding.trim() || undefined,
            matchingRequirement: matchingRequirement.trim() || undefined,
            limit: 25,
          }),
        });
        const body = (await res.json()) as SearchResponse;
        if (!res.ok || body.ok === false) {
          setData(null);
          setSearchError(body.error ?? "We couldn't search the state grant store. Please try again.");
        } else {
          setData(body);
        }
      } catch (err) {
        setData(null);
        setSearchError(
          err instanceof Error && err.name === "AbortError"
            ? "The state grant search took too long. Please try again."
            : "We couldn't reach the state grant search. Check your connection and try again.",
        );
      } finally {
        window.clearTimeout(timer);
        setSearching(false);
      }
    },
    [
      searching,
      stateCode,
      status,
      term,
      eligibleApplicants,
      eligibleGeography,
      categories,
      awardRange,
      awardMinAmount,
      awardMaxAmount,
      totalFunding,
      matchingRequirement,
    ],
  );

  const records = data?.records ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <div className="flex items-center gap-3">
            <a
              href={FEDERAL_GRANTS_PATH}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold whitespace-nowrap text-slate-800 transition-colors hover:bg-slate-50"
            >
              Federal grants
            </a>
            <a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-700">
              Dashboard
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900">State grants</h1>
          <p className="mt-2 max-w-3xl text-lg text-slate-500">
            Real grant opportunities published by state agencies, read straight from each
            agency&rsquo;s own funding page — and coverage stated exactly as far as it goes.
          </p>
        </div>

        {/* ── Honest coverage headline + the ladder ── */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-bold text-slate-900">{headline}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            {coverage?.noNationwideCoverage ?? STATE_GRANTS_COVERAGE_CLAIM}
          </p>
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <dt className="flex items-center gap-2 font-bold text-slate-900">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_CHIP.limited}`}
                >
                  Limited
                </span>
              </dt>
              <dd className="mt-1 text-xs text-slate-600">{REGISTRY_STATUS_LABELS.limited}</dd>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <dt className="flex items-center gap-2 font-bold text-slate-900">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_CHIP.curated}`}
                >
                  Curated
                </span>
              </dt>
              <dd className="mt-1 text-xs text-slate-600">{REGISTRY_STATUS_LABELS.curated}</dd>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <dt className="flex items-center gap-2 font-bold text-slate-900">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_CHIP.connected}`}
                >
                  Connected
                </span>
              </dt>
              <dd className="mt-1 text-xs text-slate-600">{REGISTRY_STATUS_LABELS.connected}</dd>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <dt className="flex items-center gap-2 font-bold text-slate-900">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_CHIP.unavailable}`}
                >
                  Not covered yet
                </span>
              </dt>
              <dd className="mt-1 text-xs text-slate-600">{REGISTRY_STATUS_LABELS.unavailable}</dd>
            </div>
          </dl>
          <p className="mt-3 max-w-3xl text-xs text-slate-500">
            {coverageLoading
              ? "Reading the latest state sync…"
              : coverageError
                ? `${coverageError} The coverage list below is still the live registry of what Contrax reads.`
                : `Last successful sync across validated states: ${formatWhen(coverage?.asOf)}.`}
          </p>

          {validatedEntries.length > 0 && (
            <div className="mt-4 space-y-3">
              {validatedEntries.map((entry) => {
                const detail = detailFor(entry.stateCode);
                return (
                  <div
                    key={entry.stateCode}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{entry.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_CHIP[entry.status]}`}
                      >
                        {entry.status}
                      </span>
                      {detail ? <StatusCountLine counts={detail.statusCounts} /> : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{entry.reason}</p>
                    {entry.note && (
                      <p className="mt-1 text-xs font-medium text-amber-900">{entry.note}</p>
                    )}
                    {entry.sourceUrl && (
                      <p className="mt-1 text-xs text-slate-600">
                        Official source:{" "}
                        <a
                          href={entry.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold underline"
                        >
                          {entry.sourceUrl}
                        </a>
                        {entry.sourceCount === 1 ? " · 1 registered source" : ` · ${entry.sourceCount} registered sources`}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-slate-500">
                      Last successful sync: {formatWhen(detail?.lastSyncedAt)}
                      {detail?.lastRun ? ` · last run ${detail.lastRun.status}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Search ── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Search stored state grants</h2>
          <p className="mt-1 text-sm text-slate-500">
            Free, no account needed. Results come from the state agencies&rsquo; own published pages,
            as stored at the last sync. Fields an agency did not publish read &ldquo;Not
            specified&rdquo; and are never matched by a filter.
          </p>
          <form onSubmit={onSearch} className="mt-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="state-grants-state" className={LABEL_CLASS}>
                  State
                </label>
                <select
                  id="state-grants-state"
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">All states with a validated source</option>
                  {validatedEntries.map((s) => (
                    <option key={s.stateCode} value={s.stateCode}>
                      {s.name} — {s.status}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="state-grants-status" className={LABEL_CLASS}>
                  Status
                </label>
                <select
                  id="state-grants-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "" | StateGrantStatus)}
                  className={INPUT_CLASS}
                >
                  <option value="">Any status</option>
                  {STATE_GRANT_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {STATE_GRANT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="state-grants-term" className={LABEL_CLASS}>
                  Keyword
                </label>
                <input
                  id="state-grants-term"
                  type="text"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  maxLength={STATE_GRANT_SEARCH_MAX_TERM}
                  placeholder="e.g. tourism, events"
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="mt-4 text-sm font-semibold text-slate-700 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
            >
              {showFilters ? "Hide agency-published filters" : "Filter on what the agencies published"}
            </button>

            {showFilters && (
              <div className="mt-4 grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="sg-eligible" className={LABEL_CLASS}>
                    Eligible applicants contains
                  </label>
                  <input
                    id="sg-eligible"
                    type="text"
                    value={eligibleApplicants}
                    onChange={(e) => setEligibleApplicants(e.target.value)}
                    placeholder="e.g. small business"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="sg-geography" className={LABEL_CLASS}>
                    Eligible geography contains
                  </label>
                  <input
                    id="sg-geography"
                    type="text"
                    value={eligibleGeography}
                    onChange={(e) => setEligibleGeography(e.target.value)}
                    placeholder="e.g. Virginia"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="sg-categories" className={LABEL_CLASS}>
                    Categories (comma separated)
                  </label>
                  <input
                    id="sg-categories"
                    type="text"
                    value={categories}
                    onChange={(e) => setCategories(e.target.value)}
                    placeholder="e.g. tourism, events"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="sg-award-range" className={LABEL_CLASS}>
                    Award wording contains
                  </label>
                  <input
                    id="sg-award-range"
                    type="text"
                    value={awardRange}
                    onChange={(e) => setAwardRange(e.target.value)}
                    placeholder="e.g. tier"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="sg-award-min" className={LABEL_CLASS}>
                    Award at least ($)
                  </label>
                  <input
                    id="sg-award-min"
                    type="text"
                    inputMode="numeric"
                    value={awardMinAmount}
                    onChange={(e) => setAwardMinAmount(e.target.value)}
                    placeholder="e.g. 10000"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="sg-award-max" className={LABEL_CLASS}>
                    Award upward range starts at most ($)
                  </label>
                  <input
                    id="sg-award-max"
                    type="text"
                    inputMode="numeric"
                    value={awardMaxAmount}
                    onChange={(e) => setAwardMaxAmount(e.target.value)}
                    placeholder="e.g. 50000"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="sg-total-funding" className={LABEL_CLASS}>
                    Total funding contains
                  </label>
                  <input
                    id="sg-total-funding"
                    type="text"
                    value={totalFunding}
                    onChange={(e) => setTotalFunding(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="sg-match" className={LABEL_CLASS}>
                    Matching requirement contains
                  </label>
                  <input
                    id="sg-match"
                    type="text"
                    value={matchingRequirement}
                    onChange={(e) => setMatchingRequirement(e.target.value)}
                    placeholder="e.g. cash match"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={searching || validatedEntries.length === 0}
              className="mt-5 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {searching ? "Searching…" : "Search state grants"}
            </button>
          </form>

          {validatedEntries.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">
              No state has a validated official source yet, so there is nothing to search.
            </p>
          )}

          {searchError && (
            <div role="status" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-sm font-semibold text-rose-900">{searchError}</p>
            </div>
          )}

          {data && !searchError && (
            <div className="mt-6">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-sm font-bold text-slate-900">
                  {data.countLabel ?? `${data.totalCount ?? 0} records`}
                </p>
                <p className="text-xs text-slate-500">
                  {data.asOf
                    ? `Source last synced ${formatWhen(data.asOf)}`
                    : "No successful sync recorded for this scope yet"}
                  {data.statesIncluded && data.statesIncluded.length > 0
                    ? ` · states searched: ${data.statesIncluded.join(", ")}`
                    : ""}
                  {data.limitCapped ? ` · result cap applied (${data.limit} per page)` : ""}
                </p>
              </div>
              <p className="mt-2 text-xs text-slate-500">{data.notice ?? STATE_GRANTS_NOTICE}</p>

              {data.uncoveredNotice && (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  {data.uncoveredNotice}
                </p>
              )}

              {records.length === 0 ? (
                <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  No stored state grant record matches those filters. Widen the status or the
                  keyword and try again.
                </p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {records.map((r) => (
                    <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CHIP[r.status]}`}
                        >
                          {r.statusLabel}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                          {r.stateName} ({r.stateCode})
                        </span>
                      </div>
                      <h3 className="mt-2 text-base font-bold text-slate-900">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
                        >
                          {r.title}
                        </a>
                      </h3>
                      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                        <Field label="Agency" value={r.agency} />
                        <Field label={r.deadline.label} value={r.deadline.value} />
                        <Field label="Posted" value={r.postedDate ?? "Not specified"} />
                        <Field
                          label="Eligible applicants"
                          value={r.eligibleApplicants}
                        />
                        <Field label="Eligible geography" value={r.eligibleGeography} />
                        <Field
                          label="Categories"
                          value={r.categories.length > 0 ? r.categories.join(", ") : "Not specified"}
                        />
                        <Field label="Award" value={r.awardRange} />
                        <Field
                          label="Award amounts"
                          value={
                            r.awardMinAmount === null && r.awardMaxAmount === null
                              ? "Not specified"
                              : `${
                                  r.awardMinAmount === null ? "Not specified" : `$${r.awardMinAmount.toLocaleString("en-US")}`
                                } – ${
                                  r.awardMaxAmount === null ? "Not specified" : `$${r.awardMaxAmount.toLocaleString("en-US")}`
                                }`
                          }
                        />
                        <Field label="Total funding" value={r.totalFunding} />
                        <Field label="Matching requirement" value={r.matchingRequirement} />
                      </dl>
                      {r.summary !== "Not specified" && (
                        <p className="mt-2 text-sm text-slate-600">{r.summary}</p>
                      )}
                      <p className="mt-3 text-xs text-slate-500">
                        Source:{" "}
                        <a
                          href={r.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-slate-700 underline"
                        >
                          {r.sourceLabel}
                        </a>{" "}
                        · stored {formatWhen(r.fetchedAt)}
                        {r.lastSeenAt ? ` · last seen ${formatWhen(r.lastSeenAt)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {data.hasMore && (
                <p className="mt-3 text-xs text-slate-500">
                  Showing the first {records.length} of {data.totalCount} matching records. Narrow
                  the filters to see the rest.
                </p>
              )}
            </div>
          )}
        </section>

        {/* ── The full registry, state by state ── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Every state, and where it stands</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            All 50 states and the District of Columbia are listed so the rollout is visible. A state
            holds a validated tier only after its connector passed a live source-validation gate
            against an official host; everything else reads &ldquo;not covered yet&rdquo; and serves
            nothing.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="border-b border-slate-200 py-2 pr-4">State</th>
                  <th className="border-b border-slate-200 py-2 pr-4">Coverage</th>
                  <th className="border-b border-slate-200 py-2">Why</th>
                </tr>
              </thead>
              <tbody>
                {alphabetical.map((s) => (
                  <tr key={s.stateCode} className="align-top">
                    <td className="border-b border-slate-100 py-2 pr-4 font-semibold whitespace-nowrap text-slate-800">
                      {s.name} ({s.stateCode})
                    </td>
                    <td className="border-b border-slate-100 py-2 pr-4 whitespace-nowrap">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_CHIP[s.status]}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="border-b border-slate-100 py-2 text-xs text-slate-600">
                      {s.note ? `${s.note} ` : ""}
                      {s.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Federal cross-link + honesty footer ── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Looking for federal grants?</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Contrax Grants also searches live federal opportunities straight from Grants.gov, with
            real funding amounts, eligibility and deadlines.
          </p>
          <a
            href={FEDERAL_GRANTS_PATH}
            className="mt-3 inline-flex rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-300"
          >
            Search federal grants →
          </a>
        </section>

        <p className="mt-6 max-w-3xl text-xs text-slate-500">
          {coverage?.notice ?? STATE_GRANTS_NOTICE}
        </p>
      </main>
    </div>
  );
}
