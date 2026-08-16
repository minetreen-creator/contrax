/**
 * SaveToPipeline — "⭐ Save to My Pipeline" signup-gate button.
 *
 * The save action IS the signup trigger: a logged-out user clicking Save is
 * sent through the signup wall (`/signup?plan=professional&save_bid=..&next=..`),
 * and the bid is auto-saved immediately after the account is created. A logged-in
 * user just saves the bid (POST /api/bids-save, an idempotent upsert).
 *
 * The logged-in/logged-out branch is driven entirely by the `user` prop so SSR
 * renders the correct state in the initial HTML (logged-out visitors see the
 * signup-wall button; logged-in visitors see the save button or the saved state).
 * Hooks are unconditional — no early returns before hooks (rules-of-hooks
 * lesson from PRs #139/#140).
 */
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { trackEvent } from "~/lib/track";
import type { AuthUser } from "~/lib/auth";

interface SaveToPipelineProps {
  /** The bid/award id to save. */
  bidId: number;
  /** Current user, or null when logged out (SSR default for anonymous visitors). */
  user: AuthUser | null;
  /** True when this bid is already saved (resolved server-side in loader data). */
  initiallySaved?: boolean;
  /** Compact variant for dense card rows (shorter label). */
  compact?: boolean;
  /** Return path for the signup wall; defaults to the current location. */
  returnPath?: string;
}

export function SaveToPipeline({
  bidId,
  user,
  initiallySaved = false,
  compact = false,
  returnPath,
}: SaveToPipelineProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [saved, setSaved] = useState(initiallySaved);
  const [busy, setBusy] = useState(false);

  const next = returnPath ?? `${location.pathname}${location.search}`;

  async function handleClick() {
    if (busy || saved) return;
    if (!user) {
      // Signup wall: the save action IS the signup trigger.
      trackEvent("save_click", "logged_out", next);
      trackEvent("save_signup_wall", String(bidId), next);
      navigate({
        to: "/signup",
        search: { plan: "professional", save_bid: String(bidId), next },
      });
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

  if (saved) {
    return (
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
    );
  }

  return (
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
  );
}
