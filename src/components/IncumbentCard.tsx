/**
 * IncumbentCard — "🏛️ Incumbent Intelligence" panel.
 *
 * Logged-in Professional/Agency users (and admins/demo) see the full
 * FPDS/USAspending incumbent data. Logged-out users AND logged-in
 * non-Professional users see a TEASED panel: the incumbent name is masked (first character of the first word + asterisks,
 * length-preserving, derived from the real name), while the real "Total
 * obligated" figure, UEI, and period of performance stay visible. The chart
 * area is replaced by a teaser panel with an unlock CTA that routes to
 * `/signup?source=incumbent&opportunity_id=<bidId>&title=..&agency=..&plan=professional&next=/awards`
 * so the signup page can frame itself around unlocking THIS incumbent's
 * contract history & past pricing.
 *
 * `freeReveal` (session-scoped "first one's free" grant from /awards) renders
 * a logged-out panel exactly like the logged-in one — full data, no wall.
 *
 * `proAccess` tells the card whether the LOGGED-IN user holds professional
 * access (resolved by the /awards route via hasProfessionalAccess). Logged-out
 * first-free/milestone/signup flows are untouched; logged-in non-Professional
 * users instead see a "Reveal Incumbent & Past Pricing" CTA that opens an
 * upgrade modal (direct Stripe Checkout for Professional).
 *
 * The logged-in/logged-out branch is driven entirely by the `user` prop so SSR
 * renders the correct state from the route loader's server-resolved
 * `currentUser` (same pattern as SaveToPipeline) — no client-side auth fetch,
 * no flash of unblurred data for logged-out visitors.
 */
import { useState, type FormEvent } from "react";
import type { FPDSIntel } from "~/lib/fpds";
import type { AuthUser } from "~/lib/auth";
import { trackEvent } from "~/lib/track";
import {
  PremiumUpgradeModal,
  INCUMBENT_PAYWALL_BODY,
  INCUMBENT_PAYWALL_TITLE,
} from "~/components/PremiumUpgradeModal";

// Mask the first word of a real incumbent name, preserving its length:
// "General Dynamics" → "G****** Dynamics". Derived from real data only —
// never invented.
function maskIncumbentName(name: string): string {
  const firstWord = name.trim().split(/\s+/)[0] ?? "";
  if (!firstWord) return name;
  return firstWord[0] + "*".repeat(Math.max(0, firstWord.length - 1)) + name.trim().slice(firstWord.length);
}

const MILESTONE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * MilestoneOfferPanel — the one-time lead-gen exchange that REPLACES the signup
 * teaser on a teased card once a logged-out visitor has expanded
 * MILESTONE_THRESHOLD teased cards on /awards (see loadIntel there). Captures an
 * email in exchange for the card's full data — no account, no trial. On success
 * calls `onSuccess` so the parent reveals the card; v1 is capture-only (no email
 * is ever sent). Handles its own validation/submitting/error state so the parent
 * card stays stateless when the offer is not active.
 */
function MilestoneOfferPanel({ onSuccess }: { onSuccess?: () => void }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!MILESTONE_EMAIL_PATTERN.test(value)) {
      setError("Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/lead-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, source: "milestone_grant" }),
      });
      if (!res.ok) {
        let message = "Something went wrong. Please try again.";
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body.error === "string" && body.error) message = body.error;
        } catch { /* keep the default message */ }
        setError(message);
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      onSuccess?.();
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 bg-white p-4 text-center sm:p-5">
      <div className="w-full">
        <p className="text-sm font-semibold text-slate-800">One more card free</p>
        <p className="mt-1 text-xs text-slate-500">Just tell us where to send it — no account, no trial.</p>
      </div>
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-2" noValidate>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          aria-label="Email address"
          autoComplete="email"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Unlocking…" : "Unlock this card free"}
        </button>
        {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      </form>
      <p className="text-[11px] text-slate-400">No credit card · No trial · One free card</p>
    </div>
  );
}

