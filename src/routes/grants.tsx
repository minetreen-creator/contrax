import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { openGrantsPortal, redirectToGrantsCheckout } from "~/lib/checkout";
import { GRANTS_EVENTS, trackGrantsEvent } from "~/lib/grants-analytics";
import {
  APPLICANT_TYPES,
  AGENCIES,
  FUNDING_CATEGORIES,
  GRANTS_ORG_NOTICE,
  GRANTS_PRICE_LABEL,
  GRANTS_SOURCE_LABEL,
  GRANT_DERIVED_LABELS,
  MAX_KEYWORD_LENGTH,
  MAX_PAGE,
  NOT_SPECIFIED,
  PAGE_SIZE,
  PREVIEW_LIMIT,
  SOURCE_LAST_UPDATED_NOT_CHECKED,
  SOURCE_LAST_UPDATED_NOT_PUBLISHED,
  describeGrantCount,
  grantDeadlineDisplay,
  grantsCheckoutToastVisible,
  type GrantDerivedStatus,
  type GrantResult,
  type GrantsStatus,
} from "~/lib/grants";

/**
 * Contrax Grants — public grant finder (owner order 2026-09-16).
 *
 * V1 scope, deliberately small and ISOLATED: a live keyword/enum search over the
 * official Grants.gov web service, rendered honestly. No grant-writing tools, no
 * foundation-grant ingestion, no recommendations, no alerts, no onboarding
 * changes. Nothing on this page touches Radar matching, bids/solicitations, the
 * pricing tiers, or the frozen conversion funnel.
 *
 * The page NEVER calls Grants.gov itself — it only calls our own
 * /api/grants/search (server-side proxy). Everything displayed comes from that
 * response, which comes from the source: a field the source did not supply shows
 * "Not specified" and nothing is inferred, estimated, or invented. Results are
 * "potential matches" (eligibility is shown exactly as Grants.gov lists it), and
 * every card carries the Grants.gov source label and the official opportunity
 * link.
 *
 * CLIENT-SIDE GUARDS (defence in depth — the SERVER is the authority):
 *   - the anonymous single-search cap (`contrax_grants_used` in sessionStorage)
 *     blocks a second search in the browser before any request is made;
 *   - the 3-card preview cap is applied to whatever the API returns;
 *   - every fetch aborts at CLIENT_TIMEOUT_MS (20s) with a visible countdown, so
 *     the loading state can never become an endless loader.
 *
 * ANALYTICS: the six isolated grants_* events only (src/lib/grants-analytics.ts)
 * — never a Radar funnel stage.
 */

const CLIENT_TIMEOUT_MS = 20_000;
const ANON_USED_KEY = "contrax_grants_used";
const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";
const LABEL_CLASS = "mb-1.5 block text-sm font-semibold text-slate-800";

export const Route = createFileRoute("/grants")({
  head: () => ({
    meta: [
      { title: "Contrax Grants — Find Federal Grants Your Organization Qualifies For" },
      {
        name: "description",
        content:
          "Search live federal grant opportunities from Grants.gov by keyword, applicant type, funding category, and agency. Real funding amounts, real deadlines, real eligibility — straight from the source.",
      },
    ],
  }),
  component: GrantsPage,
});

interface SearchResponse {
  ok?: boolean;
  error?: string;
  source?: string;
  /** Which status filter this response answers (server echo). */
  status?: GrantsStatus;
  authenticated?: boolean;
  /** True only with a granted ($19/month) Stripe subscription (server-written). */
  subscribed?: boolean;
  requiresAuth?: boolean;
  message?: string;
  /** Honest count for the active filter (for Open: posted AND not yet due). */
  totalCount?: number;
  /** False when totalCount is a lower bound ("N+"), never a confirmed total. */
  countExact?: boolean;
  /** Server timestamp of the upstream search this response came from. */
  asOf?: string;
  /** Rows the source returned that we deliberately do not show as open. */
  excluded?: { expiredPosted: number; missingDeadline: number; forecasts: number | null };
  page?: number;
  pageSize?: number;
  maxPage?: number;
  hasMore?: boolean;
  lockedCount?: number;
  previewLimit?: number;
  upgradePromptEnabled?: boolean;
  upgradePrice?: string;
  notice?: string;
  results?: GrantResult[];
}

