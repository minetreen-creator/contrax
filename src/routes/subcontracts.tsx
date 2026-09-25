import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LAST_CHECKED_LABEL,
  LISTED_SCOPES_NOTE,
  NO_CLOSING_DATE_LISTED,
  NOT_SPECIFIED,
  PRIME_DIRECTORY_CONTEXT,
  PRIME_DIRECTORY_HEADING,
  PRIMES_DEFAULT_LIMIT,
  SUBNET_POSTING_BOARD_SENTENCE,
  SUBNET_SOURCE_LABEL,
  SUBNET_SOURCE_URL,
  STATE_BUCKET_UNKNOWN,
  checkedAtText,
  companyCountText,
  isUnavailable,
  noticeCountText,
  type CountBucket,
  type PrimesPayload,
  type PrimesResponse,
  type SubcontractNoticeView,
  type SubcontractsResponse,
} from "~/lib/subcontracts/read";
import {
  SUBCONTRACTS_EVENTS,
  shouldFireNoticeView,
  trackSubcontractsEvent,
} from "~/lib/subcontracts/subcontracts-analytics";

/**
 * /subcontracts — SUBCONTRACTING OPPORTUNITIES, from the stored SBA SUBNet board
 * (owner directive 2026-09-25, step 2b; BUILD-PLAN.md §6.4).
 *
 * WHAT CHANGED FROM THE DRAFT: the hand-written `SUBCONTRACT_OPPORTUNITIES` array is
 * gone. Every rendered word now comes from `GET /api/subcontracts` (the sweeper's
 * stored rows) or from `GET /api/subcontracts/primes` (the annual FY24 directory,
 * paged server-side). This page cannot show a notice that the database does not
 * hold, and it cannot claim a count nobody computed.
 *
 * THE FOUR HONESTY RULES THIS PAGE IS BUILT AROUND
 *   1. NOT AVAILABLE is a state, not an empty list. If the store cannot be read (or
 *      the tables are absent, or no sweep has ever completed), the page renders the
 *      API's own reason and links the real board. It NEVER renders "0 notices match"
 *      for a store we could not read — those are different statements.
 *   2. "open" is the DATABASE's verdict. This page shows rows the sweeper stored as
 *      `status = 'open'` (a published closing date that has not passed, US Eastern,
 *      closing day inclusive). The client-side Eastern-date filter below is a DISPLAY
 *      GUARD only, for rows that are up to one daily sweep old.
 *   3. NO INVENTED NUMBERS OR DATES. `{N} open notices`, the by-state/by-trade
 *      counts, the excluded count and the freshness line are all read from the
 *      payload; a notice with no closing date prints "no closing date listed" rather
 *      than a guess, and the excluded bucket is printed as a count so its absence
 *      from the open list is visible instead of silent.
 *   4. THE PRIME DIRECTORY IS SEPARATE AND HISTORICAL. Companies with a federal
 *      subcontracting plan (SBA FY24 annual file) are "companies to approach", never
 *      mixed into the open notices, never called open opportunities.
 *
 * FRESHNESS WORDING (owner correction 1, applied verbatim): SBA SUBNet publishes NO
 * posted/updated date, so the only timestamp this page may print is when CONTRAX
 * last checked — "last checked by Contrax". The words "posted", "published" and
 * "listed" never label that timestamp, and "nationwide"/"comprehensive" appear
 * nowhere on this surface.
 *
 * ACCESS: public and anonymous, no login, no cap, no pricing copy, no checkout. The
 * five analytics names are display-only (src/lib/subcontracts/subcontracts-analytics.ts).
 */

const CARD_CLASS = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";
const CARD_TITLE_CLASS = "mt-3 text-xl font-bold";
const LINK_BUTTON_CLASS =
  "inline-flex rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800";
const GHOST_BUTTON_CLASS =
  "inline-flex rounded-lg border border-blue-200 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50";
const SELECT_CLASS = "rounded-lg border border-slate-300 p-2.5 font-normal";
const LABEL_CLASS = "flex min-w-44 flex-1 flex-col gap-1 text-sm font-medium";