export function IncumbentCard({
  intel,
  winner,
  user,
  bidId,
  title,
  agency,
  freeReveal,
  milestoneOffer,
  onMilestoneGranted,
  proAccess,
}: {
  intel: FPDSIntel;
  winner?: string;
  user?: AuthUser | null;
  bidId?: number;
  // The bid/opportunity title + agency that this incumbent panel belongs to —
  // carried through to /signup so the incumbent banner can name the bid
  // (`?source=incumbent&opportunity_id=<bidId>&title=..&agency=..`).
  title?: string;
  agency?: string;
  freeReveal?: boolean;
  // Milestone grant (one per device): when true and the panel is gated, the
  // signup teaser is replaced by the email-capture offer; onMilestoneGranted is
  // called after a successful capture so the parent can reveal the card. Both
  // are optional — when absent the card renders exactly as before.
  milestoneOffer?: boolean;
  onMilestoneGranted?: () => void;
  // Whether the logged-in user holds professional access. Ignored for
  // logged-out visitors (their gating is governed by freeReveal/milestone).
  proAccess?: boolean;
}) {
  // New behavior: a LOGGED-IN non-Professional user is gated exactly like a
  // logged-out visitor (masked incumbent name + teased pricing). Admins/demo/
  // professional-tier users (`proAccess`) are unaffected. The logged-out
  // first-free/milestone/signup lead-gen flows are untouched.
  const loggedOutGated = !user && !freeReveal;
  const loggedInNonPro = !!user && !proAccess;
  const gated = loggedOutGated || loggedInNonPro;
  // Paywall modal state for logged-in non-Professional users (this card's own
  // upgrade CTA). Unused for everyone else.
  const [showPaywall, setShowPaywall] = useState(false);
  const max = Math.max(...intel.historical_pricing.map((x) => x.total_obligated), 1);
  const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

  const bars = intel.historical_pricing.map((x) => (
    <div key={x.fiscal_year} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
      <span className="text-[10px] text-slate-500">{money(x.total_obligated)}</span>
      <div className="w-full max-w-12 rounded-t bg-indigo-400" style={{ height: `${Math.max(5, x.total_obligated / max * 65)}px` }} title={`${x.award_count} awards`} />
      <span className="text-[10px] text-slate-600">FY{x.fiscal_year}</span>
    </div>
  ));
  // Gated tease CTA — always present when the panel is gated, never only with
  // a chart (keeps the invariant that a gated card always presents the unlock
  // CTA). When the one-per-device milestone offer is active, the offer panel
  // REPLACES the signup teaser (the normal teaser + its incumbent_gate_signup
  // event are otherwise untouched).
  const gateTeaser = gated ? (
    loggedInNonPro ? (
      <div className="flex h-40 flex-col items-center justify-center gap-2 bg-white p-4 text-center">
        <p className="text-sm font-semibold text-slate-800">Full 5-year pricing history</p>
        <button
          type="button"
          onClick={() => setShowPaywall(true)}
          className="inline-flex w-full max-w-sm items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          Reveal Incumbent &amp; Past Pricing
        </button>
        <p className="text-xs text-slate-400">Professional plan feature</p>
      </div>
    ) : milestoneOffer ? (
      <MilestoneOfferPanel onSuccess={onMilestoneGranted} />
    ) : (
      <div className="flex h-40 flex-col items-center justify-center gap-2 bg-white p-4 text-center">
        <p className="text-sm font-semibold text-slate-800">Full 5-year pricing history</p>
        <a
          href={`/signup?source=incumbent&opportunity_id=${bidId != null ? bidId : ""}&title=${encodeURIComponent(title || "")}&agency=${encodeURIComponent(agency || "")}&plan=professional&next=/awards`}
          onClick={() => trackEvent("incumbent_gate_signup", bidId != null ? String(bidId) : undefined, "/awards")}
          className="inline-flex w-full max-w-sm items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          Unlock full name &amp; pricing history
        </a>
        <p className="text-xs text-slate-400">Free 21-day trial · No credit card required</p>
      </div>
    )
  ) : null;

  return <section className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-4" aria-label="Incumbent Intelligence">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-indigo-900">🏛️ Incumbent Intelligence</h3>{winner && winner !== "Open opportunity" && winner.toLowerCase() !== intel.incumbent_name.toLowerCase() && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Re-compete</span>}</div>
    <div className="mt-3 grid gap-3 sm:grid-cols-3"><div><p className="text-xs uppercase tracking-wide text-slate-500">Incumbent</p><p className="font-semibold text-slate-900">{gated ? maskIncumbentName(intel.incumbent_name) : intel.incumbent_name}</p>{intel.incumbent_uei && <p className="text-xs text-slate-500">UEI: {intel.incumbent_uei}</p>}</div><div><p className="text-xs uppercase tracking-wide text-slate-500">Total obligated</p><p className="font-semibold text-slate-900">{money(intel.total_obligated)}</p></div><div><p className="text-xs uppercase tracking-wide text-slate-500">Period of performance</p><p className="text-sm text-slate-700">{intel.pop_start_date || "—"} → {intel.pop_end_date || "—"}</p></div></div>
    {/* Chart section renders when there is historical data to show, OR whenever the panel is
        gated — the teaser must ALWAYS present the unlock CTA, even when the incumbent has no
        5-year pricing (teaser keeps the same visual height). Logged-in / free-reveal users
        with no data keep the current behavior: no section at all. */}
    {(intel.historical_pricing.length > 0 || gated) && (
      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-700">5-year historical pricing</p>
        <div className="relative overflow-hidden rounded-lg border border-indigo-100">
          {gated ? (
            gateTeaser
          ) : (
            <div className="flex h-24 items-end gap-2 border-b border-indigo-100 px-1">{bars}</div>
          )}
        </div>
      </div>
    )}
    <p className="mt-3 text-[11px] text-slate-400">Powered by FPDS / USASpending.gov</p>
    {showPaywall && (
      <PremiumUpgradeModal
        open
        title={INCUMBENT_PAYWALL_TITLE}
        message={INCUMBENT_PAYWALL_BODY}
        onClose={() => setShowPaywall(false)}
      />
    )}
  </section>;
}
