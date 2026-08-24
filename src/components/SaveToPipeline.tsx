/**
 * SaveToPipeline — the "⭐ Save to My Pipeline" button.
 *
 * The logged-in/logged-out branch is driven entirely by the `user` prop so SSR
 * renders the correct state in the initial HTML (logged-out visitors see the
 * signup-wall button; logged-in visitors see the save button or the saved state).
 * Hooks are unconditional — no early returns before hooks (rules-of-hooks
 * lesson from PRs #139/#140).
 *
 * Free saved-bid limit: a logged-in Basic (free) user whose actively-saved
 * count is already at FREE_SAVE_LIMIT who tries to save a NEW bid (not already
 * saved) is shown an upgrade paywall (Starter) instead of saving. Admins/demo/
 * Starter+ users bypass. The server /api/bids-save is authoritative — if it
 * ever returns a 403 `save_limit`, the same paywall is surfaced here.
 */
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { trackEvent } from "~/lib/track";
import type { AuthUser } from "~/lib/auth";
import { checkTrial, hasUnlimitedSaves, FREE_SAVE_LIMIT, type TrialStatus } from "~/lib/trial";
import {
  PremiumUpgradeModal,
  SAVE_LIMIT_PAYWALL_TITLE,
  SAVE_LIMIT_PAYWALL_MESSAGE,
  SAVE_LIMIT_PAYWALL_CTA,
  SAVE_LIMIT_PAYWALL_PRICE,
} from "~/components/PremiumUpgradeModal";
interface SaveToPipelineProps {
  /** The bid/award id to save. */
  bidId: number;
  /** Current user, or null when logged out (SSR default for anonymous visitors). */
  user: AuthUser | null;
  /** True when this bid is already saved (resolved server-side in loader data). */
  initiallySaved?: boolean;
  /** Total number of bids this user currently has actively saved (status='saved'). */
  savedCount?: number;
  /** Compact variant for dense card rows (shorter label). */
  compact?: boolean;
  /** Return path for the signup wall; defaults to the current location. */
  returnPath?: string;
}
export function SaveToPipeline({
  bidId,
  user,
  initiallySaved = false,
  savedCount,
  compact = false,
  returnPath,
}: SaveToPipelineProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [saved, setSaved] = useState(initiallySaved);
  const [busy, setBusy] = useState(false);
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  useEffect(() => {
    checkTrial().then(setTrial).catch(() => {});
  }, []);
  const next = returnPath ?? `${location.pathname}${location.search}`;
  async function handleClick() {
    if (busy || saved) return;
    if (!user) {
      // Signup wall: the save action IS the signup trigger. Route to the
      // standard /signup with standard (free Basic) defaults and the save
      // intent — a brand-new account is provisioned on the free Basic package
      // (no card), so the first 3 saves are free.
      trackEvent("save_click", "logged_out", next);
      trackEvent("save_signup_wall", String(bidId), next);
      navigate({
        to: "/signup",
        search: { save_bid: String(bidId), next },
      });
      return;
    }
    // Free saved-bid limit: a logged-in Basic (free) user over the cap who
    // tries to save a NEW bid (this one not already saved) gets the paywall
    // instead of saving. Re-saving an already-saved bid is always fine.
    const unlimited = hasUnlimitedSaves(trial, user);
    if (!unlimited && savedCount !== undefined && savedCount >= FREE_SAVE_LIMIT && !saved) {
      trackEvent("save_limit_wall", String(bidId), next);
      setShowPaywall(true);
      return;
    }
    trackEvent("save_click", "logged_in", next);
    setBusy(true);
    try {
      const res = await fetch("/api/bids-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId }),
      });
      if (res.status === 403) {
        // Authoritative server rejection (save_limit) — surface the paywall.
        const body = await res.json().catch(() => null);
        if (body?.error === "save_limit") {
          trackEvent("save_limit_wall", String(bidId), next);
          setShowPaywall(true);
          return;
        }
        throw new Error("save failed");
      }
      if (!res.ok) throw new Error("save failed");
      setSaved(true);
      trackEvent("save_success", String(bidId), next);
    } catch {
      // Leave the button in its unsaved state; a card button is not the place
      // for an error modal. The pipeline page surfaces real failures.
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {saved ? (
        <span
          className={`inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 ${
            compact ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm"
          }`}
          title="Saved to your pipeline"
        >
          <svg className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {compact ? "Saved" : "✓ Saved to Pipeline"}
        </span>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          disabled={busy}
          title={
            user
              ? "Save this bid to your pipeline"
              : "Create a free account — this bid is saved to your pipeline automatically"
          }
          className={`inline-flex items-center gap-1.5 rounded-lg bg-amber-500 font-semibold text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-wait disabled:opacity-60 ${
            compact ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm"
          }`}
        >
          <span aria-hidden="true">⭐</span>
          {busy ? "Saving…" : compact ? "Save" : "Save to My Pipeline"}
        </button>
      )}
      <PremiumUpgradeModal
        open={showPaywall}
        onClose={() => setShowPaywall(false)}
        title={SAVE_LIMIT_PAYWALL_TITLE}
        message={SAVE_LIMIT_PAYWALL_MESSAGE}
        checkoutPlan="starter"
        ctaLabel={SAVE_LIMIT_PAYWALL_CTA}
        priceNote={SAVE_LIMIT_PAYWALL_PRICE}
      />
    </>
  );
}
