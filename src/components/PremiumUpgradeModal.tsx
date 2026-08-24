/**
 * PremiumUpgradeModal — a small, dismissible modal shown when a logged-in
 * NON-Professional user hits a premium paywall (Incumbent Intelligence reveal,
 * or the 3-free-bid save limit). It presents the paywall copy and a primary
 * CTA that boots the user straight into Stripe Checkout for the Professional
 * plan via the shared `redirectToCheckout("professional")` helper.
 *
 * Styled to match the app's Tailwind design (same language as TrialGate's
 * PlanUpgradeScreen). Dismissible via the ✕ button, the backdrop, or the
 * "Maybe later" link — never traps the user.
 */
import { useEffect } from "react";
import { redirectToCheckout } from "~/lib/checkout";
// ── Exact copy strings (shared/ratified) ─────────────────────────────────────
/** Heading for the Incumbent Intelligence upgrade prompt. */
export const INCUMBENT_PAYWALL_TITLE = "Upgrade to Professional";
/** Body for the Incumbent Intelligence upgrade prompt. */
export const INCUMBENT_PAYWALL_BODY =
  "Upgrade to Professional to unlock past contract awardees and pricing history.";
/** Message shown when a non-Professional user hits the free saved-bid limit. */
export const SAVE_LIMIT_PAYWALL_MESSAGE =
  "You've reached your free limit. Upgrade to track unlimited opportunities.";

export function PremiumUpgradeModal({
  open,
  onClose,
  title = INCUMBENT_PAYWALL_TITLE,
  message = SAVE_LIMIT_PAYWALL_MESSAGE,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
}) {
  // Close on Escape for accessibility. No early returns before hooks.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <span
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-2xl"
          aria-hidden="true"
        >
          🔒
        </span>
        <h2 className="mt-4 text-center text-xl font-bold text-slate-900">{title}</h2>
        <p className="mt-3 text-center text-sm text-slate-600">{message}</p>
        <button
          type="button"
          onClick={() => redirectToCheckout("professional")}
          className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          Upgrade to Professional →
        </button>
        <p className="mt-3 text-center text-xs text-slate-400">$79/mo · 21-day free trial · Cancel anytime</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 inline-flex w-full items-center justify-center rounded-xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:text-slate-700"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
