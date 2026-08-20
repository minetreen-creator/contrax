/**
 * Client-side carry for the `next` deep-link return path across onboarding.
 *
 * Context (audit D4 — conversion-path-audit-2026-08-20): signup CTAs use the
 * canonical `/signup?plan=<tier>&next=<return>` template. Google OAuth carried
 * `next` through OAuth `state`, but the email/password path only honored it
 * when `save_bid` was also present — otherwise a new email user landed on
 * /onboarding and `next` was silently dropped (the same /awards or Closing
 * Soon CTA landed a Google returning user on /awards but an email user on
 * /onboarding).
 *
 * Fix: keep the honest /onboarding first-stop for new users, but latch a valid
 * `next` here (sessionStorage, same-tab) so that when onboarding completes it
 * can route the user back to `next` instead of the default /dashboard.
 *
 * Mirrors the pending-draft pattern (src/lib/pending-draft.ts): fail-open,
 * best-effort, `safeNext()` re-validated on read so only same-site relative
 * `/` paths (no `//`, no external) can ever be used — no open redirect.
 */
import { safeNext } from "./saved-matches";

export const REMEMBER_NEXT_KEY = "contrax_remember_next";

/** Stores a `next` return path, but only after `safeNext()` accepts it. */
export function storeRememberedNext(next: unknown): void {
  const valid = safeNext(next);
  if (!valid) return;
  try {
    sessionStorage.setItem(REMEMBER_NEXT_KEY, valid);
  } catch {
    /* sessionStorage can throw (private mode / quota) — carry is best-effort */
  }
}

/** Reads the remembered return path, re-validating it through `safeNext()`. */
export function readRememberedNext(): string | null {
  try {
    const raw = sessionStorage.getItem(REMEMBER_NEXT_KEY);
    return safeNext(raw);
  } catch {
    return null;
  }
}

export function clearRememberedNext(): void {
  try {
    sessionStorage.removeItem(REMEMBER_NEXT_KEY);
  } catch {
    /* best-effort */
  }
}