/** Today's calendar day in US Eastern — the source's own date basis, display-only. */
function easternDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * The DISPLAY GUARD (BUILD-PLAN §1.3 kept). The database already decided status; this
 * only hides rows whose stored closing day passed after the last sweep, and it keeps
 * a row the database calls open when no closing date is stored (an inconsistency we
 * do not fix by hiding it — the row's own card says the date is missing).
 */
function withinClosingDay(rows: readonly SubcontractNoticeView[], todayEastern: string) {
  return rows.filter((row) => !row.closingDate || row.closingDate >= todayEastern);
}

/** A compact "key 12 · key 9" rendering of the stored counts (never a computed guess). */
function CountList({ title, buckets, emptyLabel }: { title: string; buckets: CountBucket[]; emptyLabel: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</p>
      {buckets.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-700">
          {buckets.map((bucket) => (
            <li key={bucket.key}>
              {bucket.key === STATE_BUCKET_UNKNOWN ? "state not stated" : bucket.key}{" "}
              <span className="font-semibold">{bucket.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One notice card. Fires `subcontracts_notice_viewed` ONCE, on intersection. */
function NoticeCard({ notice, onSeen }: { notice: SubcontractNoticeView; onSeen: (id: string) => void }) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // No IntersectionObserver (or SSR hydration edge): still count the view once,
    // rather than silently under-reporting the surface.
    if (typeof IntersectionObserver === "undefined") {
      onSeen(notice.externalId);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onSeen(notice.externalId);
            observer.disconnect();
            return;
          }
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [notice.externalId, onSeen]);

  const checked = checkedAtText(notice.lastCheckedAt);

  return (
    <article ref={ref} className={CARD_CLASS}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
            {notice.stateChip}
          </span>
          <h2 className={CARD_TITLE_CLASS}>{notice.title}</h2>
        </div>
        <p className="text-sm font-semibold text-slate-700">
          {notice.closingDate ? (
            <>Closing {notice.closingDateText}</>
          ) : (
            <span className="font-normal text-slate-500">{NO_CLOSING_DATE_LISTED}</span>
          )}
        </p>
      </div>
      <p className="mt-3 text-sm">
        <span className="font-semibold">Prime:</span> {notice.prime}
        {notice.primeDivision ? <span className="text-slate-600"> · {notice.primeDivision}</span> : null}
      </p>
      {notice.placeOfPerformance ? (
        <p className="mt-2 text-sm text-slate-600">
          <span className="font-semibold">Place of performance (source wording):</span>{" "}
          {notice.placeOfPerformance}
        </p>
      ) : null}
      {notice.performanceStartText ? (
        <p className="mt-2 text-sm text-slate-600">Performance start: {notice.performanceStartText}</p>
      ) : null}
      {notice.scope ? <p className="mt-2 text-sm text-slate-600">{notice.scope}</p> : null}
      {notice.naicsCode || notice.naicsTitle ? (
        <p className="mt-2 text-sm text-slate-600">
          NAICS: {[notice.naicsCode, notice.naicsTitle].filter(Boolean).join(" — ")}
        </p>
      ) : null}
      <p className="mt-3 text-xs text-slate-500">
        Listed scopes: {notice.trades.length > 0 ? notice.trades.join(" · ") : NOT_SPECIFIED} — {LISTED_SCOPES_NOTE}.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Certifications solicited (the notice&rsquo;s own list):{" "}
        {notice.certsSolicited.length > 0 ? notice.certsSolicited.join(" · ") : NOT_SPECIFIED + " — the notice states none"}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a
          href={notice.detailUrl}
          target="_blank"
          rel="noreferrer"
          onClick={() => trackSubcontractsEvent(SUBCONTRACTS_EVENTS.sourceOpen, notice.externalId)}
          className={LINK_BUTTON_CLASS}
        >
          View original SBA notice →
        </a>
        {notice.contactEmail ? (
          <a
            href={`mailto:${notice.contactEmail}`}
            onClick={() => trackSubcontractsEvent(SUBCONTRACTS_EVENTS.contactClick, notice.externalId)}
            className={GHOST_BUTTON_CLASS}
          >
            Email prime contact
          </a>
        ) : (
          <span className="inline-flex items-center text-sm text-slate-500">
            No contact email listed — use the original notice
          </span>
        )}
      </div>
      <p className="mt-4 text-xs text-slate-400">
        {checked ? `${LAST_CHECKED_LABEL} ${checked}` : `${LAST_CHECKED_LABEL} — time not recorded`}
        {notice.contactName ? ` · Notice contact: ${notice.contactName}` : ""}
      </p>
    </article>
  );
}

/** The prime-directory row list — HISTORICAL annual file, never the open notices. */
function PrimeDirectory({
  payload,
  unavailableReason,
  loading,
  naics,
  state,
  page,
  onFilter,
  onPage,
}: {
  payload: PrimesPayload | null;
  unavailableReason: string | null;
  loading: boolean;
  naics: string;
  state: string;
  page: number;
  onFilter: (next: { naics?: string; state?: string }) => void;
  onPage: (next: number) => void;
}) {
  const rows = payload?.rows ?? [];
  const limit = payload?.limit ?? PRIMES_DEFAULT_LIMIT;
  const from = rows.length === 0 ? 0 : (page - 1) * limit + 1;
  const to = (page - 1) * limit + rows.length;
  return (
    <section id="primes" className="mt-14 rounded-3xl border border-slate-200 bg-slate-50 p-6">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
        Separate from the notices below · annual, not live
      </p>
      <h2 className="mt-2 text-2xl font-bold">{PRIME_DIRECTORY_HEADING}</h2>
      <p className="mt-3 max-w-3xl text-sm text-slate-600">{PRIME_DIRECTORY_CONTEXT}</p>
      {unavailableReason ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The prime directory is not available on this page right now. {unavailableReason}
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <label className={LABEL_CLASS} htmlFor="prime-naics">
              NAICS
              <select
                id="prime-naics"
                value={naics}
                onChange={(event) => onFilter({ naics: event.target.value })}
                className={SELECT_CLASS}
              >
                <option value="">All listed NAICS</option>
                {(payload?.options.naics ?? []).map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.key} ({option.count})
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL_CLASS} htmlFor="prime-state">
              State
              <select
                id="prime-state"
                value={state}
                onChange={(event) => onFilter({ state: event.target.value })}
                className={SELECT_CLASS}
              >
                <option value="">All listed states</option>
                {(payload?.options.states ?? []).map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.key} ({option.count})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-4 text-sm text-slate-700">
            {payload
              ? `${companyCountText(payload.counts.filtered)} match${payload.counts.filtered === 1 ? "es" : ""} this filter, of ${payload.counts.directoryTotal} in the SBA ${payload.fy} directory (annual file).`
              : "Reading the SBA FY24 directory…"}
          </p>
          {payload?.options.naicsTruncated ? (
            <p className="mt-1 text-xs text-slate-500">
              The NAICS menu shows the {payload.options.naics.length} most common codes in the file; a code that is not
              listed is still in the data.
            </p>
          ) : null}
          <ul className="mt-4 grid gap-3">
            {rows.map((row) => (
              <li key={row.uei} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="font-semibold">{row.legalName}</p>
                <p className="mt-1 text-xs text-slate-500">
                  UEI {row.uei}
                  {row.vendorState ? ` · ${row.vendorState}` : ""}
                  {row.subcontractPlanType ? ` · subcontracting plan: ${row.subcontractPlanType}` : ""}
                </p>
                {row.agencies.length > 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    Agencies in the file: {row.agencies.slice(0, 4).join("; ")}
                    {row.agencies.length > 4 ? ` (+${row.agencies.length - 4} more)` : ""}
                  </p>
                ) : null}
                {row.naics.length > 0 ? (
                  <p className="mt-1 text-sm text-slate-600">NAICS: {row.naics.slice(0, 3).join(" · ")}</p>
                ) : null}
                <a
                  href={row.sourceUrl ?? payload?.sourceUrl ?? SUBNET_SOURCE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-sm font-semibold text-blue-700 hover:underline"
                >
                  Read the SBA {payload?.fy ?? "annual"} directory on sba.gov →
                </a>
              </li>
            ))}
          </ul>
          {loading ? <p className="mt-3 text-sm text-slate-500">Loading the directory…</p> : null}
          {rows.length === 0 && !loading ? (
            <p className="mt-3 text-sm text-slate-600">
              No company in the stored SBA {payload?.fy ?? "annual"} file matches these filters.
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={GHOST_BUTTON_CLASS}
              disabled={page <= 1 || loading}
              onClick={() => onPage(page - 1)}
            >
              ← Previous
            </button>
            <button
              type="button"
              className={GHOST_BUTTON_CLASS}
              disabled={!payload?.hasMore || loading}
              onClick={() => onPage(page + 1)}
            >
              Next →
            </button>
            <span className="text-sm text-slate-600">
              {rows.length > 0 ? `Showing ${from}–${to} of ${payload?.counts.filtered ?? 0}` : ""}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function SubcontractsPage() {
  const [data, setData] = useState<SubcontractsResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [trade, setTrade] = useState("");
  const [state, setState] = useState("");

  const [primes, setPrimes] = useState<PrimesPayload | null>(null);
  const [primesUnavailable, setPrimesUnavailable] = useState<string | null>(null);
  const [primesLoading, setPrimesLoading] = useState(true);
  const [primeNaics, setPrimeNaics] = useState("");
  const [primeState, setPrimeState] = useState("");
  const [primePage, setPrimePage] = useState(1);

  const seenNotices = useRef<Set<string>>(new Set());

  // subcontracts_page_viewed — no label; the page IS the subject. Once per mount.
  useEffect(() => {
    trackSubcontractsEvent(SUBCONTRACTS_EVENTS.pageViewed);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/subcontracts", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((payload: SubcontractsResponse) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The prime directory is a SEPARATE read, filtered and paged on the server.
  useEffect(() => {
    let cancelled = false;
    setPrimesLoading(true);
    const params = new URLSearchParams({ page: String(primePage), limit: String(PRIMES_DEFAULT_LIMIT) });
    if (primeNaics) params.set("naics", primeNaics);
    if (primeState) params.set("state", primeState);
    fetch(`/api/subcontracts/primes?${params.toString()}`, { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((payload: PrimesResponse) => {
        if (cancelled) return;
        if (isUnavailable(payload)) {
          setPrimes(null);
          setPrimesUnavailable(payload.unavailable.reason);
        } else {
          setPrimes(payload);
          setPrimesUnavailable(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPrimes(null);
          setPrimesUnavailable(
            "Contrax could not read the stored directory (the request failed). Nothing is shown rather than a partial list.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPrimesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [primeNaics, primeState, primePage]);

  const onNoticeSeen = useCallback((externalId: string) => {
    if (shouldFireNoticeView(seenNotices.current, externalId)) {
      trackSubcontractsEvent(SUBCONTRACTS_EVENTS.noticeViewed, externalId);
    }
  }, []);

  const openRows = useMemo(() => {
    if (!data || isUnavailable(data)) return [];
    return withinClosingDay(data.rows, easternDate());
  }, [data]);

  const trades = useMemo(() => {
    const values = new Set<string>();
    for (const row of openRows) for (const value of row.trades) values.add(value);
    return [...values].sort();
  }, [openRows]);

  const states = useMemo(() => {
    const values = new Set<string>();
    for (const row of openRows) if (row.stateCode) values.add(row.stateCode);
    return [...values].sort();
  }, [openRows]);

  const shown = useMemo(
    () =>
      openRows.filter(
        (row) => (!trade || row.trades.includes(trade)) && (!state || row.stateCode === state),
      ),
    [openRows, trade, state],
  );

  const payload = data && !isUnavailable(data) ? data : null;
  const unavailable = data && isUnavailable(data) ? data.unavailable : null;
  const freshness = payload ? checkedAtText(payload.coverage.lastSyncAt) : null;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-5 py-9">
        <nav className="flex items-center justify-between gap-4 text-sm">
          <a href="/radar" className="font-semibold text-blue-700 hover:underline">
            ← Contract Radar
          </a>
          <a href="/" className="font-semibold text-slate-600 hover:underline">
            Contrax
          </a>
        </nav>

        <div className="mt-9 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Prime contractor opportunities</p>
          <h1 className="mt-2 text-3xl font-bold">Subcontracting opportunities</h1>
          <p className="mt-3 text-slate-600">
            Notices where a named prime is seeking bids or quotes from other businesses. You would respond to the
            prime contractor, not bid to the government agency.
          </p>
          <p className="mt-3 text-sm text-slate-500" data-testid="subcontracts-freshness">
            Source: {SUBNET_SOURCE_LABEL} · {LAST_CHECKED_LABEL} {freshness ?? "—"} ·{" "}
            {payload ? noticeCountText(payload.counts.total) : "reading the stored notices"}
          </p>
        </div>

        {loadFailed ? (
          <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-lg font-bold text-amber-900">Subcontracting notices are not available right now</h2>
            <p className="mt-2 text-sm text-amber-900">
              The request for the stored notices did not complete, so Contrax is showing nothing rather than an empty or
              unverified list.
            </p>
            <a
              href={SUBNET_SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block font-semibold text-blue-700 underline"
            >
              Browse SBA SUBNet directly →
            </a>
          </section>
        ) : null}

        {unavailable ? (
          <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-lg font-bold text-amber-900">Subcontracting notices are not available right now</h2>
            <p className="mt-2 text-sm text-amber-900">{unavailable.reason}</p>
            <p className="mt-2 text-sm text-amber-900">{unavailable.explanation}</p>
            <a
              href={unavailable.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block font-semibold text-blue-700 underline"
            >
              Browse SBA SUBNet directly →
            </a>
          </section>
        ) : null}

        {!data && !loadFailed ? (
          <p className="mt-8 text-sm text-slate-500">Reading the stored SBA SUBNet notices…</p>
        ) : null}

        {payload ? (
          <>
            <div className="mt-8 flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <label className={LABEL_CLASS} htmlFor="subcontract-trade">
                Trade
                <select
                  id="subcontract-trade"
                  value={trade}
                  onChange={(event) => setTrade(event.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">All listed trades</option>
                  {trades.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL_CLASS} htmlFor="subcontract-state">
                State
                <select
                  id="subcontract-state"
                  value={state}
                  onChange={(event) => setState(event.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">All listed states</option>
                  {states.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="mt-4 text-sm font-semibold text-slate-700" data-testid="subcontracts-excluded">
              {payload.coverage.excludedText}{" "}
              <span className="font-normal text-slate-500">
                (notices {SUBNET_SOURCE_LABEL} carries with no closing date stated stay out of the open list and out
                of its counts — they are never shown as open)
              </span>
            </p>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-lg font-semibold">
                {noticeCountText(shown.length)} {shown.length === 1 ? "matches" : "match"} the current filters
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Counted from the notices Contrax last checked ({payload.coverage.source}, tier{" "}
                {payload.coverage.tier}) — a filter can only ever return fewer than the stored open set.
              </p>
              <p className="mt-3 max-w-3xl text-sm text-slate-600">{SUBNET_POSTING_BOARD_SENTENCE}</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <CountList
                  title="Open notices by state"
                  buckets={payload.counts.byState}
                  emptyLabel="No open notices are stored."
                />
                <CountList
                  title="Open notices by listed trade"
                  buckets={payload.counts.byTrade}
                  emptyLabel="No open notices are stored."
                />
              </div>
            </div>

            <div className="mt-4 grid gap-4">
              {shown.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
                  No currently open notice matches these filters.{" "}
                  <a
                    href={SUBNET_SOURCE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-blue-700 underline"
                  >
                    Browse SBA SUBNet directly
                  </a>
                  .
                </div>
              ) : null}
              {shown.map((notice) => (
                <NoticeCard key={notice.externalId} notice={notice} onSeen={onNoticeSeen} />
              ))}
            </div>
          </>
        ) : null}

        <PrimeDirectory
          payload={primes}
          unavailableReason={primesUnavailable}
          loading={primesLoading}
          naics={primeNaics}
          state={primeState}
          page={primePage}
          onFilter={(next) => {
            if (next.naics !== undefined) setPrimeNaics(next.naics);
            if (next.state !== undefined) setPrimeState(next.state);
            setPrimePage(1);
          }}
          onPage={(next) => setPrimePage(next)}
        />

        <section className="mt-10 max-w-3xl">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
            What this page does and does not do
          </h2>
          <ul className="mt-3 grid list-disc gap-2 pl-5 text-xs text-slate-500">
            <li>
              {SUBNET_SOURCE_LABEL} publishes no API, no feed and no export — Contrax reads the board&rsquo;s own pages,
              so this list can be up to one daily check old.
            </li>
            <li>
              The board publishes no posted or updated date. The only freshness Contrax can report is when Contrax last
              checked, which is what every timestamp above shows.
            </li>
            <li>
              Contact details are the prime&rsquo;s own and can be stale or wrong — always check the original notice.
            </li>
            <li>
              Files attached to a notice are linked by the source and never copied onto Contrax.
            </li>
          </ul>
        </section>

        <p className="mt-8 text-xs text-slate-500">
          Listings may change or close early. This page shows the {SUBNET_SOURCE_LABEL} notices Contrax had last
          checked, not every subcontracting opportunity that exists. Link clicks indicate interest, not that the prime
          received a response. Contrax does not submit bids on your behalf.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Verify requirements at the original notice before responding.
        </p>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/subcontracts")({
  component: SubcontractsPage,
  head: () => ({
    meta: [
      { title: "Subcontracting opportunities | Contrax" },
      {
        name: "description",
        content:
          "Prime contractor subcontracting notices Contrax last checked from SBA SUBNet, with the source's own closing dates, listed scopes and certs solicited — plus the annual SBA FY24 prime directory to approach. Verify requirements at the original notice.",
      },
    ],
  }),
});
