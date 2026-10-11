import { isUpgradePromptEnabled } from "~/lib/grants";

/**
 * FAIL-SAFE decision for the pricing page Grants Plus tier row (owner directive
 * rev 327, 2026-09-23): "if the Stripe price configuration or the subscription
 * availability signal becomes unavailable, surfaces must display 'Coming soon'
 * — NEVER a broken payment button."
 *
 * The pricing page's ONLY signal is the SAME flag /grants already gates on
 * (`isUpgradePromptEnabled`), so the two pages can never disagree. This wrapper
 * adds the one thing a public page needs: it can NEVER throw. A missing
 * `process` object, an env absent from the runtime, or a hostile getter on the
 * process environment all resolve to `false` ⇒ the row falls back to "Coming
 * soon" instead of 500-ing the public pricing page.
 *
 * PURE and exported so the fail-closed contract is unit-tested rather than
 * asserted by reading the source (tests/pricing page-grants-failsafe.test.tsx).
 * Takes the env record as an ARGUMENT — it reads no global — so it stays
 * trivially testable and can never become a build-time/inlined read.
 */
export function resolveGrantsUpgradeEnabled(
  env: Record<string, string | undefined> | undefined | null,
): boolean {
  try {
    if (!env) return false;
    return isUpgradePromptEnabled(env);
  } catch {
    // Fail CLOSED: an unreadable signal is treated as "not available".
    return false;
  }
}

