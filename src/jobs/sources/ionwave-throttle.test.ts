import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { IONWAVE_GAP_MS, ionwaveThrottleDeps, ionwaveTurn, resetIonwaveThrottle } from "./ionwave-throttle";

const saved = { ...ionwaveThrottleDeps };
afterEach(() => {
  Object.assign(ionwaveThrottleDeps, saved);
  resetIonwaveThrottle();
});

test("IonWave requests are spaced at least the gap apart, in order, across boards", async () => {
  let clock = 1_000_000;
  const waits: number[] = [];
  Object.assign(ionwaveThrottleDeps, {
    now: () => clock,
    sleep: async (ms: number) => { waits.push(ms); clock += ms; },
    gapMs: IONWAVE_GAP_MS,
  });
  resetIonwaveThrottle();
  const sentAt: number[] = [];
  await Promise.all([1, 2, 3].map(() => ionwaveTurn().then(() => sentAt.push(clock))));
  expect(sentAt).toEqual([1_000_000, 1_000_000 + IONWAVE_GAP_MS, 1_000_000 + 2 * IONWAVE_GAP_MS]);
  clock += 60_000; // a later board after a long pause goes straight away
  await ionwaveTurn();
  expect(waits).toEqual([IONWAVE_GAP_MS, IONWAVE_GAP_MS]);
  expect(IONWAVE_GAP_MS).toBeGreaterThanOrEqual(10_000);
});

test("every IonWave fetcher waits its turn before each request", () => {
  for (const f of ["ar-ionwave.ts", "fl-direct.ts", "ne-omaha-ionwave.ts"]) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    expect(src).toContain('import { ionwaveTurn } from "./ionwave-throttle";');
    expect(src).toContain("await ionwaveTurn();");
  }
});
