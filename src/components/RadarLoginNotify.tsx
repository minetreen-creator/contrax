import { useEffect, useState } from "react";
import { agencyDisplay } from "~/lib/bid-job-summary";
import { getRadarSeen, clearRadarSeen, type RadarSeen, type RadarSeenMatch } from "~/lib/radar-session";
import { trackEvent } from "~/lib/track";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";

/**
 * RadarLoginNotify — in-app (NOT email) welcome banner shown on and after login.
 *
 * FN/F-4: the anonymous radar session is remembered entirely in the browser
 * (localStorage). There is NO email capture anywhere in this feature. When the
 * visitor later signs up / logs in and lands on /dashboard, this banner greets
 * them with their radar matches and offers two owner-specified actions:
 *
 *   [Save Top 3 to Pipeline]         persists the top matches to the real
 *                                    saved-bids pipeline (respecting the
 *                                    plan-tier save cap via /api/radar-save-all)
 *   [View Full Solicitation Details] opens the top match's full original
 *                                    solicitation (deep link to SAM.gov)
 *
 * TRUTHFULNESS (owner standard): at banner render nothing has been persisted
 * yet, so the headline does NOT claim "we saved your matches". Instead it says
 * they are "ready to save" and the subtitle makes explicit that the button is
 * what persists them. After the save succeeds we show the truthful confirmation
 * ("Saved N matches…"). Nothing ever claims an action that did not happen.
 *
 * The banner stays until the visitor dismisses it or saves, so it appears "on
 * login and after" across dashboard visits.
 *
 * Owner 2026-11-08: a new member saved a match here and never opened a bid, so
 * never saw the bid page (the $5 button, the red-flag scanner, the incumbent
 * preview). Every match link now opens the bid's own Contrax page, and after a
 * save each saved bid is listed with an "Open this bid" button.
 */
