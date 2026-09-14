/**
 * Radar scan client-side timeout race (owner 2026-09-14 hardening).
 *
 * The Radar screen previously had NO client timeout and an unguarded state
 * update, so ANY silent failure (aborted request, network/edge cut, exception
 * between response and setScan) left the "scanning…" screen forever. This
 * module is the owner-required structure, kept DEPENDENCY-FREE and pure so it
 * is unit-testable under `bun test` (no DOM, no server call). radar.tsx
 * runScan() calls raceRadarScan() with the real runRadarScan server fn and
 * attaches its own success/failure handlers; the four exit paths (success,
 * server rejection, synchronous throw, timeout) each settle the race exactly
 * once.
 *
 * Synchronous-throw guard: the scan invocation runs inside
 * Promise.resolve().then(...), so a callback that throws synchronously is
 * converted into a rejected promise and still surfaces through the race —
 * a failing invocation can NEVER leave the caller's status stuck at
 * "loading".
 */
export const RADAR_SCAN_TIMEOUT_MS = 15_000;
export const RADAR_SCAN_TIMEOUT_ERROR = "RADAR_SCAN_TIMEOUT";

export type RadarScanRace<T> = {
  /** Exactly-one settlement: scan result, scan rejection, or timeout error. */
  promise: Promise<T>;
  /** Clears the timeout timer WITHOUT settling the race (safety for unmount /
   *  double-run). Safe to call multiple times; idempotent. */
  clearTimer: () => void;
};

export function raceRadarScan<T>(
  scan: () => Promise<T>,
  timeoutMs: number = RADAR_SCAN_TIMEOUT_MS,
): RadarScanRace<T> {
  // Owner-verbatim structure (owner 2026-09-14):
  //   const scanPromise = Promise.resolve().then(() => runRadarScan({ ... }));
  //   const timeoutPromise = new Promise<never>((_, reject) => {
  //     window.setTimeout(() => reject(new Error("RADAR_SCAN_TIMEOUT")), 15_000);
  //   });
  //   Promise.race([scanPromise, timeoutPromise]).then(handleSuccessfulScan).catch(handleFailedScan);
  const scanPromise = Promise.resolve().then(() => scan());
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(RADAR_SCAN_TIMEOUT_ERROR)),
      timeoutMs,
    );
  });
  return {
    promise: Promise.race([scanPromise, timeoutPromise]),
    clearTimer: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}