interface Filters {
  keyword: string;
  applicantType: string;
  fundingCategory: string;
  agency: string;
  status: GrantsStatus;
}

/** Card accent per derived status — the badge text is the source-truthful label. */
const DERIVED_BADGE_CLASS: Record<GrantDerivedStatus, string> = {
  open: "border-emerald-200 bg-emerald-50 text-emerald-800",
  forecast: "border-sky-200 bg-sky-50 text-sky-800",
  closed: "border-slate-200 bg-slate-50 text-slate-600",
  expired: "border-amber-200 bg-amber-50 text-amber-800",
  unconfirmed: "border-slate-200 bg-white text-slate-500",
};

/** "Sep 18, 2026, 1:42 PM" for the server's as-of timestamp (client-rendered). */
function asOfText(asOf: string | undefined): string {
  if (!asOf) return "";
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type Phase = "initial" | "loading" | "results" | "empty" | "error" | "wall";

function GrantsPage() {
  const [filters, setFilters] = useState<Filters>({
    keyword: "",
    applicantType: "",
    fundingCategory: "",
    agency: "",
    status: "open",
  });
  const [phase, setPhase] = useState<Phase>("initial");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [results, setResults] = useState<GrantResult[]>([]);
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [anonUsed, setAnonUsed] = useState(false);
  // Grants entitlement (server-written by Stripe webhooks). The ?checkout=success
  // parameter NEVER grants access — it only drives the toast below, and only for
  // a visitor the server already reports as subscribed (grantsCheckoutToastVisible).
  const [subscribed, setSubscribed] = useState(false);
  /** True only when the success toast may honestly be shown (subscribed). */
  const [checkoutDone, setCheckoutDone] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const tickRef = useRef<number | null>(null);
  const requestSeq = useRef(0);
  const viewedFired = useRef(false);

  // ── grants_page_viewed (once per mount, ref-guarded like every other page) ──
  useEffect(() => {
    if (viewedFired.current) return;
    viewedFired.current = true;
    trackGrantsEvent(GRANTS_EVENTS.pageViewed, "grants_page");
  }, []);

  // ── Client-side anonymous cap + signed-in detection + entitlement ──────────
  useEffect(() => {
    try {
      if (sessionStorage.getItem(ANON_USED_KEY) === "1") setAnonUsed(true);
    } catch {
      /* sessionStorage can throw (private mode) — the server cap still holds */
    }
    // ?checkout=success is a TOAST ONLY — access comes from the server-written
    // subscription status, never from this parameter. Anyone can put the param
    // on the URL, so the toast is decided ONLY after the subscription read
    // resolves (grantsCheckoutToastVisible) — a visitor who did not actually
    // subscribe gets the param stripped and no claim made about them.
    let checkoutParam: string | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("checkout") === "success") {
        checkoutParam = "success";
        params.delete("checkout");
        const qs = params.toString();
        window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
      }
    } catch {
      /* history/URL unavailable — the toast is decorative */
    }
    let cancelled = false;
    fetch("/api/auth/me", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setAuthenticated(Boolean(d && d.id));
      })
      .catch(() => {
        /* anonymous by default — never block the page on this */
      });
    fetch("/api/grants/subscription", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const isSubscribed = Boolean(d && d.subscribed);
        setSubscribed(isSubscribed);
        // Honest by construction: no subscription → no "you're set up" toast.
        setCheckoutDone(grantsCheckoutToastVisible({ checkoutParam, subscribed: isSubscribed }));
      })
      .catch(() => {
        /* treat as not subscribed; the search API is authoritative */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearTimers = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const runSearch = useCallback(
    async (page: number, mode: "new" | "more") => {
      // Client-side cap: a visitor without a granted subscription gets the one
      // free search enforced here first (the server enforces it authoritatively).
      if (!subscribed && anonUsed && mode === "new") {
        setPhase("wall");
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      // Only the newest request may write state — an in-flight request that gets
      // superseded (new search / another Load more) must not overwrite it.
      const requestId = (requestSeq.current += 1);
      const isStale = () => requestSeq.current !== requestId;
      clearTimers();
      setError("");
      setLoadingMore(mode === "more");
      setPhase("loading");
      setSecondsLeft(Math.ceil(CLIENT_TIMEOUT_MS / 1000));

      const startedAt = Date.now();
      tickRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        setSecondsLeft(Math.max(0, Math.ceil((CLIENT_TIMEOUT_MS - elapsed) / 1000)));
      }, 1000);
      // Client-side timeout protection: abort at 20s and fall into the error
      // state with a retry — never an endless loader.
      const timeoutId = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

      const qs = new URLSearchParams();
      if (filters.keyword.trim()) qs.set("keyword", filters.keyword.trim().slice(0, MAX_KEYWORD_LENGTH));
      if (filters.applicantType) qs.set("applicantType", filters.applicantType);
      if (filters.fundingCategory) qs.set("fundingCategory", filters.fundingCategory);
      if (filters.agency) qs.set("agency", filters.agency);
      qs.set("status", filters.status);
      qs.set("page", String(page));

      if (mode === "new") {
        trackGrantsEvent(GRANTS_EVENTS.searchStarted, `status_${filters.status}`);
      }

      try {
        const res = await fetch(`/api/grants/search?${qs.toString()}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const body = (await res.json().catch(() => null)) as SearchResponse | null;
        if (isStale()) return;
        if (!res.ok || !body || body.ok !== true) {
          const message =
            body?.error ||
            (res.status === 429
              ? "Too many searches right now. Please try again in a little while."
              : "Something went wrong reaching the grant search. Please try again.");
          setPhase("error");
          setError(message);
          trackGrantsEvent(GRANTS_EVENTS.searchFailed, `http_${res.status}`);
          return;
        }
        if (body.requiresAuth) {
          // Server-side backstop for the anonymous single-search cap.
          setAnonUsed(true);
          try {
            sessionStorage.setItem(ANON_USED_KEY, "1");
          } catch {
            /* non-fatal */
          }
          setData(body);
          setResults([]);
          setPhase("wall");
          return;
        }
        const incoming = body.results ?? [];
        // Belt + braces preview cap (the API already applied it server-side).
        const capped = subscribed ? incoming : incoming.slice(0, PREVIEW_LIMIT);
        if (typeof body.subscribed === "boolean") setSubscribed(body.subscribed);
        setData(body);
        setResults((prev) => (mode === "more" ? [...prev, ...capped] : capped));
        // A "Load more" page can legitimately come back empty (the Open tab drops
        // rows the source has expired or published without a deadline): keep the
        // results the visitor already has instead of claiming nothing matched.
        setPhase(mode === "more" && capped.length === 0 ? "results" : capped.length === 0 ? "empty" : "results");
        if (!authenticated) {
          setAnonUsed(true);
          try {
            sessionStorage.setItem(ANON_USED_KEY, "1");
          } catch {
            /* non-fatal */
          }
        }
        trackGrantsEvent(
          GRANTS_EVENTS.searchCompleted,
          `${mode === "more" ? `more_page_${page}` : "page_1"}_${capped.length}_of_${body.totalCount ?? capped.length}`,
        );
      } catch (e) {
        if (isStale()) return;
        // Abort (client timeout or a superseded request) lands here too.
        const aborted = e instanceof Error && e.name === "AbortError";
        setPhase("error");
        setError(
          aborted
            ? "Grants.gov took too long to respond. Please try again."
            : "We couldn't reach the grant search. Check your connection and try again.",
        );
        trackGrantsEvent(GRANTS_EVENTS.searchFailed, aborted ? "client_timeout" : "network_error");
      } finally {
        window.clearTimeout(timeoutId);
        if (!isStale()) {
          clearTimers();
          setLoadingMore(false);
        }
      }
    },
    [authenticated, anonUsed, clearTimers, filters],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase === "loading") return;
    void runSearch(1, "new");
  }

  function onOfficialOpen(result: GrantResult) {
    trackGrantsEvent(GRANTS_EVENTS.resultOpened, result.opportunityNumber || "unknown");
  }

  function onUpgradeClick() {
    trackGrantsEvent(GRANTS_EVENTS.upgradeClicked, "grants_page");
  }

  /** Subscribe — $19/month (server-side price; no client input at all). */
  function onSubscribeClick() {
    if (billingBusy) return;
    onUpgradeClick();
    setBillingBusy(true);
    void redirectToGrantsCheckout().finally(() => setBillingBusy(false));
  }

  /** Stripe Customer Portal for an existing subscriber. */
  function onManageClick() {
    if (billingBusy) return;
    setBillingBusy(true);
    void openGrantsPortal().finally(() => setBillingBusy(false));
  }

  const needsSubscription = authenticated && !subscribed;
  const previewOnly = !subscribed;
  const showWall = phase === "wall" || (previewOnly && anonUsed && phase !== "results");
  const upgradeEnabled = data?.upgradePromptEnabled === true;
  const notice = data?.notice ?? GRANTS_ORG_NOTICE;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <a href="/" className="inline-flex items-center gap-2">
            <img src="/logo.png" alt="Contrax" className="h-8 w-auto" />
          </a>
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-700">
              Dashboard
            </a>
            {subscribed && (
              <button
                type="button"
                onClick={onManageClick}
                disabled={billingBusy}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold whitespace-nowrap text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                Manage subscription
              </button>
            )}
            {needsSubscription && upgradeEnabled && (
              <button
                type="button"
                onClick={onSubscribeClick}
                disabled={billingBusy}
                className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold whitespace-nowrap text-slate-900 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-200"
              >
                {billingBusy ? "Opening…" : `Subscribe — ${GRANTS_PRICE_LABEL}`}
              </button>
            )}
            {!authenticated && (
              <a
                href="/signup?next=/grants"
                className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold whitespace-nowrap text-slate-900 transition-colors hover:bg-amber-300"
              >
                Create free account
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* checkoutDone is only ever set when the server-written subscription
            status is granted (grantsCheckoutToastVisible) — a URL fiddler who
            never paid is never told a subscription is set up. */}
        {checkoutDone && (
          <div
            role="status"
            className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4"
          >
            <p className="text-sm font-semibold text-emerald-900">
              Thanks — your Contrax Grants subscription is set up.
            </p>
            <button
              type="button"
              onClick={() => setCheckoutDone(false)}
              className="text-xs font-semibold text-emerald-800 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900">Contrax Grants</h1>
          <p className="mt-2 text-lg text-slate-500">
            Find grants your organization actually qualifies for.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm">
            Contrax Grants — {GRANTS_PRICE_LABEL}
            <span className="text-xs font-medium text-slate-500">
              {subscribed
                ? "Active — full results and unlimited searches."
                : upgradeEnabled
                  ? "Search is free — subscribe for the full workspace."
                  : "Coming soon"}
            </span>
          </p>
          <p className="mt-3 max-w-3xl text-xs text-slate-500">{notice}</p>
        </div>

        {/* ── Search controls ── */}
        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <div>
            <label htmlFor="grants-keyword" className={LABEL_CLASS}>
              Keyword
            </label>
            <input
              id="grants-keyword"
              type="text"
              value={filters.keyword}
              onChange={(e) => setFilters((f) => ({ ...f, keyword: e.target.value }))}
              maxLength={MAX_KEYWORD_LENGTH}
              placeholder="e.g. workforce training, water infrastructure, health equity"
              className={INPUT_CLASS}
            />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="grants-applicant" className={LABEL_CLASS}>
                Applicant type
              </label>
              <select
                id="grants-applicant"
                value={filters.applicantType}
                onChange={(e) => setFilters((f) => ({ ...f, applicantType: e.target.value }))}
                className={INPUT_CLASS}
              >
                <option value="">Any applicant type</option>
                {APPLICANT_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="grants-category" className={LABEL_CLASS}>
                Funding category
              </label>
              <select
                id="grants-category"
                value={filters.fundingCategory}
                onChange={(e) => setFilters((f) => ({ ...f, fundingCategory: e.target.value }))}
                className={INPUT_CLASS}
              >
                <option value="">Any funding category</option>
                {FUNDING_CATEGORIES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="grants-agency" className={LABEL_CLASS}>
                Agency
              </label>
              <select
                id="grants-agency"
                value={filters.agency}
                onChange={(e) => setFilters((f) => ({ ...f, agency: e.target.value }))}
                className={INPUT_CLASS}
              >
                <option value="">Any agency</option>
                {AGENCIES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="grants-status" className={LABEL_CLASS}>
                Status
              </label>
              <select
                id="grants-status"
                value={filters.status}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    status:
                      e.target.value === "closed"
                        ? "closed"
                        : e.target.value === "forecast"
                          ? "forecast"
                          : "open",
                  }))
                }
                className={INPUT_CLASS}
              >
                <option value="open">Open — accepting applications</option>
                <option value="forecast">Forecast — announced, not yet open</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={phase === "loading" || (!authenticated && anonUsed)}
              className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {phase === "loading" ? "Searching…" : "Search grants"}
            </button>
            {!authenticated && anonUsed && (
              <span className="text-xs text-slate-500">
                Your free search is used — create a free account to search again.
              </span>
            )}
          </div>
        </form>

        {/* ── States ── */}
        {phase === "initial" && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            <p className="font-semibold text-slate-900">Search live federal grants.</p>
            <p className="mt-1">
              Every result comes straight from {GRANTS_SOURCE_LABEL}: real titles, real agencies, real posted and
              closing dates. Where the source publishes no funding amount or eligibility list, we say{" "}
              <span className="font-medium text-slate-800">“{NOT_SPECIFIED}”</span> instead of guessing.
            </p>
            {!authenticated && (
              <p className="mt-2 text-xs text-slate-500">
                Your first search is free and shows up to {PREVIEW_LIMIT} potential matches. Create a free account to
                see full results and keep searching.
              </p>
            )}
          </div>
        )}

        {phase === "loading" && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="flex items-center gap-3 text-sm font-semibold text-slate-900">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
              {loadingMore ? "Loading more grants…" : "Searching Grants.gov…"}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {secondsLeft > 0
                ? `This usually takes a few seconds. Giving up in ${secondsLeft}s if Grants.gov doesn't respond.`
                : "Still waiting on Grants.gov…"}
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
            <p className="text-sm font-semibold text-rose-900">We couldn't finish that search</p>
            <p className="mt-1 text-sm text-rose-800">{error}</p>
            <button
              type="button"
              onClick={() => void runSearch(1, "new")}
              className="mt-4 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500"
            >
              Try again
            </button>
          </div>
        )}

        {phase === "empty" && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">No grants match — try broadening</p>
            <p className="mt-1 text-sm text-slate-600">
              Try fewer words in the keyword box, or set applicant type, funding category, agency, and status back to
              their widest option.
            </p>
          </div>
        )}

        {showWall && (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <p className="text-sm font-semibold text-amber-900">
              {needsSubscription ? "Subscribe to keep searching" : "Create a free account to keep searching"}
            </p>
            <p className="mt-1 text-sm text-amber-900">
              {data?.message ??
                (needsSubscription
                  ? `You've used your free grant search. Contrax Grants (${GRANTS_PRICE_LABEL}) unlocks the full result list, every page, and unlimited searches.`
                  : "You've used your free grant search. A free Contrax account unlocks full grant results and unlimited searches.")}
            </p>
            {needsSubscription ? (
              upgradeEnabled ? (
                <button
                  type="button"
                  onClick={onSubscribeClick}
                  disabled={billingBusy}
                  className="mt-4 inline-flex items-center rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-200"
                >
                  {billingBusy ? "Opening…" : `Subscribe — ${GRANTS_PRICE_LABEL}`}
                </button>
              ) : (
                <a
                  href="/pricing"
                  onClick={onUpgradeClick}
                  className="mt-4 inline-flex items-center rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-300"
                >
                  See the plan
                </a>
              )
            ) : (
              <a
                href="/signup?next=/grants"
                className="mt-4 inline-flex items-center rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-300"
              >
                Create free account
              </a>
            )}
          </div>
        )}

        {phase === "results" && (
          <div className="mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold text-slate-900">
                {data?.status === "forecast"
                  ? "Forecasted opportunities"
                  : data?.status === "closed"
                    ? "Closed opportunities"
                    : "Potential matches"}
              </h2>
              <p className="text-xs text-slate-500">
                {typeof data?.totalCount === "number"
                  ? describeGrantCount(
                      data.status ?? filters.status,
                      data.totalCount,
                      data.countExact !== false,
                    )
                  : "Results from Grants.gov"}
              </p>
            </div>
            {/* Results-level freshness — a separate field from each card's own
                "Source last updated" below. */}
            {asOfText(data?.asOf) && (
              <p className="mt-1 text-xs text-slate-500">
                Data as of <span className="font-medium text-slate-700">{asOfText(data?.asOf)}</span> —{" "}
                {GRANTS_SOURCE_LABEL} was searched for this result set.
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Eligibility is shown exactly as {GRANTS_SOURCE_LABEL} lists it — confirm it in the official notice
              before you apply.
            </p>
            {data?.excluded && data.status === "open" && (
              <p className="mt-1 text-xs text-slate-500">
                Not counted as open:{" "}
                {[
                  // Only stated when the source's own forecasted total was
                  // retrieved — an unknown figure is omitted, never shown as 0.
                  ...(typeof data.excluded.forecasts === "number"
                    ? [
                        `${data.excluded.forecasts.toLocaleString("en-US")} forecasted (see the Forecast filter)`,
                      ]
                    : []),
                  `${data.excluded.expiredPosted.toLocaleString("en-US")} past deadline`,
                  `${data.excluded.missingDeadline.toLocaleString("en-US")} posted without a published deadline`,
                ].join(", ")}
                .
              </p>
            )}

            <div className="mt-4 space-y-4">
              {results.map((r, i) => (
                <article
                  key={`${r.id}-${i}`}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-base font-bold text-slate-900">{r.title}</h3>
                    <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                          DERIVED_BADGE_CLASS[r.derivedStatus]
                        }`}
                      >
                        {GRANT_DERIVED_LABELS[r.derivedStatus]}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500">
                        Source: {GRANTS_SOURCE_LABEL}
                      </span>
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{r.agency}</p>
                  {r.derivedStatus === "forecast" && r.estimatedDeadlinePassed && (
                    <p className="mt-2 text-xs font-medium text-sky-900">
                      {GRANTS_SOURCE_LABEL} still lists this as a forecast — its estimated date has passed, and it
                      has not been posted as an open opportunity.
                    </p>
                  )}
                  <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="font-semibold text-slate-500">Opportunity number</dt>
                      <dd className="text-slate-800">{r.opportunityNumber || NOT_SPECIFIED}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Status</dt>
                      <dd className="text-slate-800">{GRANT_DERIVED_LABELS[r.derivedStatus]}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Posted date</dt>
                      <dd className="text-slate-800">{r.postedDate ?? NOT_SPECIFIED}</dd>
                    </div>
                    {/* Exactly one date row, chosen so an estimated date can never
                        be presented as a closing date (grantDeadlineDisplay). */}
                    {(() => {
                      const deadline = grantDeadlineDisplay(r);
                      if (!deadline) return null;
                      return (
                        <div>
                          <dt className="font-semibold text-slate-500">{deadline.label}</dt>
                          <dd className="text-slate-800">{deadline.value}</dd>
                        </div>
                      );
                    })()}
                    <div>
                      <dt className="font-semibold text-slate-500">Estimated funding</dt>
                      <dd className="text-slate-800">{r.estimatedFunding ?? NOT_SPECIFIED}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Source last updated</dt>
                      <dd className="text-slate-800">
                        {r.sourceLastUpdated ??
                          (r.sourceLastUpdatedKnown
                            ? SOURCE_LAST_UPDATED_NOT_PUBLISHED
                            : SOURCE_LAST_UPDATED_NOT_CHECKED)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-slate-500">Eligible applicants</p>
                    {r.eligibleApplicants.length > 0 ? (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {r.eligibleApplicants.map((a) => (
                          <li
                            key={a}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700"
                          >
                            {a}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-slate-700">{NOT_SPECIFIED}</p>
                    )}
                  </div>
                  {r.description && (
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">{r.description}</p>
                  )}
                  <div className="mt-4">
                    {r.officialUrl ? (
                      <a
                        href={r.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => onOfficialOpen(r)}
                        className="inline-flex items-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                      >
                        View official grant
                      </a>
                    ) : (
                      <span className="text-xs text-slate-500">
                        Official {GRANTS_SOURCE_LABEL} link unavailable for this opportunity.
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>

            {previewOnly && (
              <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="text-sm font-semibold text-amber-900">
                  {typeof data?.lockedCount === "number" && data.lockedCount > 0
                    ? `${data.lockedCount.toLocaleString("en-US")} more matching ${
                        data.lockedCount === 1 ? "opportunity" : "opportunities"
                      } ${needsSubscription ? "need a Contrax Grants subscription" : "need a free account"}`
                    : needsSubscription
                      ? `Subscribe to Contrax Grants (${GRANTS_PRICE_LABEL}) for full results`
                      : "Create a free account for full grant results"}
                </p>
                <p className="mt-1 text-sm text-amber-900">
                  {needsSubscription
                    ? `You're seeing the first ${PREVIEW_LIMIT} previews. A ${GRANTS_PRICE_LABEL} Contrax Grants subscription unlocks the full result list, every page, and unlimited searches.`
                    : `You're seeing the first ${PREVIEW_LIMIT} previews. A free Contrax account unlocks the full result list, every page, and unlimited searches.`}
                </p>
                {needsSubscription ? (
                  upgradeEnabled ? (
                    <button
                      type="button"
                      onClick={onSubscribeClick}
                      disabled={billingBusy}
                      className="mt-4 inline-flex items-center rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-200"
                    >
                      {billingBusy ? "Opening…" : `Subscribe — ${GRANTS_PRICE_LABEL}`}
                    </button>
                  ) : (
                    <a
                      href="/pricing"
                      onClick={onUpgradeClick}
                      className="mt-4 inline-flex items-center rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-300"
                    >
                      See the plan
                    </a>
                  )
                ) : (
                  <a
                    href="/signup?next=/grants"
                    className="mt-4 inline-flex items-center rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-300"
                  >
                    Create free account
                  </a>
                )}
              </div>
            )}

            {subscribed && data?.hasMore && (
              <div className="mt-5">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void runSearch((data?.page ?? 1) + 1, "more")}
                  className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  {loadingMore ? "Loading…" : "Load more grants"}
                </button>
                <p className="mt-2 text-xs text-slate-500">
                  Page {data?.page ?? 1} of {data?.maxPage ?? MAX_PAGE} · {PAGE_SIZE} results per page
                </p>
              </div>
            )}

            {subscribed && !data?.hasMore && (data?.totalCount ?? 0) > PAGE_SIZE * (data?.page ?? 1) && (
              <p className="mt-4 text-xs text-slate-500">
                Showing the first {PAGE_SIZE * (data?.page ?? 1)} of {(data?.totalCount ?? 0).toLocaleString("en-US")}{" "}
                matches — the {MAX_PAGE}-page cap keeps live searches fast.
              </p>
            )}

            {upgradeEnabled && needsSubscription && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-900">
                  Contrax Grants — {GRANTS_PRICE_LABEL}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Full result lists, every page, and unlimited searches — billed monthly, cancel any time.
                </p>
                <button
                  type="button"
                  onClick={onSubscribeClick}
                  disabled={billingBusy}
                  className="mt-3 inline-flex items-center rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-200"
                >
                  {billingBusy ? "Opening…" : `Subscribe — ${GRANTS_PRICE_LABEL}`}
                </button>
              </div>
            )}

            {subscribed && (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-900">
                  Contrax Grants — {GRANTS_PRICE_LABEL}
                  <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                    Active
                  </span>
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Your subscription renews automatically — update payment details, invoices, or cancel in the
                  Stripe billing portal.
                </p>
                <button
                  type="button"
                  onClick={onManageClick}
                  disabled={billingBusy}
                  className="mt-3 inline-flex items-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  Manage subscription
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
