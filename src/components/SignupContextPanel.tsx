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
 */
type SignupContextPanelProps = {
  source: "closing_soon" | "incumbent";
  /** The bid/opportunity title (the "«Bid Title»" carried through from the CTA). */
  title?: string;
  /** Agency / organization context, when available. */
  agency?: string;
  /** Live "closes in Xd Yh" countdown label — closing_soon only, optional. */
  closingLabel?: string | null;
};

export function SignupContextPanel({ source, title, agency, closingLabel }: SignupContextPanelProps) {
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
            Start your free trial below to see the incumbent&apos;s full contract history and past pricing.
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
            : "Start your free trial below to unlock the full opportunity."}
        </p>
      </div>
    </div>
  );
}
