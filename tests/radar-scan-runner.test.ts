/**
 * Unit tests for the Radar scan client-side timeout race
 * (src/lib/radar-scan-runner.ts) — owner 2026-09-14 hardening.
 *
 * Proves the loading screen can never stay stuck on "scanning…" forever: the
 * scan promise settles EXACTLY ONCE on all four exit paths —
 *   1. success        (scan resolves  -> results screen)
 *   2. server rejection (scan rejects -> error screen, reason=request_error)
 *   3. synchronous throw (scan THROWS when invoked -> surfaced as a rejection,
 *      never a stuck "loading" state)
 *   4. timeout        (scan never settles -> RADAR_SCAN_TIMEOUT after
 *      timeoutMs, reason=timeout)
 * plus that clearTimer() neutralizes the timeout (unmount safety).
 *
 * Deliberately dependency-free (no DOM, no server call) so `bun test` runs it
 * deterministically in CI with real 25-50ms timers — no fake clocks.
 */
import { describe, expect, test } from "bun:test";
import {
  raceRadarScan,
  RADAR_SCAN_TIMEOUT_ERROR,
} from "../src/lib/radar-scan-runner";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("raceRadarScan — never-stuck-on-loading guarantee", () => {
  test("1. success path: scan result flows through the race", async () => {
    const { promise } = raceRadarScan(async () => ({ matches: [] }), 50);
    await expect(promise).resolves.toEqual({ matches: [] });
  });

  test("2. server rejection: scan rejection surfaces (request_error path)", async () => {
    const { promise } = raceRadarScan(
      async () => {
        throw new Error("HTTP 500");
      },
      50,
    );
    await expect(promise).rejects.toThrow("HTTP 500");
  });

  test("3. synchronous throw in the scan invocation surfaces as a rejection — never loading", async () => {
    // The invocation callback itself throws BEFORE returning a promise. The
    // Promise.resolve().then() wrapper converts it into a rejection, so the
    // race still settles and the caller's catch runs (error screen).
    const { promise } = raceRadarScan(
      () => {
        throw new Error("sync boom");
      },
      50,
    );
    await expect(promise).rejects.toThrow("sync boom");
  });

  test("4. timeout: a never-settling scan rejects with RADAR_SCAN_TIMEOUT after timeoutMs", async () => {
    const { promise } = raceRadarScan(
      () => new Promise<never>(() => { /* never settles */ }),
      30,
    );
    await expect(promise).rejects.toThrow(RADAR_SCAN_TIMEOUT_ERROR);
    // The rejection's message is exactly the owner-specified sentinel so the
    // caller can map it to the "timeout" telemetry label.
    try {
      await promise;
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toBe("RADAR_SCAN_TIMEOUT");
    }
  });

  test("5. clearTimer() stops the timeout from ever firing (unmount safety)", async () => {
    const { promise, clearTimer } = raceRadarScan(
      () => new Promise<never>(() => { /* never settles */ }),
      30,
    );
    clearTimer();
    await sleep(70); // well past the 30ms timeout window
    let settled = false;
    promise.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await sleep(20);
    expect(settled).toBe(false); // timer cleared -> race never settles
  });

  test("6. clearTimer() is idempotent and safe after the race settled", async () => {
    const { promise, clearTimer } = raceRadarScan(async () => 1, 50);
    await expect(promise).resolves.toBe(1);
    clearTimer();
    clearTimer();
    await expect(promise).resolves.toBe(1);
  });

  test("7. fast success beats the timeout", async () => {
    const { promise } = raceRadarScan(async () => "fast", 10_000);
    await expect(promise).resolves.toBe("fast");
  });

  test("8. timeout beats a slow scan", async () => {
    const { promise } = raceRadarScan(
      async () => {
        await sleep(500);
        return "slow";
      },
      25,
    );
    await expect(promise).rejects.toThrow(RADAR_SCAN_TIMEOUT_ERROR);
  });
});