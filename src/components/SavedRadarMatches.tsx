import { useEffect, useState } from "react";
import { trackEvent } from "~/lib/track";

/**
 * SavedRadarMatches — in-app (NOT email) fulfillment of the anonymous Contract
 * Radar "Save your matches" capture, shown on /dashboard to a LOGGED-IN user
 * whose account email matches a `radar_saves` row that hasn't been fulfilled.
 *
 * Owner direction (2026-08-30): radar-save alerts are NO LONGER emailed. When
 * that user signs up / logs in, their saved criteria + CURRENT matching open
 * bids are recomputed live (server-side, from the real `bids` table — never
 * fabricated) and shown here, so the "save your matches" promise is fulfilled
 * by surfacing them at login rather than by email.
 *
 * Actions (reusing the RadarLoginNotify amber visual language):
 *   [Save Top 3 to Pipeline]  persists the recomputed matches via
 *                             /api/radar-save-all (respects the Basic 3-bid
 *                             cap) and then marks the radar_saves row fulfilled
 *                             via /api/saved-radar-fulfilled so it doesn't
 *                             reappear on later logins.
 *   [Open original notice ↗]  deep-link to the top match's source solicitation.
 *   [✕]                       dismiss for this session (does NOT mark fulfilled).
 *
 * Truthful: the headline says "matching bids for the criteria you saved" — it
 * never claims anything was emailed, and if there are currently no matching
 * open bids we say so honestly.
 */
type SavedRadarData = {
  hasSaved: boolean;
  row: {
    id: number;
    trade: string;
    state: string;
    cert: string;
    sizePref: string;
  } | null;
  certLabel: string;
  matches: Array<{
    id: number;
    title: string;
    agency: string | null;
    due_date: string | null;
    set_aside: string | null;
    source_url: string | null;
    score: number;
    score_label: string;
  }>;
  total: number;
};

const fmtDate = (d: string): string =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function SavedRadarMatches() {
  const [data, setData] = useState<SavedRadarData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<
    | { saved: number; total: number; limited: boolean; limit?: number | null; error?: boolean }
    | null
  >(null);

  useEffect(() => {
    let active = true;
    fetch("/api/saved-radar-matches", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SavedRadarData | null) => {
        if (!active) return;
        if (d?.hasSaved) {
          setData(d);
          trackEvent("saved_radar_matches_shown", d.certLabel || "");
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

  if (!loaded || dismissed || !data || !data.row) return null;
  if (result && (result.error || result.saved >= result.total)) return null; // fulfilled / handled

  const { row, certLabel, matches } = data;
  const label = certLabel || "Contract Radar";
  const tradeTxt = row.trade && row.trade !== "any" ? row.trade : "broad market";
  const stateTxt = row.state && row.state !== "" ? row.state : "nationwide";
  const criteriaTxt = `${label} · ${tradeTxt} · ${stateTxt}`;
  const topMatch = matches[0];
  const topDetailUrl = topMatch?.source_url || null;

  const dismiss = () => {
    setDismissed(true);
    trackEvent("saved_radar_matches_dismiss", label);
  };

  const saveTop3 = async () => {
    if (saving) return;
    if (matches.length === 0) return;
    setSaving(true);
    trackEvent("saved_radar_matches_save", label);
    try {
      const res = await fetch("/api/radar-save-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidIds: matches.map((m) => m.id) }),
      });
      const json = (await res.json().catch(() => null)) as
        | { saved?: number; total?: number; limited?: boolean; limit?: number | null; error?: string }
        | null;
      if (!res.ok || !json || json.error) {
        setResult({ saved: 0, total: matches.length, limited: false, error: true });
        return;
      }
      // Mark the radar_saves row fulfilled so it doesn't reappear on later logins.
      try {
        await fetch("/api/saved-radar-fulfilled", { method: "POST" });
      } catch {
        // Non-fatal: even if marking fails, the save itself succeeded.
      }
      setResult({
        saved: json.saved ?? 0,
        total: matches.length,
        limited: json.limited ?? false,
        limit: json.limit ?? null,
      });
    } catch {
      setResult({ saved: 0, total: matches.length, limited: false, error: true });
    } finally {
      setSaving(false);
    }
  };

  // Empty state — no current open bids match the saved criteria.
  if (matches.length === 0) {
    return (
      <div className="mb-6 overflow-hidden rounded-2xl border-2 border-amber-300 bg-amber-50 shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-100/80 px-5 py-2.5">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800">📡 Your saved radar search</p>
          <button type="button" aria-label="Dismiss" onClick={dismiss} className="px-1 text-sm text-amber-700 transition-colors hover:text-amber-900">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-base font-extrabold leading-tight text-amber-900">
            You saved radar matches for {criteriaTxt}.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-amber-800">
            There are currently no open bids matching that saved search. We&apos;ll show any new
            matches here the next time you sign in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border-2 border-amber-300 bg-amber-50 shadow-sm">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-100/80 px-5 py-2.5">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
          📡 Your saved radar matches
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
        <p className="text-base font-extrabold leading-tight text-amber-900">
          Matching bids for the criteria you saved — {criteriaTxt}.
        </p>
        <p className="mt-1 text-xs text-amber-700">
          {data.total === 1 ? "1 current open bid" : `${data.total} current open bids`} · recomputed
          live from our listings
        </p>

        {matches.length > 0 && (
          <ul className="mt-3 space-y-2">
            {matches.map((m) => (
              <li
                key={m.id}
                className="rounded-xl border border-amber-200 bg-white px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug text-slate-900">
                      {m.title || "Solicitation"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {m.agency ? `${m.agency} · ` : ""}
                      {m.set_aside ? `${m.set_aside} · ` : ""}
                      {m.due_date ? `Due ${fmtDate(m.due_date)}` : "Due date not stated"}
                    </p>
                  </div>
                  {m.score != null && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      {m.score}% match
                    </span>
                  )}
                </div>
                {m.source_url && (
                  <a
                    href={m.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackEvent("saved_radar_matches_detail", label)}
                    className="mt-1 inline-block text-xs font-semibold text-amber-700 underline hover:text-amber-900"
                  >
                    Open original notice ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
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
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("saved_radar_matches_detail", label)}
              className="text-sm font-semibold text-amber-700 underline hover:text-amber-900"
            >
              View Full Solicitation Details ↗
            </a>
          )}
        </div>

        {result ? (
          result.error ? (
            <p className="mt-3 text-sm font-semibold text-amber-900">
              We couldn&apos;t save your matches —{" "}
              <button type="button" onClick={saveTop3} disabled={saving} className="underline">
                {saving ? "Saving…" : "try again"}
              </button>
            </p>
          ) : result.saved >= result.total ? (
            <p className="mt-3 text-sm font-semibold text-amber-900">
              Saved all {result.total} {result.total === 1 ? "match" : "matches"} to your Pipeline. ⭐
            </p>
          ) : (
            <p className="mt-3 text-sm font-semibold text-amber-900">
              Saved {result.saved} of {result.total} — Basic is limited to {result.limit ?? 3} saved
              bids.{" "}
              <a href="/upgrade" className="font-bold underline hover:text-amber-700">
                Upgrade to Starter for unlimited
              </a>
              .
            </p>
          )
        ) : (
          <p className="mt-2 text-xs text-amber-600">
            Saving persists these bids to your pipeline for later review.
          </p>
        )}
      </div>
    </div>
  );
}
