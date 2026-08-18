/**
 * Client-side carry + persist helpers for the score → signup → draft promise.
 *
 * Flow (part B of the signup-conversion fix):
 *   1. /score result CTA stores the pasted solicitation text in sessionStorage
 *      under PENDING_DRAFT_KEY (URL params must NOT carry the full text — too
 *      long; sessionStorage survives the same-tab hop to /signup AND the
 *      Google OAuth round-trip).
 *   2. After the account exists (email/password path in signup.tsx, Google
 *      path on the first /onboarding mount — both authenticated), the text is
 *      POSTed to /api/pending-drafts (status='awaiting_profile') and
 *      sessionStorage is cleared on success.
 *
 * Everything here is fail-open: the draft promise must never break signup,
 * onboarding, or redirects. On failure we leave sessionStorage intact so the
 * next mount can retry.
 */
import { trackEvent } from "~/lib/track";

export const PENDING_DRAFT_KEY = "contrax_pending_draft";

/** Stores the pasted solicitation (truncated to the score tool's 20k cap). */
export function storePendingDraft(text: string): void {
  try {
    const trimmed = String(text || "").trim();
    if (!trimmed) return;
    sessionStorage.setItem(
      PENDING_DRAFT_KEY,
      JSON.stringify({ text: trimmed.slice(0, 20000), created_at: Date.now() }),
    );
  } catch {
    /* sessionStorage can throw (private mode / quota) — the carry is best-effort */
  }
}

/** Reads the stored solicitation text, or null when nothing is pending. */
export function readPendingDraftText(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_DRAFT_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { text?: unknown };
      return typeof parsed.text === "string" ? parsed.text : null;
    } catch {
      // Fallback for a raw (non-JSON) value written by an older version.
      return raw;
    }
  } catch {
    return null;
  }
}

export function clearPendingDraft(): void {
  try {
    sessionStorage.removeItem(PENDING_DRAFT_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Persists the pending solicitation server-side keyed to the CURRENT logged-in
 * user (the request carries the session cookie). Fires `pending_draft_created`
 * on success. Returns true only when a row was persisted AND sessionStorage
 * was cleared. Never throws.
 */
export async function persistPendingDraft(): Promise<boolean> {
  const text = readPendingDraftText()?.trim();
  if (!text) return false;
  try {
    const res = await fetch("/api/pending-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ solicitation_text: text.slice(0, 20000) }),
    });
    if (!res.ok) return false;
    trackEvent("pending_draft_created");
    clearPendingDraft();
    return true;
  } catch {
    // Fail-open: keep sessionStorage so a later mount can retry.
    return false;
  }
}