export function RadarLoginNotify() {
  const [seen, setSeen] = useState<RadarSeen | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{
    saved: number;
    total: number;
    limited: boolean;
    limit?: number | null;
    savedIds?: number[];
    error?: boolean;
  } | null>(null);

  useEffect(() => {
    const s = getRadarSeen();
    if (s && s.total > 0 && s.matches.length > 0) {
      setSeen(s);
      trackEvent("radar_login_notify_shown", s.certLabel || s.answers?.cert || "");
    }
  }, []);

  if (!seen) return null;

  const label = seen.certLabel || "Contract Radar";
  const total = seen.matches.length;
  // Matches are stored already-sorted by score (highest first), so the top
  // match is simply the first one.
  const topMatch: RadarSeenMatch | undefined = seen.matches[0];
  const topDetailUrl = topMatch ? bidPageHref(topMatch.id) : null;

  const dismiss = () => {
    clearRadarSeen();
    setSeen(null);
    trackEvent("radar_login_notify_dismiss", label);
  };

  const saveTop3 = async () => {
    if (saving) return;
    setSaving(true);
    // Preserve the legacy save event AND record the owner's "Save Top 3" action.
    trackEvent("radar_login_notify_save", label);
    trackEvent("radar_login_notify_top3", label);
    try {
      const res = await fetch("/api/radar-save-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidIds: seen.matches.map((m) => m.id) }),
      });
      const json = (await res.json().catch(() => null)) as
        | { saved?: number; savedIds?: number[]; total?: number; limited?: boolean; limit?: number | null; error?: string }
        | null;
      if (!res.ok || !json || json.error) {
        setResult({ saved: 0, total, limited: false, error: true });
        return;
      }
      // Saved — clear the browser session so the banner never resurfaces with
      // an empty action; keep the confirmation visible for this page view.
      clearRadarSeen();
      setResult({
        saved: json.saved ?? 0,
        total,
        limited: json.limited ?? false,
        limit: json.limit ?? null,
        savedIds: Array.isArray(json.savedIds) ? json.savedIds : undefined,
      });
    } catch {
      setResult({ saved: 0, total, limited: false, error: true });
    } finally {
      setSaving(false);
    }
  };

  const openDetail = () => {
    trackEvent("radar_login_notify_detail", label);
  };

  // The bids this save actually stored, in match order (falls back to the top match).
  const savedMatches: RadarSeenMatch[] = result?.savedIds?.length
    ? seen.matches.filter((m) => result.savedIds!.includes(m.id))
    : topMatch
      ? [topMatch]
      : [];
  const savedList = (
    <ul className="mt-3 space-y-2">
      {savedMatches.slice(0, 3).map((m, i) => (
        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2">
          <span className="min-w-0 flex-1 text-sm font-semibold text-slate-900">
            {m.title}
            {m.agency ? <span className="block text-xs font-normal text-slate-500">{agencyDisplay(m.agency) ?? m.agency}</span> : null}
          </span>
          <a
            href={bidPageHref(m.id)}
            onClick={() => trackEvent("radar_login_notify_open_bid", label)}
            className={
              i === 0
                ? "rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-bold text-slate-950 hover:bg-amber-400"
                : "text-sm font-semibold text-amber-700 underline hover:text-amber-900"
            }
          >
            Open this bid →
          </a>
        </li>
      ))}
    </ul>
  );

  const heading =
    total === 1
      ? "🎉 Your Radar match is ready to save to your feed."
      : `🎉 Your ${total} Radar matches are ready to save to your feed.`;

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border-2 border-amber-300 bg-amber-50 shadow-sm">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-100/80 px-5 py-2.5">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
          📡 Your radar matches are ready
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="px-1 text-sm text-amber-700 transition-colors hover:text-amber-900"
        >
          ✕
        </button>
      </div>

      <div className="px-5 py-4">
        {result ? (
          result.error ? (
            <div>
              <p className="text-sm font-semibold text-amber-900">
                We couldn't save your matches — try again.
              </p>
              <button
                type="button"
                onClick={saveTop3}
                disabled={saving}
                className="mt-3 block rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Retry save"}
              </button>
            </div>
          ) : result.saved >= result.total ? (
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Saved all {result.total} {result.total === 1 ? "match" : "matches"} to your Pipeline. ⭐
              </p>
              {savedList}
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Saved {result.saved} of {result.total}. Basic keeps{" "}
                {result.limit ?? 1} saved bid{(result.limit ?? 1) === 1 ? "" : "s"}.{" "}
                <a
                  href="/upgrade?plan=starter&source=saved_match"
                  onClick={() => trackEvent("radar_login_notify_upgrade", label)}
                  className="font-bold underline hover:text-amber-700"
                >
                  Save them all with Starter, ${STARTER_FIRST_MONTH_PRICE} for 30 days
                </a>
                .
              </p>
              {result.saved > 0 ? savedList : null}
              <a
                href="/radar"
                onClick={() => trackEvent("radar_login_notify_review", label)}
                className="mt-2 inline-block text-sm font-semibold text-amber-700 underline hover:text-amber-900"
              >
                Or view the rest again on Contract Radar →
              </a>
            </div>
          )
        ) : (
          <div>
            <p className="text-base font-extrabold leading-tight text-amber-900">{heading}</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-800">
              Nothing's saved yet — tap below to persist them to your saved bids, or open the top
              match for full details.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveTop3}
                disabled={saving}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save Top 3 to Pipeline"}
              </button>
              {topDetailUrl && (
                <a
                  href={topDetailUrl}
                  onClick={openDetail}
                  className="text-sm font-semibold text-amber-700 underline hover:text-amber-900"
                >
                  Open the top match →
                </a>
              )}
            </div>
            <p className="mt-2 text-xs text-amber-600">
              {seen.answers?.trade ? `Scan criteria: ${seen.answers.trade}` : ""}
              {seen.answers?.state ? ` · ${seen.answers.state}` : ""}
              {seen.total > total ? ` · ${seen.total} found, ${total} listed` : ""}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** The bid's own Contrax page (not the agency site), where the bid actions live. */
export function bidPageHref(id: number): string {
  return `/bid/${encodeURIComponent(String(id))}`;
}
