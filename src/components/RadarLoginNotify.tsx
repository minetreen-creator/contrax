import { useEffect, useState } from "react";
import { getRadarSeen, clearRadarSeen, type RadarSeen } from "~/lib/radar-session";
import { trackEvent } from "~/lib/track";

/**
 * RadarLoginNotify — in-app (NOT email) notification shown on and after login.
 *
 * FN/F-4: the anonymous radar session is remembered entirely in the browser
 * (localStorage). There is NO email capture anywhere in this feature. When the
 * visitor later signs up / logs in and lands on /dashboard, this banner tells
 * them their radar matches are waiting and wires "save all" to the real
 * saved-bids pipeline (respecting the plan-tier save limit via
 * /api/radar-save-all), or routes them back to /radar to re-view (their
 * criteria are also in localStorage, so the radar form re-prefills).
 *
 * The banner stays until the visitor dismisses it or saves, so it appears "on
 * login and after" across dashboard visits.
 */
export function RadarLoginNotify() {
  const [seen, setSeen] = useState<RadarSeen | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ saved: number; total: number; limited: boolean; error?: boolean } | null>(null);

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

  const dismiss = () => {
    clearRadarSeen();
    setSeen(null);
    trackEvent("radar_login_notify_dismiss", label);
  };

  const saveAll = async () => {
    if (saving) return;
    setSaving(true);
    trackEvent("radar_login_notify_save", label);
    try {
      const res = await fetch("/api/radar-save-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidIds: seen.matches.map((m) => m.id) }),
      });
      const json = (await res.json().catch(() => null)) as
        | { saved?: number; total?: number; limited?: boolean; error?: string }
        | null;
      if (!res.ok || !json || json.error) {
        setResult({ saved: 0, total, limited: false, error: true });
        return;
      }
      // Saved — clear the browser session so the banner never resurfaces with
      // an empty action; keep the confirmation visible for this page view.
      clearRadarSeen();
      setResult({ saved: json.saved ?? 0, total, limited: json.limited ?? false });
    } catch {
      setResult({ saved: 0, total, limited: false, error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border-2 border-amber-300 bg-amber-50 shadow-sm">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-100/80 px-5 py-2.5">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
          📡 Your radar matches are waiting
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
                onClick={saveAll}
                disabled={saving}
                className="mt-3 block rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Retry save"}
              </button>
            </div>
          ) : result.saved >= result.total ? (
            <p className="text-sm font-semibold text-amber-900">
              Saved all {result.total} matches to your Pipeline. ⭐
            </p>
          ) : (
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Saved {result.saved} of {result.total} — Basic is limited to 3
                saved bids.{" "}
                <a
                  href="/upgrade"
                  onClick={() => trackEvent("radar_login_notify_upgrade", label)}
                  className="font-bold underline hover:text-amber-700"
                >
                  Upgrade to Starter for unlimited
                </a>
                .
              </p>
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
            <p className="text-sm leading-relaxed text-amber-900">
              Your <span className="font-bold">{label}</span> scan found{" "}
              <span className="font-bold">{total} {total === 1 ? "match" : "matches"}</span> —
              save them all to your Pipeline or view them again.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveAll}
                disabled={saving}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-60"
              >
                {saving ? "Saving…" : `Save all ${total} to my Pipeline`}
              </button>
              <a
                href="/radar"
                onClick={() => trackEvent("radar_login_notify_review", label)}
                className="text-sm font-semibold text-amber-700 underline hover:text-amber-900"
              >
                See them again on Contract Radar →
              </a>
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