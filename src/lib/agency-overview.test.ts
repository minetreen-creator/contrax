/**
 * CROSS-CLIENT DASHBOARD — the pure rollup semantics (Agency tier phase 2).
 *
 * These pins are the ones a consultant's morning depends on: what "due in the next
 * 7 days" means at both ends of the range, that a decided pursuit (won/lost) is not
 * "advancing", that a broken count never renders as "-1" or "NaN", and that the
 * ordering puts the client with overdue work at the top deterministically.
 */
import { describe, expect, test } from "bun:test";
import {
  advancingCount,
  attentionReasons,
  buildAgencyOverview,
  clampCount,
  dayWindow,
  isoDate,
  isoTimestamp,
  type WorkspaceStats,
} from "~/lib/agency-overview";

const WINDOW = { today: "2026-10-20", weekEnd: "2026-10-27" };

function stats(overrides: Partial<WorkspaceStats> & { id: number; name: string }): WorkspaceStats {
  return {
    states: [],
    trades: [],
    savedBids: 0,
    dueInWindow: 0,
    overdue: 0,
    byPursuit: {},
    lastSavedAt: null,
    contacts: 0,
    lastCrmActivityAt: null,
    ...overrides,
  };
}

describe("the due window", () => {
  test("is 7 INCLUSIVE days: a bid due today counts as soon-due, one due in 8 days does not", () => {
    const window = dayWindow(new Date("2026-10-20T12:00:00.000Z"));
    expect(window).toEqual({ today: "2026-10-20", weekEnd: "2026-10-27" });
    // The range the SQL applies is `>= today AND <= weekEnd`, so a due date exactly
    // on either end is inside the window and today itself is never "overdue".
    expect(window.weekEnd.localeCompare(window.today)).toBeGreaterThan(0);
  });

  test("rolls over a month and a year boundary without drifting a day", () => {
    expect(dayWindow(new Date("2026-12-28T00:00:00.000Z")).weekEnd).toBe("2027-01-04");
    expect(dayWindow(new Date("2026-02-24T00:00:00.000Z")).weekEnd).toBe("2026-03-03");
  });

  test("isoDate is the UTC day, so every machine reads the same window", () => {
    expect(isoDate(new Date("2026-10-20T23:59:59.000Z"))).toBe("2026-10-20");
    expect(isoDate(new Date("2026-10-20T00:00:00.000Z"))).toBe("2026-10-20");
  });
});

describe("counts that reach a dashboard", () => {
  test("clampCount refuses negative / NaN / Infinity / non-numeric rather than rendering them", () => {
    expect(clampCount(3)).toBe(3);
    expect(clampCount("4")).toBe(4);
    expect(clampCount(-1)).toBe(0);
    expect(clampCount(Number.NaN)).toBe(0);
    expect(clampCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampCount(null)).toBe(0);
    expect(clampCount(undefined)).toBe(0);
    expect(clampCount(2.9)).toBe(2);
  });

  test("advancing is bids IN MOTION only — won and lost are decided, evaluating is not moving", () => {
    expect(advancingCount({ evaluating: 5, preparing: 2, submitted: 3, won: 9, lost: 4 })).toBe(5);
    expect(advancingCount({})).toBe(0);
    expect(advancingCount({ preparing: -2, submitted: 1 })).toBe(1);
  });

  test("attention reasons are ordered overdue → due soon → advancing, and are empty when quiet", () => {
    expect(attentionReasons({ name: "A", overdue: 2, dueInWindow: 3, advancing: 1 })).toEqual([
      "2 overdue",
      "3 due in the next 7 days",
      "1 advancing in the pipeline",
    ]);
    expect(attentionReasons({ name: "A", overdue: 0, dueInWindow: 0, advancing: 0 })).toEqual([]);
  });

  test("isoTimestamp normalises a driver Date to ISO — String(date) would sort wrong", () => {
    const date = new Date("2026-10-19T09:00:00.000Z");
    expect(isoTimestamp(date)).toBe("2026-10-19T09:00:00.000Z");
    // The trap this guards: the non-ISO form is NOT lexically comparable.
    expect(String(date) === "2026-10-19T09:00:00.000Z").toBe(false);
    expect(isoTimestamp("2026-10-19T09:00:00.000Z")).toBe("2026-10-19T09:00:00.000Z");
    expect(isoTimestamp(null)).toBeNull();
    expect(isoTimestamp(new Date(Number.NaN))).toBeNull();
  });
});

