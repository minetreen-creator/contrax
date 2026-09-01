/**
 * TrialStartCard — R1: the surfaced "start your trial" card on the dashboard.
 *
 * WHY IT EXISTS: a free Basic user who completes onboarding lands on the Basic
 * dashboard with trial_started_at NULL and NO surfaced next step, so the
 * 14-day Professional trial (lazy-start on FIRST PREMIUM ACTION) never gets
 * triggered. This card is that missing step: a prominent, honest surface that
 * routes the user to their first premium action — an AI Executive Brief on
 * their #1 matched bid, via the EXISTING premium brief path
 * (/api/bids/{id}/analyze). Generating that brief runs ensureTrialStarted →
 * flips plan_tier to 'professional' and sets trial_started_at → the
 * TrialChecklist mounts. After the start the card never reappears (its server
 * predicate hides it once the trial is active).
 *
 * HONESTY CONTRACT:
 *   - No credit card, no billing, no "unlimited" anywhere.
 *   - Every number shown is real: 14 days from ~/lib/trial (TRIAL_DAYS),
 *     per-trial caps from TRIAL_CAPS, the target bid from the live `bids`
 *     table (never fabricated), the feed count from the real match query.
 *   - It never claims the trial "expires" before the user starts it; the copy
 *     truthfully says the clock starts on their first Professional action.
 *   - If a clicked bid already has a brief on file (cached), viewing is free
 *     and does NOT start the trial — the card says so honestly instead of
 *     implying the trial started.
 *
 * PURELY ADDITIVE: does not modify ~/lib/trial.ts / trial-usage.ts, the
 * TrialChecklist, the SavedRadarMatches banner, radar free matches, or pricing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createServerFn } from "@tanstack/react-start";
import { getCurrentUser } from "~/lib/auth";
import {
  TRIAL_START_COPY,
  loadTrialStartCardData,
  type TrialStartCardData,
  type TrialStartCandidate,
} from "~/lib/trial-start-card";
import { trackEvent } from "~/lib/track";

/** Server context — same predicate the dry-run tests (lib) + auth guard. */
const loadTrialStartCard = createServerFn({ method: "GET" }).handler(
  async (): Promise<TrialStartCardData> => {
    const user = await getCurrentUser();
    if (!user) return { show: false, reason: "logged-out", candidates: [], totalMatches: 0 };
    // Fail-closed: any load error hides the card quietly (non-critical UI).
    try {
      return await loadTrialStartCardData(user.id, user);
    } catch (e) {
      console.error("[TrialStartCard] context load failed:", e);
      return { show: false, reason: "load-error", candidates: [], totalMatches: 0 };
    }
  },
);

const fmtDue = (d: string | null): string =>
  d
    ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";

interface AnalyzeResponse {
  data?: unknown;
  cached?: boolean;
  locked?: boolean;
  trial_locked?: boolean;
  fallback?: boolean;
}

/**
 * The dashboard card. Renders nothing for anyone who shouldn't see it
 * (paid / admin / demo / grant / active-or-expired trial / logged out).
 */
