import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DAILY_OUTREACH_CAP, MAX_SEND_PER_BATCH, outreachRoomToday } from "./outreach";

// Owner 2026-11-02: "always keep outreach to less than 100 due to resend daily limits".
// Owner 2026-11-16: moved to Resend's paid plan, so the limit now protects the sending domain.
describe("daily outreach cap", () => {
  test("is raised in steps on the paid plan, not removed", () => {
    expect(DAILY_OUTREACH_CAP).toBe(200);
    expect(DAILY_OUTREACH_CAP).toBeLessThanOrEqual(500);
    expect(MAX_SEND_PER_BATCH).toBeLessThanOrEqual(DAILY_OUTREACH_CAP);
  });

  test("room left today", () => {
    expect(outreachRoomToday(0)).toBe(DAILY_OUTREACH_CAP);
    expect(outreachRoomToday(40)).toBe(DAILY_OUTREACH_CAP - 40);
    expect(outreachRoomToday(DAILY_OUTREACH_CAP)).toBe(0);
    expect(outreachRoomToday(500)).toBe(0);
    expect(outreachRoomToday(-3)).toBe(DAILY_OUTREACH_CAP);
    expect(outreachRoomToday(NaN)).toBe(DAILY_OUTREACH_CAP);
  });

  test("sending and the morning run both respect the cap", () => {
    const server = readFileSync("src/lib/outreach.server.ts", "utf8");
    expect(server).toContain("Math.min(MAX_SEND_PER_BATCH, room)");
    const prepare = readFileSync(".github/workflows/outreach-prepare.yml", "utf8");
    const trimAt = prepare.indexOf("bun run outreach-trim");
    expect(trimAt).toBeGreaterThan(prepare.indexOf("bun run leads-outreach-prepare"));
    expect(readFileSync(".github/workflows/outreach-trim.yml", "utf8")).toContain("bun run outreach-trim");
  });

  test("the claims adjuster the owner ruled out stays suppressed (stored in outreach_suppressions)", () => {
    expect(readFileSync("src/lib/outreach.ts", "utf8")).toContain("'not_a_fit'");
  });
});
