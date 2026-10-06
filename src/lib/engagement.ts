/**
 * Engaged-visit signal (owner 2026-10-06: paid clicks "clicking but not staying";
 * a one-step visit couldn't tell a 2-second bounce from someone reading the whole
 * page). Fires ONE `page_engaged` event per page view, the first time the visitor
 * either keeps the page visible for ENGAGED_MS or scrolls past half of it.
 * Client-only, never throws, no timers left behind on navigation.
 */
import { trackEvent } from "~/lib/track";

export const ENGAGED_MS = 15_000;
export const ENGAGED_SCROLL_FRACTION = 0.5;
export const ENGAGED_EVENT = "page_engaged";

/**
 * True once the visitor has scrolled through at least half of the page's
 * scrollable distance. A page that (nearly) fits on one screen never counts. PURE.
 */
export function scrolledEnough(scrollY: number, viewportH: number, docH: number): boolean {
  const scrollable = docH - viewportH;
  if (scrollable < viewportH * 0.2) return false;
  return scrollY / scrollable >= ENGAGED_SCROLL_FRACTION;
}

/** Start watching the current page; returns a cleanup function. */
export function watchEngagement(path: string, send: typeof trackEvent = trackEvent): () => void {
  if (typeof window === "undefined" || path.startsWith("/admin")) return () => {};
  let done = false;
  let visibleMs = 0;
  let lastTick = Date.now();
  const fire = (reason: "time" | "scroll") => {
    if (done) return;
    done = true;
    cleanup();
    send(ENGAGED_EVENT, reason, path);
  };
  const tick = () => {
    const now = Date.now();
    if (document.visibilityState === "visible") visibleMs += now - lastTick;
    lastTick = now;
    if (visibleMs >= ENGAGED_MS) fire("time");
  };
  const onScroll = () => {
    const doc = document.documentElement;
    if (scrolledEnough(window.scrollY, window.innerHeight, doc.scrollHeight)) fire("scroll");
  };
  const timer = window.setInterval(tick, 1000);
  window.addEventListener("scroll", onScroll, { passive: true });
  function cleanup() {
    window.clearInterval(timer);
    window.removeEventListener("scroll", onScroll);
  }
  return () => {
    done = true;
    cleanup();
  };
}
