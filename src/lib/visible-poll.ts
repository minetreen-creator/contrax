/**
 * Poll only while the page is on screen (owner 2026-11-22: the database bill was $51 of compute in
 * three weeks, and the owner console asked the database every 15 seconds for as long as its tab
 * was open, seen or not, so the database never got its 5 idle minutes to switch off).
 *
 * Runs `run` every `ms` while the tab is visible, skips it while hidden, runs it once as soon as
 * the tab is shown again, and stops altogether after `idleStopMs` on screen without the owner
 * touching the page. Returns the cleanup. Browser-only; call it from an effect.
 */
export const POLL_IDLE_STOP_MS = 20 * 60_000;

export function pollWhileVisible(run: () => void, ms: number, idleStopMs: number = POLL_IDLE_STOP_MS): () => void {
  let lastTouch = Date.now();
  const touch = () => {
    const wasIdle = Date.now() - lastTouch > idleStopMs;
    lastTouch = Date.now();
    if (wasIdle && !document.hidden) run();
  };
  const tick = () => {
    if (shouldPoll(document.hidden, Date.now() - lastTouch, idleStopMs)) run();
  };
  const onVisible = () => {
    if (!document.hidden) {
      lastTouch = Date.now();
      run();
    }
  };
  const timer = setInterval(tick, ms);
  document.addEventListener("visibilitychange", onVisible);
  for (const ev of ["pointerdown", "keydown", "scroll"] as const) window.addEventListener(ev, touch, { passive: true });
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    for (const ev of ["pointerdown", "keydown", "scroll"] as const) window.removeEventListener(ev, touch);
  };
}

/** The rule on its own, so it can be tested: not while hidden, not after the idle limit. PURE. */
export function shouldPoll(hidden: boolean, msSinceTouch: number, idleStopMs: number = POLL_IDLE_STOP_MS): boolean {
  return !hidden && msSinceTouch <= idleStopMs;
}
