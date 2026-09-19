import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  FEDERAL_GRANTS_PATH,
  STATE_GRANTS_COVERAGE_CLAIM,
  STATE_GRANTS_NOTICE,
  STATE_GRANT_SEARCH_MAX_TERM,
  type StateGrantRecordView,
} from "~/lib/state-grants/search";
import { coverageCounts, listStates } from "~/lib/state-grants/registry";

/**
 * Contrax Grants — STATE GRANTS: coverage + search (owner ROLLOUT order
 * 2026-09-18, part 2).
 *
 * WHY THIS PAGE EXISTS, AND WHAT IT MAY NOT SAY
 *   - It states COVERAGE HONESTLY: how many states are actually connected
 *     (50 + D.C. are listed; only a state whose connector passed the live
 *     source-validation gate reads `connected`). The headline and the registry
 *     table come from the DERIVED registry (registry.ts), recomputed in the
 *     browser and on the server — never from the state_grant_registry mirror
 *     table — so the mirror can never inflate what we claim.
 *   - It says out loud that this is a growing program, NOT nationwide coverage.
 *   - It links to the federal Grants.gov finder for federal opportunities.
 *
 * SYNC FACTS (last sync time, record counts) come from
 * GET /api/state-grants/coverage; the search box calls
 * POST /api/state-grants/search. Nothing here talks to a state website or to
 * Grants.gov directly, and the page renders honestly if the store is
 * unreachable: the derived registry stays visible and the sync facts read
 * "Not available".
 *
 * HONESTY ON EVERY CARD: the status, the deadline line and every field are the
 * source's own values mapped through the shared pure module — a forecast's date
 * is labelled "source estimate — not a posted closing date", a missing value
 * reads "Not specified", and each card links to its own page on the official
 * source.
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
          "See exactly which states Contrax reads real grant opportunities from — state by state, with each state agency's official source — and search the stored state grants honestly labelled, straight from the agency that published them.",
      },
    ],
  }),
  component: StateGrantsPage,
});

interface ConnectedCoverage {
  stateCode: string;
  name: string;
  sourceUrl: string;
  connectorId: string | null;
  sourceValidationTest: string | null;
  recordCount: number;
  statusCounts: { open: number; forecast: number; closed: number; total: number };
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
  counts?: { total: number; connected: number; unavailable: number };
  connected?: ConnectedCoverage[];
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

const STATUS_CHIP: Record<string, string> = {
  open: "bg-emerald-100 text-emerald-900",
  forecast: "bg-amber-100 text-amber-900",
  closed: "bg-slate-200 text-slate-700",
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

function StateGrantsPage() {
  // The derived registry — pure, recomputed on every render, never the mirror table.
  const states = listStates();
  const counts = coverageCounts();
  const connectedEntries = states.filter((s) => s.status === "connected");
  const alphabetical = [...states].sort((a, b) => a.name.localeCompare(b.name));

  const [coverage, setCoverage] = useState<CoverageResponse | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);

  const [stateCode, setStateCode] = useState("");
  const [status, setStatus] = useState<"" | "open" | "forecast" | "closed">("");
  const [term, setTerm] = useState("");
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

  const connected = coverage?.connected ?? [];
  const statsFor = (code: string): ConnectedCoverage | undefined =>
    connected.find((c) => c.stateCode === code);

  // The headline is computed from the DERIVED registry, so it is correct even
  // when the coverage request fails.
  const headline = `State grant coverage: ${counts.connected} of ${counts.total} ${
    counts.connected === 1 ? "state" : "states"
  } connected`;

  const onSearch = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (searching) return;
      setSearching(true);
      setSearchError(null);
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
      try {
        const res = await fetch("/api/state-grants/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            stateCodes: stateCode ? [stateCode] : [],
            status: status || undefined,
            term: term.trim() || undefined,
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
    [searching, stateCode, status, term],
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
            <a
              href="/dashboard"
              className="text-sm font-medium text-slate-500 hover:text-slate-700"
            >
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
            agency&rsquo;s own funding page.
          </p>
        </div>

        {/* ── Honest coverage headline ── */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-bold text-slate-900">{headline}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            {coverage?.noNationwideCoverage ?? STATE_GRANTS_COVERAGE_CLAIM}
          </p>
          <p className="mt-2 max-w-3xl text-xs text-slate-500">
            {coverageLoading
              ? "Reading the latest state sync…"
              : coverageError
                ? `${coverageError} The coverage list below is still the live registry of what Contrax reads.`
                : `${coverage?.counts?.connected ?? counts.connected} of ${
                    coverage?.counts?.total ?? counts.total
                  } states have a verified official source and stored records. The other ${
                    coverage?.counts?.unavailable ?? counts.unavailable
                  } states are listed inside the rollout but are NOT covered yet.`}
          </p>

          {connected.length > 0 && (
            <div className="mt-4 space-y-3">
              {connected.map((c) => (
                <div
                  key={c.stateCode}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-emerald-950">{c.name}</span>
                    <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                      Connected
                    </span>
                    <span className="text-xs font-semibold text-emerald-900">
                      {c.recordCount} {c.recordCount === 1 ? "record" : "records"} stored
                      {" · "}
                      {c.statusCounts.open} open / {c.statusCounts.forecast} forecast /{" "}
                      {c.statusCounts.closed} closed
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-emerald-900">
                    Official source:{" "}
                    <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
                      {c.sourceUrl}
                    </a>
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-800">
                    Last successful sync: {formatWhen(c.lastSyncedAt)}
                    {c.lastRun ? ` · last run ${c.lastRun.status}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Search ── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Search stored state grants</h2>
          <p className="mt-1 text-sm text-slate-500">
            Free, no account needed. Results come from the state agencies&rsquo; own published pages,
            as stored at the last sync.
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
                  <option value="">All connected states</option>
                  {connectedEntries.map((s) => (
                    <option key={s.stateCode} value={s.stateCode}>
                      {s.name}
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
                  onChange={(e) =>
                    setStatus(
                      e.target.value === "closed"
                        ? "closed"
                        : e.target.value === "forecast"
                          ? "forecast"
                          : e.target.value === "open"
                            ? "open"
                            : "",
                    )
                  }
                  className={INPUT_CLASS}
                >
                  <option value="">Any status</option>
                  <option value="open">Open — accepting applications</option>
                  <option value="forecast">Forecast — announced, not yet open</option>
                  <option value="closed">Closed</option>
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
              type="submit"
              disabled={searching || connectedEntries.length === 0}
              className="mt-5 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {searching ? "Searching…" : "Search state grants"}
            </button>
          </form>

          {connectedEntries.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">
              No state has a verified official source yet, so there is nothing to search.
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

              {records.length === 0 ? (
                <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  No stored state grant record matches those filters. Widen the status or the
                  keyword and try again.
                </p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {records.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            STATUS_CHIP[r.status] ?? "bg-slate-200 text-slate-700"
                          }`}
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
                        <div className="flex gap-2">
                          <dt className="font-semibold text-slate-500">Agency</dt>
                          <dd className="text-slate-800">{r.agency}</dd>
                        </div>
                        {r.deadline && (
                          <div className="flex gap-2">
                            <dt className="font-semibold text-slate-500">{r.deadline.label}</dt>
                            <dd className="text-slate-800">{r.deadline.value}</dd>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <dt className="font-semibold text-slate-500">Posted</dt>
                          <dd className="text-slate-800">{r.postedDate ?? "Not specified"}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="font-semibold text-slate-500">Source updated</dt>
                          <dd className="text-slate-800">
                            {r.sourceUpdatedAt ? formatWhen(r.sourceUpdatedAt) : "Not published"}
                          </dd>
                        </div>
                      </dl>
                      {r.summary && r.summary !== "Not specified" && (
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

        {/* ── Federal cross-link + honesty footer ── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Looking for federal grants?</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Contrax Grants also searches live federal opportunities straight from Grants.gov,
            with real funding amounts, eligibility and deadlines.
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
