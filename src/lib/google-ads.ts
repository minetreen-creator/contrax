/**
 * Google Ads tag (owner 2026-10-04, account AW-18493657028).
 *
 * Loaded in the browser after the page renders (never blocks it), never on
 * /admin pages and never for automated browsers. A completed signup is reported
 * to Google as a conversion so ads can be judged by signups, not clicks:
 * set GOOGLE_ADS_SIGNUP_LABEL to the label of the "Signup" conversion action
 * (Google Ads → Goals → Conversions; send_to "AW-…/<label>"). Until a label is
 * set, the signup is still sent as a standard "sign_up" event.
 */
export const GOOGLE_ADS_ID = "AW-18493657028";
export const GOOGLE_ADS_SIGNUP_LABEL = "";

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

/** True when the tag should load on this path (never on admin pages). */
export function adsTagAllowed(pathname: string): boolean {
  return !pathname.startsWith("/admin");
}

let loaded = false;

/** Inject gtag.js once and configure the Ads account. Browser only; safe to call repeatedly. */
export function loadGoogleAdsTag(pathname: string): void {
  if (loaded || typeof window === "undefined" || typeof document === "undefined") return;
  if (!adsTagAllowed(pathname)) return;
  try {
    if (navigator.webdriver === true) return;
  } catch {
    // ignore
  }
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // gtag.js reads the `arguments` object, not an array.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  } as Gtag;
  window.gtag("js", new Date());
  window.gtag("config", GOOGLE_ADS_ID);
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
  document.head.appendChild(s);
}

/** The gtag call for a completed signup. */
export function signupConversionCall(label: string = GOOGLE_ADS_SIGNUP_LABEL): [string, string, Record<string, string>] {
  return label
    ? ["event", "conversion", { send_to: `${GOOGLE_ADS_ID}/${label}` }]
    : ["event", "sign_up", { send_to: GOOGLE_ADS_ID }];
}

/** Report a completed signup to Google Ads (no-op when the tag isn't loaded). */
export function reportSignupConversion(): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  try {
    window.gtag(...signupConversionCall());
  } catch {
    // ads reporting must never break the signup flow
  }
}
