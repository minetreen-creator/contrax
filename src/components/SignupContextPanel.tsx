/**
 * SignupContextPanel — generalized contextual banner for the /signup page.
 *
 * One panel serving BOTH context sources (no duplicated markup):
 *
 *   - `closing_soon`: framing signup around unlocking a specific Closing Soon
 *     bid before its deadline (urgency-driven). When a live `closingLabel`
 *     ("2d 4h") is supplied, it renders an urgency variant with a countdown
 *     badge; without a deadline it renders the plain ticker/"want the full
 *     details" variant exactly as shipped in PR #196.
 *   - `incumbent`: framing signup around unlocking a specific incumbent's
 *     contract history & past pricing (value-driven — NO countdown, per owner
 *     spec). Renders the owner-ratified headline verbatim.
 *
 * The page decides which source to show and passes the relevant context fields
 * (closing_soon: title + agency + deadline label; incumbent: title + agency).
 *
 * `radar` source additionally accepts the visitor's SEEN matches (from
 * getRadarSeen() — same server-computed top-3 the /dashboard banner shows), so
 * a radar-sourced signup can display the actual open bids the visitor scanned
 * as compact read-only cards (title, agency, score/score_label, original
 * notice link). Never fabricated — the page passes whatever getRadarSeen()
 * returned (up to 3 free matches); an absent/empty list simply omits the block.
 */
import type { RadarSeenMatch } from "~/lib/radar-session";

type SignupContextPanelProps = {
  source: "closing_soon" | "incumbent" | "radar";
  /** The bid/opportunity title (the "«Bid Title»" carried through from the CTA). */
  title?: string;
  /** Agency / organization context, when available. */
  agency?: string;
  /** Live "closes in Xd Yh" countdown label — closing_soon only, optional. */
  closingLabel?: string | null;
  /** Radar continuation context — `radar` source only. Carries the anonymous
   * radar scan's criteria so the signup panel can show the visitor is resuming
   * their scan (their answers will prefill their profile at onboarding). */
  radar?: {
    trade: string;
    state: string;
    certLabel: string;
    sizeLabel: string;
  } | null;
  /** The visitor's SEEN radar matches (from getRadarSeen(), up to 3 free).
   * Rendered as compact read-only cards under the radar criteria — never
   * fabricated. Omit/empty = no match list shown. */
  matches?: RadarSeenMatch[];
};

export function SignupContextPanel({ source, title, agency, closingLabel, radar, matches }: SignupContextPanelProps) {
  // Radar variant — the visitor is continuing from a Contract Radar scan. Their
  // answers travel into signup/profiling (no email involved) so this feels like
  // a ~10s resume, not a restart. Value-driven, no deadline / urgency. The
  // panel shows while either the criteria or seen matches are present so a
  // radar-sourced visitor never lands on an irrelevant closing_soon framing.
  if (source === "radar" && (radar || (matches && matches.length > 0))) {
    const labelTop = [radar?.trade || null, radar?.state ? `in ${radar.state}` : "nationwide"]
      .filter(Boolean)
      .join(" ");
    return (
      <div className="mb-6 overflow-hidden rounded-2xl border-2 border-amber-400 bg-amber-50 shadow-sm">
        <div className="px-5 py-4">
          <p className="text-sm font-bold text-slate-900">
            Resuming your Contract Radar scan
          </p>
          <p className="mt-1 text-sm text-amber-700">
            {labelTop || "Your radar search"}
            {radar?.certLabel ? ` · ${radar.certLabel}` : ""}
            {radar?.sizeLabel ? ` · ${radar.sizeLabel}` : ""}
          </p>
          <p className="mt-3 text-xs text-amber-600">
            Your answers will prefill your profile — just finish your free account below.
          </p>
          {/* Seen matches — the actual scanned bids (read-only). Absent/empty
              seen list = no block, criteria still shown. */}
          {matches && matches.length > 0 && (
            <div className="mt-4 border-t border-amber-200 pt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
                Your scanned matches
              </p>
              <ul className="mt-2 space-y-2">
                {matches.map((m) => (
                  <li key={m.id} className="rounded-lg border border-amber-200 bg-white px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{m.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{m.agency || "Federal"}</p>
                        {m.due_date ? (
                          <p className="mt-0.5 text-xs font-semibold text-amber-700">
                            Due {new Date(m.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </p>
                        ) : null}
                      </div>
                      <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                        {m.score_label || `${m.score}%`}
                      </span>
                    </div>
                    {m.source_url ? (
                      <a
                        href={m.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-block text-xs font-semibold text-amber-700 underline hover:text-amber-900"
                      >
                        View original notice ↗
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Incumbent variant — value-driven (unlock contract history + past pricing),
  // owner-ratified headline. No deadline / countdown for this source.
  if (source === "incumbent") {
    const display = (title && title.trim()) || "this contract";
    return (
      <div className="mb-6 overflow-hidden rounded-2xl border-2 border-indigo-300 bg-indigo-50 shadow-sm">
        <div className="px-5 py-4">
          <p className="text-sm font-bold text-indigo-900">
            Unlock Incumbent Contract History &amp; Past Pricing for {display}
          </p>
          {agency && (
            <p className="mt-1 text-sm font-medium text-indigo-700 line-clamp-2">{agency}</p>
          )}
          <p className="mt-3 text-xs text-indigo-600">
            Start your 21-day Professional trial below to see the incumbent&apos;s full contract history and past pricing.
          </p>
        </div>
      </div>
    );
  }

  // Closing Soon variant — urgency-driven. When a live deadline label is
  // present it shows the countdown badge and the "before it closes" framing;
  // otherwise (plain ticker / cold arrivals) it renders exactly as before.
  return (
    <div className="mb-6 overflow-hidden rounded-2xl border-2 border-amber-400 bg-amber-50 shadow-sm">
      {closingLabel && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-100/80 px-5 py-2.5">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          <span className="text-xs font-bold uppercase tracking-wide text-amber-800">
            Closes in {closingLabel}
          </span>
        </div>
      )}
      <div className="px-5 py-4">
        <p className="text-sm font-bold text-slate-900">
          {closingLabel
            ? "Unlock this bid before it closes"
            : "Want to see the full details and generate a proposal draft for this contract?"}
        </p>
        <p className="mt-1 text-sm text-amber-700 line-clamp-2">
          <span className="font-medium">{agency ? `${agency} — ` : ""}</span>
          {title}
        </p>
        <p className="mt-3 text-xs text-amber-600">
          {closingLabel
            ? "Start free below for full details, the AI summary, and a draft before the deadline."
            : "Start your 21-day Professional trial below to unlock the full opportunity."}
        </p>
      </div>
    </div>
  );
}
