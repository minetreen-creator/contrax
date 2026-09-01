/**
 * GOOGLE-OAUTH CTA + CANCEL-ERROR dry-run (self-cleaning, prod-safe).
 *
 * Verifies the two owner-approved Google OAuth defects from the signup audit:
 *
 *   B1 — /login no longer silently swallows a cancelled/errored Google sign-in.
 *        A cancelled Google flow returns to /login?error=<code> (redirected by
 *        the OAuth callback). This asserts /login reads that param, renders an
 *        honest message exactly once, and strips the param afterwards.
 *
 *   B2 — the "Continue with Google" primary CTA is gated at runtime so it is
 *        only ever rendered as a live link when the OAuth config is genuinely
 *        present (GOOGLE_CLIENT_ID AND GOOGLE_CLIENT_SECRET). When not present
 *        the CTA renders disabled with an honest reason — never a live-looking
 *        link to a handshake that would fail server-side. The hardcoded client
 *        id that shipped in the source is gone from login/signup.
 *
 * Nothing here writes to the database (no test user, no rows) so it is trivially
 * self-cleaning. It reads the local source for the fix assertions and unit-tests
 * the shared error-message helper directly. It also reports, for THIS run
 * environment, whether the Google CTA would be live or gated (informational:
 * the value comes from env vars, which in production live in Vercel settings).
 *
 * Run:  bun run scripts/oauth-cta-dryrun.ts        (no DATABASE_URL needed)
 */
import { readFileSync } from "node:fs";
import { getOAuthErrorMessage, OAUTH_ERROR_MESSAGES } from "~/lib/oauth-errors";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

const loginSrc = readFileSync("src/routes/login.tsx", "utf8");
const signupSrc = readFileSync("src/routes/signup.tsx", "utf8");
const oauthSrc = readFileSync("src/lib/google-oauth.ts", "utf8");
const cbSrc = readFileSync("src/routes/auth/google/callback.tsx", "utf8");
const PRESSURE = ["action required", "urgent", "act now", "limited time", "hurry", "final notice"];

/* ═══════ B1 — /login renders the OAuth cancel/error honestly, once ═══════ */
section("B1 — /login surfaces a cancelled/errored Google sign-in (no more silent dead-end)");
check("login reads the ?error= search param", loginSrc.includes("URLSearchParams(searchStr).get(\"error\")"), "search param read");
check("login maps the code via getOAuthErrorMessage", loginSrc.includes("getOAuthErrorMessage"), "");
check("login shows the message in the existing error surface", loginSrc.includes("setError(msg)"), "");
check("login clears the param after showing it (shows once)", loginSrc.includes("replaceState"), "history.replaceState clears ?error");
check("callback still redirects error cases to /login?error=", cbSrc.includes("throw redirect({ href: \"/login?error=google_denied\" })"), "callback denied branch intact");
check("callback missing-code branch intact", cbSrc.includes("throw redirect({ href: \"/login?error=google_missing_code\" })"), "");
check("callback blocked-IP branch intact", cbSrc.includes("throw redirect({ href: \"/login?error=account_unavailable\" })"), "");
const errCodes = ["google_denied", "google_missing_code", "account_unavailable"];
check(`error helper maps ${errCodes.length} real callback codes`, errCodes.every((c) => typeof OAUTH_ERROR_MESSAGES[c] === "string"), errCodes.join(","));
check("unknown codes degrade to a calm default", getOAuthErrorMessage("some_other") !== null && getOAuthErrorMessage("some_other") === OAUTH_ERROR_MESSAGES.google_missing_code, String(getOAuthErrorMessage("some_other")));
check("no error code -> null (nothing shown)", getOAuthErrorMessage(null) === null && getOAuthErrorMessage(undefined) === null, "");
// Honesty: the cancel message must be calm and must offer the email/password path.
const deniedMsg = OAUTH_ERROR_MESSAGES.google_denied.toLowerCase();
check("cancel message mentions trying again", deniedMsg.includes("try again"), "");
check("cancel message points to email & password", deniedMsg.includes("email") && deniedMsg.includes("password"), "");

/* ═══════ B2 — Google CTA is runtime-gated, no hardcoded client id ═══════ */
section("B2 — 'Continue with Google' is only a live link when OAuth is actually configured");
check("no hardcoded Google client id in login.tsx", !loginSrc.includes("googleusercontent.com"), "");
check("no hardcoded Google client id in signup.tsx", !signupSrc.includes("googleusercontent.com"), "");
check("getGoogleAuthUrl gates on GOOGLE_CLIENT_ID", oauthSrc.includes("process.env.GOOGLE_CLIENT_ID"), "");
check("getGoogleAuthUrl gates on GOOGLE_CLIENT_SECRET (callback needs both)", oauthSrc.includes("process.env.GOOGLE_CLIENT_SECRET"), "");
check("getGoogleAuthUrl returns null when either is missing", oauthSrc.includes("if (!clientId || !clientSecret) return null;"), "");
check("login loader resolves the URL via getGoogleAuthUrl()", loginSrc.includes("googleAuthUrl: await getGoogleAuthUrl()"), "");
check("signup loader resolves the URL via getGoogleAuthUrl()", signupSrc.includes("googleAuthUrl: await getGoogleAuthUrl()"), "");
check("login renders Google CTA gated on googleAuthUrl (live link or disabled)", loginSrc.includes("googleAuthUrl ? (") && loginSrc.includes("disabled"), "");
check("signup renders Google CTA gated on googleAuthUrl (live link or disabled)", signupSrc.includes("googleAuthUrl ? (") && signupSrc.includes("disabled"), "");
check("signup disabled CTA carries an honest reason", signupSrc.includes("Google sign-up isn't available right now"), "");
check("login disabled CTA carries an honest reason", loginSrc.includes("Google sign-in isn't available right now"), "");
// Honesty: no fabricated "works" claim, no pressure language in the new blocks.
const low = (loginSrc + " " + signupSrc).toLowerCase();
check("no false claim that OAuth is 'fully working'", !/google oauth is fully (implemented|working)/.test(low), "");
check("no urgency/scarcity language in login/signup", !PRESSURE.some((w) => low.includes(w)), PRESSURE.join("|"));

/* ═══════ (c) OAuth handshake intact ═══════ */
section("(c) callback / handshake left intact");
check("callback still reads GOOGLE_CLIENT_ID", cbSrc.includes("process.env.GOOGLE_CLIENT_ID"), "");
check("callback still reads GOOGLE_CLIENT_SECRET", cbSrc.includes("process.env.GOOGLE_CLIENT_SECRET"), "");
check("callback still does the token exchange + ID-token verify", cbSrc.includes("TOKEN_ENDPOINT") && cbSrc.includes("verifyGoogleIdToken"), "");

/* ═══════ (d) Runtime env verdict (INFORMATIONAL — not a pass/fail) ═══════ */
section("(d) Runtime env verdict for THIS environment (Vercel settings govern prod)");
const hasId = Boolean(process.env.GOOGLE_CLIENT_ID);
const hasSecret = Boolean(process.env.GOOGLE_CLIENT_SECRET);
console.log(`  INFO  GOOGLE_CLIENT_ID present: ${hasId ? "yes" : "no"}`);
console.log(`  INFO  GOOGLE_CLIENT_SECRET present: ${hasSecret ? "yes" : "no"}`);
console.log(`  INFO  → Google CTA would render ${hasId && hasSecret ? "LIVE (link)" : "DISABLED (honest 'unavailable')"} in this run env.`);

console.log(`\nOAuth CTA + cancel-error dry-run: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
