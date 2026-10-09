/**
 * WinnerPriceLine — "Last time this was bid: won by … for $…" (owner 2026-10-09).
 *
 * Presentational only. It renders a line from data the surface has ALREADY
 * fetched (the lazy FPDS/USAspending intel, or a stored SAM.gov Award Notice) —
 * it never fetches, never invents a name or an amount, and renders nothing at
 * all when the records we read carry no usable winner+price.
 *
 * ENTITLEMENT (owner decision, binding 2026-10-09 — "the best place for this
 * feature is the first paid tier to drive in sales"): the line unlocks at
 * STARTER ($19), the first paid tier, via the SAME paid rule the paid head
 * start and the calendar feed use (`hasPaidBidAccess` → `hasUnlimitedSaves`,
 * ~/lib/head-start.server → ~/lib/trial). The caller resolves that rule ONCE on
 * the server and passes the boolean in — this component does not re-derive a
 * plan tier, so the pricing rule has exactly one copy. It is deliberately NOT
 * the Radar Pro ($79) gate that IncumbentCard uses, and IncumbentCard's own
 * gate is untouched by this feature.
 *
 * Basic / free / logged-out viewers get the plain Starter teaser with a CTA to
 * /upgrade — the app's existing Starter paywall wording and destination, not a
 * new invented plan name or price.
 *
 * `revealed` (see winnerPriceViewState): when the SAME card is already showing
 * this viewer the incumbent and its prior award value under an existing
 * owner-directed free reveal (Radar's SHOW_FREE_INCUMBENT free matches,
 * /awards' first-free / milestone grants), the line renders in full instead of
 * advertising a lock on something the card is displaying right above it.
 */
import { deriveWinnerPrice, winnerPriceLine, WINNER_PRICE_SOURCE_NOTE, winnerPriceViewState, type WinnerPriceAward } from "~/lib/winner-price";
import type { FPDSIntel } from "~/lib/fpds";
// Reuse the ALREADY-RATIFIED Starter paywall wording ("Upgrade to Starter →")
// rather than writing a second Starter CTA. The destination is the app's one
// upgrade route, /upgrade — there is no checkout link and no price literal here.
import { SAVE_LIMIT_PAYWALL_CTA, SAVE_LIMIT_PAYWALL_TITLE } from "~/components/PremiumUpgradeModal";

/** What a Basic/free viewer is promised, in plain words — no invented claim. */
const TEASER_BODY =
  "See who won the prior contract for this work and what they were paid — straight from public government records.";

export function WinnerPriceLine({
  intel,
  award,
  paidAccess,
  revealed,
  tone = "light",
}: {
  /** The lazy intel for this bid (null/undefined ⇒ nothing to say). */
  intel?: FPDSIntel | null;
  /** A stored SAM.gov Award Notice for this bid, when the surface has one. */
  award?: WinnerPriceAward | null;
  /** Resolved on the SERVER by hasPaidBidAccess (Starter-and-up). */
  paidAccess: boolean;
  /** True when this card already shows this viewer the same winner/amount free. */
  revealed?: boolean;
  /** "light" = /awards panels; "dark" = Radar match cards. */
  tone?: "light" | "dark";
}) {
  const winnerPrice = deriveWinnerPrice(intel, award);
  const state = winnerPriceViewState({ hasData: !!winnerPrice, paidAccess, revealed });
  if (state === "none" || !winnerPrice) return null;

  if (tone === "dark") {
    // Radar match cards: one compact line inside the existing
    // "Previous winner & award price" block. Purely additive — the block's own
    // two lines and its footnote are untouched.
    return (
      <>
        <p className="flex gap-2 text-sm text-slate-300">
          <span className="text-amber-400" aria-hidden="true">→</span>
          <span>
            Last time this was bid: <strong className="text-white">{winnerPriceLine(winnerPrice)}</strong>
          </span>
        </p>
        <p className="mt-1 text-[11px] text-slate-500">{WINNER_PRICE_SOURCE_NOTE}</p>
      </>
    );
  }

  return (
    <section
      className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4"
      aria-label="Last time this was bid"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-emerald-900">🏆 Last time this was bid</h3>
        {state === "teaser" && (
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">Starter feature</span>
        )}
      </div>
      {state === "full" ? (
        <>
          <p className="mt-2 text-sm text-slate-800">{winnerPriceLine(winnerPrice)}</p>
          <p className="mt-1 text-[11px] text-slate-400">{WINNER_PRICE_SOURCE_NOTE}</p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-600">{TEASER_BODY}</p>
          <a
            href="/upgrade"
            className="mt-3 inline-flex items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800"
          >
            {SAVE_LIMIT_PAYWALL_CTA}
          </a>
          <p className="mt-1 text-[11px] text-slate-400">
            {SAVE_LIMIT_PAYWALL_TITLE} to see it. Public records only, quoted as published.
          </p>
        </>
      )}
    </section>
  );
}
