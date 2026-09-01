/**
 * Honest human messages for Google OAuth failures that land the user back on
 * `/login?error=<code>`.
 *
 * The Google OAuth callback (src/routes/auth/google/callback.tsx) redirects here
 * with one of these codes when the flow does not complete happily:
 *   - `google_denied`        — user cancelled / declined consent on Google's screen
 *   - `google_missing_code`  — Google redirected back without an auth code
 *   - `account_unavailable`  — the callback short-circuited (hostile IP guard), kept generic
 *
 * `/login` reads this and renders the message exactly once (then strips the
 * param) so a cancelled/errored Google sign-in is never a silent dead-end.
 * Copy is calm and honest — no urgency, no fake claims that OAuth works.
 */

export const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  google_denied:
    "Google sign-in was cancelled or you declined access. You can try again, or use email & password to sign in.",
  google_missing_code:
    "Google sign-in didn't complete. Please try again, or use email & password to sign in.",
  account_unavailable:
    "We couldn't complete Google sign-in. Please try again, or use email & password to sign in.",
};

export const OAUTH_ERROR_DEFAULT =
  "Google sign-in didn't complete. Please try again, or use email & password to sign in.";

/**
 * Returns a user-facing message for an OAuth error code, or null when there is
 * no error code present (nothing to show).
 */
export function getOAuthErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return OAUTH_ERROR_MESSAGES[code] ?? OAUTH_ERROR_DEFAULT;
}
