/**
 * One shared pace for every IonWave board (owner 2026-11-10: Georgetown "has stopped working", HTTP 429).
 * All *.ionwave.net boards sit on the same host, and the sync read seven of them within about three
 * seconds (Lee County, Arkansas, Fayetteville, Columbia, Plano, Irving, Georgetown), so the host
 * rate-limited the last ones. Every IonWave request now waits its turn, at least IONWAVE_GAP_MS after
 * the previous one, across all boards in the process.
 */
export const IONWAVE_GAP_MS = 12_000;

export const ionwaveThrottleDeps = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  gapMs: IONWAVE_GAP_MS,
};

let nextAt = 0;
let chain: Promise<void> = Promise.resolve();

/** Resolves when this caller may send its IonWave request; callers are served in order. */
export function ionwaveTurn(): Promise<void> {
  const turn = chain.then(async () => {
    const wait = nextAt - ionwaveThrottleDeps.now();
    if (wait > 0) await ionwaveThrottleDeps.sleep(wait);
    nextAt = ionwaveThrottleDeps.now() + ionwaveThrottleDeps.gapMs;
  });
  chain = turn.catch(() => {});
  return turn;
}

/** Tests only. */
export function resetIonwaveThrottle(): void {
  nextAt = 0;
  chain = Promise.resolve();
}
