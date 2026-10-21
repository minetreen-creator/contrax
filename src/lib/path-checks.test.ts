import { describe, expect, test } from "bun:test";

import { judge, PATH_CHECKS, siteCheckState, STALE_AFTER_HOURS } from "./path-checks";

const page = PATH_CHECKS.find((c) => c.path === "/pricing")!;
const checkout = PATH_CHECKS.find((c) => c.method === "POST")!;

describe("judge", () => {
  test("passes on the expected status with the marker text", () => {
    expect(judge(page, 200, "<button>Start Starter for $5</button>", 120).ok).toBe(true);
    expect(judge(checkout, 401, '{"error":"Sign in to choose a Contrax plan."}', 90).ok).toBe(true);
  });

  test("fails on a wrong status, a missing marker or no response", () => {
    expect(judge(page, 500, "", 50)).toMatchObject({ ok: false, detail: "Expected 200, got 500" });
    expect(judge(checkout, 200, "{}", 50).ok).toBe(false);
    expect(judge(page, 200, "<html></html>", 50).detail).toContain("Start Starter for $");
    expect(judge(page, null, "", null, "timeout")).toMatchObject({ ok: false, detail: "timeout" });
  });
});

describe("siteCheckState", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
  test("never, failing, stale and ok", () => {
    expect(siteCheckState(null, 0, now)).toBe("never");
    expect(siteCheckState(hoursAgo(1), 2, now)).toBe("failing");
    expect(siteCheckState(hoursAgo(STALE_AFTER_HOURS + 1), 0, now)).toBe("stale");
    expect(siteCheckState(hoursAgo(5), 0, now)).toBe("ok");
  });
});