export function TrialStartCard({ onTrialStarted }: { onTrialStarted?: () => void }) {
  const [data, setData] = useState<TrialStartCardData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedNote, setCachedNote] = useState(false);
  const [started, setStarted] = useState(false);
  const onTrialStartedRef = useRef(onTrialStarted);
  onTrialStartedRef.current = onTrialStarted;

  useEffect(() => {
    let active = true;
    loadTrialStartCard()
      .then((d) => {
        if (active) {
          setData(d);
          setIdx(0);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const current: TrialStartCandidate | null =
    data && data.candidates.length > 0 ? data.candidates[Math.min(idx, data.candidates.length - 1)] : null;

  /** The one-click premium action — the EXISTING brief path, which runs
   *  ensureTrialStarted → consumeTrial('briefs') on a real generation. */
  const runFirstBrief = useCallback(async () => {
    if (!current) return;
    setBusy(true);
    setError(null);
    setCachedNote(false);
    try {
      const res = await fetch(`/api/bids/${current.id}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        setError(res.status === 429 ? TRIAL_START_COPY.rateLimited : TRIAL_START_COPY.error);
        return;
      }
      const json = (await res.json()) as AnalyzeResponse;
      // Over-limit states can't occur on a fresh Basic user's first brief
      // (ensureTrialStarted flips to Professional before the allowance read),
      // but handle them honestly rather than pretend the trial started.
      if (json.locked || json.trial_locked) {
        setError(TRIAL_START_COPY.error);
        return;
      }
      if (!json.data) {
        setError(TRIAL_START_COPY.error);
        return;
      }
      // Cached views are FREE and never start the trial — be honest about it.
      if (json.cached === true) {
        setCachedNote(true);
        trackEvent("trial_start_card_cached", String(current.id));
        return;
      }
      // Real generation → trial started (ensureTrialStarted flipped the tier).
      setStarted(true);
      trackEvent("trial_start_card_brief", String(current.id));
      onTrialStartedRef.current?.();
    } catch {
      setError(TRIAL_START_COPY.error);
    } finally {
      setBusy(false);
    }
  }, [current]);

  if (!loaded) return null;
  if (!data?.show) return null;

  const nextCandidate = () => {
    if (data.candidates.length === 0) return;
    setIdx((i) => (i + 1) % data.candidates.length);
    setCachedNote(false);
    setError(null);
  };

  // ── Post-start success panel (this session; next dashboard load hides it —
  //    the server predicate flips to show=false once the trial is active). ──
  if (started && current) {
    return (
      <div className="mb-6 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="inline-flex items-center gap-2 text-sm font-bold text-emerald-900">
              <span aria-hidden="true">✅</span> {TRIAL_START_COPY.started}
            </h2>
            <p className="mt-1 text-[13px] text-emerald-800">
              {TRIAL_START_COPY.startedBody(current.title)}
            </p>
          </div>
          <a
            href={`/bid/${current.id}`}
            className="inline-flex shrink-0 items-center rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-700"
          >
            {TRIAL_START_COPY.startedCta}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-white shadow-sm">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-slate-900">🎁 {TRIAL_START_COPY.heading}</h2>
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-700">
            {TRIAL_START_COPY.badge}
          </span>
        </div>
        <p className="mt-1.5 max-w-2xl text-sm text-slate-600">
          {TRIAL_START_COPY.noCard} {TRIAL_START_COPY.body}
        </p>
        <p className="mt-2 inline-block rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          {TRIAL_START_COPY.whatYouGet}
        </p>

        {current ? (
          <div className="mt-4 rounded-xl border border-blue-100 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Your #1 matched opportunity
            </p>
            <p className="mt-0.5 truncate font-semibold text-slate-900">{current.title}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {current.agency ?? "Federal opportunity"}
              {current.dueDate ? ` · due ${fmtDue(current.dueDate)}` : ""}
              {current.estimatedValue ? ` · ${current.estimatedValue} est.` : ""}
            </p>
            {error && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}
            {cachedNote && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {TRIAL_START_COPY.cachedNote}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runFirstBrief}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98] disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Analyzing…
                  </>
                ) : (
                  <>🚀 {TRIAL_START_COPY.primary}</>
                )}
              </button>
              <span className="text-xs text-slate-500">{TRIAL_START_COPY.primaryHint}</span>
              {cachedNote && data.candidates.length > 1 && (
                <button
                  type="button"
                  onClick={nextCandidate}
                  className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Try my next match →
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-blue-100 bg-white p-4">
            <p className="text-sm font-semibold text-slate-800">{TRIAL_START_COPY.noMatchesTitle}</p>
            <p className="mt-1 text-xs text-slate-500">{TRIAL_START_COPY.noMatchesBody}</p>
            <a
              href="/score"
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              {TRIAL_START_COPY.noMatchesCta}
            </a>
          </div>
        )}
      </div>
      <div className="border-t border-blue-100 bg-white/60 px-5 py-2.5 text-[11px] text-slate-500">
        {TRIAL_START_COPY.endNote}
      </div>
    </div>
  );
}