describe("buildAgencyOverview", () => {
  test("totals sum every client, and each client keeps ONLY its own counts (no cross-client bleed)", () => {
    const payload = buildAgencyOverview(
      [
        stats({ id: 1, name: "Acme Janitorial", savedBids: 4, dueInWindow: 2, overdue: 1, contacts: 7 }),
        stats({ id: 2, name: "Bright HVAC", savedBids: 6, dueInWindow: 0, overdue: 3, contacts: 2 }),
      ],
      WINDOW,
    );
    expect(payload.window).toEqual(WINDOW);
    expect(payload.totals).toEqual({
      workspaces: 2,
      savedBids: 10,
      dueInWindow: 2,
      overdue: 4,
      contacts: 9,
      advancing: 0,
    });
    const acme = payload.workspaces.find((w) => w.id === 1)!;
    const bright = payload.workspaces.find((w) => w.id === 2)!;
    expect([acme.savedBids, acme.dueInWindow, acme.overdue, acme.contacts]).toEqual([4, 2, 1, 7]);
    expect([bright.savedBids, bright.dueInWindow, bright.overdue, bright.contacts]).toEqual([6, 0, 3, 2]);
  });

  test("orders attention-first: overdue outranks due-soon outranks advancing, then name", () => {
    const payload = buildAgencyOverview(
      [
        stats({ id: 1, name: "Quiet Client" }),
        stats({ id: 2, name: "Moving Client", byPursuit: { preparing: 2 } }),
        stats({ id: 3, name: "Due Client", dueInWindow: 1 }),
        stats({ id: 4, name: "Overdue Client", overdue: 1 }),
      ],
      WINDOW,
    );
    expect(payload.workspaces.map((w) => w.name)).toEqual([
      "Overdue Client",
      "Due Client",
      "Moving Client",
      "Quiet Client",
    ]);
  });

  test("ties break on name then id, so the same fixture always renders the same list", () => {
    const once = buildAgencyOverview(
      [
        stats({ id: 9, name: "Beta" }),
        stats({ id: 8, name: "Alpha" }),
        stats({ id: 7, name: "Alpha" }),
      ],
      WINDOW,
    );
    expect(once.workspaces.map((w) => w.id)).toEqual([7, 8, 9]);
    const reversed = buildAgencyOverview(
      [
        stats({ id: 7, name: "Alpha" }),
        stats({ id: 8, name: "Alpha" }),
        stats({ id: 9, name: "Beta" }),
      ],
      WINDOW,
    );
    expect(reversed.workspaces.map((w) => w.id)).toEqual([7, 8, 9]);
  });

  test("lastActivityAt is the newest of a saved bid and a CRM activity, null when never touched", () => {
    const payload = buildAgencyOverview(
      [
        stats({ id: 1, name: "A", lastSavedAt: "2026-10-18T10:00:00.000Z", lastCrmActivityAt: "2026-10-19T09:00:00.000Z" }),
        stats({ id: 2, name: "B", lastSavedAt: "2026-10-19T10:00:00.000Z", lastCrmActivityAt: null }),
        stats({ id: 3, name: "C" }),
      ],
      WINDOW,
    );
    const byId = new Map(payload.workspaces.map((w) => [w.id, w.lastActivityAt]));
    expect(byId.get(1)).toBe("2026-10-19T09:00:00.000Z");
    expect(byId.get(2)).toBe("2026-10-19T10:00:00.000Z");
    expect(byId.get(3)).toBeNull();
  });

  test("no workspaces is an honest empty dashboard, not an error and not a lone zero row", () => {
    const payload = buildAgencyOverview([], WINDOW);
    expect(payload.workspaces).toEqual([]);
    expect(payload.totals).toEqual({ workspaces: 0, savedBids: 0, dueInWindow: 0, overdue: 0, contacts: 0, advancing: 0 });
  });

  test("all ten allowed workspaces roll up (the phase-1 ceiling) and are all present", () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      stats({ id: i + 1, name: `Client ${String(i + 1).padStart(2, "0")}`, savedBids: i }),
    );
    const payload = buildAgencyOverview(ten, WINDOW);
    expect(payload.workspaces).toHaveLength(10);
    expect(payload.totals.savedBids).toBe(45);
  });
});
