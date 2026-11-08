import { trackEvent } from "~/lib/track";

/**
 * Count an app install once per phone (owner 2026-11-07: "Is there a way to track downloads?";
 * 2026-11-08: "fix the banner install count"). Android reports a finished install (`appinstalled`,
 * or an accepted install prompt); iPhone never does, so the first open from the home screen counts
 * instead. One flag per phone keeps an install from counting twice, whichever page saw it.
 */
export const APP_INSTALLED_KEY = "contrax-app-installed";

export function devicePlatform(ua: string): "ios" | "android" | "desktop" {
  return /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "desktop";
}

/** Record the install unless this phone already did. Returns true when it was counted now. */
export function markAppInstalled(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  try {
    if (localStorage.getItem(APP_INSTALLED_KEY)) return false;
    localStorage.setItem(APP_INSTALLED_KEY, new Date().toISOString());
  } catch {
    /* storage blocked: still count it once for this page view */
  }
  trackEvent("app_installed", devicePlatform(ua));
  return true;
}
