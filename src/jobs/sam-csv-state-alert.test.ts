/**
 * The alert half of the owner's 2026-10-19 state-count amendment: a changed
 * counter state set is LOGGED and ALERTED, and the import ALWAYS CONTINUES.
 *
 * ZERO NETWORK, ZERO SIDE EFFECTS ON THE REPO: the email path is exercised
 * through an injected fetch, and every env var / file this file touches is
 * restored or removed in the same test.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { describeStateSetChange, keptRowCounterStats, stateOpenCountDeltas } from "./sam-csv";
import {
  alertCounterStateChange,
  COUNTER_STATE_ALERT_ARTIFACT,
  COUNTER_STATE_ALERT_TO,
  counterStateChangeReport,
} from "./sam-csv-state-alert";

const ME_ROW = {
  title: "Window washing at the Kittery annex",
  location: "Kittery, ME",
  set_aside: null,
  normalized_state: "ME",
  due_date: "2026-11-01T00:00:00Z",
} as any;

const reports = () => {
  const stats = keptRowCounterStats([ME_ROW], new Date("2026-10-19T04:30:00Z"));
  const before = { VA: 215, MD: 31 };
  const after = { VA: 215, MD: 31, ME: 1 };
  const change = describeStateSetChange(Object.keys(before), Object.keys(after));
  const deltas = stateOpenCountDeltas(before, after);
  return { stats, change, deltas, report: counterStateChangeReport(change, deltas, stats) };
};

afterEach(() => {
  if (existsSync(COUNTER_STATE_ALERT_ARTIFACT)) rmSync(COUNTER_STATE_ALERT_ARTIFACT);
  delete process.env.SAM_CSV_STATE_CHANGE_FILE;
  delete process.env.RESEND_API_KEY;
});

describe("counter state-set change report", () => {
  test("names the before/after sets and the added state", () => {
    const { report } = reports();
    expect(report.subject).toContain("2 → 3");
    expect(report.subject).toContain("ME");
    expect(report.lines[0]).toContain("COUNTER STATE SET CHANGED");
    expect(report.lines[1]).toContain("2 -> 3");
    expect(report.lines[2]).toContain("MD, VA");
    expect(report.lines[3]).toContain("MD, ME, VA");
    expect(report.lines[4]).toContain("added : ME");
    expect(report.lines[5]).toContain("removed: (none)");
  });
  test("carries per-state open-count deltas in both directions", () => {
    const { report } = reports();
    const deltaLine = report.lines.find((l) => l.trim().startsWith("ME:"));
    expect(deltaLine).toBe("      ME:     0 ->     1 (+1) [NEW state in the counter]");
    const before = { VA: 215, ME: 10 };
    const after = { VA: 215 };
    const lost = counterStateChangeReport(
      describeStateSetChange(Object.keys(before), Object.keys(after)),
      stateOpenCountDeltas(before, after),
      keptRowCounterStats([], new Date("2026-10-19T04:30:00Z")),
    );
    expect(lost.lines.find((l) => l.trim().startsWith("ME:"))).toBe(
      "      ME:    10 ->     0 (-10) [LEFT the counter]",
    );
  });
  test("says the import CONTINUES and asks for no action — never a failure", () => {
    const { report } = reports();
    expect(report.lines[0]).toContain("the import CONTINUES");
    expect(report.text).toContain("ACTION: none required");
    expect(report.text.toLowerCase()).not.toContain("fail");
    expect(report.text.toLowerCase()).not.toContain("exit");
    expect(report.text.toLowerCase()).not.toContain("nothing was written");
  });
  test("reports the counted rows behind the move, including the no-PopState split", () => {
    const { report } = reports();
    expect(report.text).toContain("this run keeps 1 kept row(s) in the counter");
    expect(report.text).toContain("1 carry a PopState, 0 publish none");
  });
});

describe("alertCounterStateChange — fire and forget, never fatal", () => {
  test("without RESEND_API_KEY the email is skipped (not an error) and the run may continue", async () => {
    delete process.env.RESEND_API_KEY;
    const { report } = reports();
    const r = await alertCounterStateChange(report, { writeArtifact: false });
    expect(r).toEqual({ emailed: "skipped", artifact: null });
  });
  test("a rejected email still resolves — the import never fails because of the alert", async () => {
    process.env.RESEND_API_KEY = "test-key";
    const { report } = reports();
    const r = await alertCounterStateChange(report, {
      writeArtifact: false,
      fetchImpl: (async () => new Response("nope", { status: 422 })) as typeof fetch,
    });
    expect(r.emailed).toBe("failed");
  });
  test("a THROWING email path (network down) still resolves", async () => {
    process.env.RESEND_API_KEY = "test-key";
    const { report } = reports();
    const r = await alertCounterStateChange(report, {
      writeArtifact: false,
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    });
    expect(r.emailed).toBe("failed");
  });
  test("sends to the business inbox over the repo's existing Resend channel", async () => {
    process.env.RESEND_API_KEY = "test-key";
    const { report } = reports();
    let body: any = null;
    let url = "";
    const r = await alertCounterStateChange(report, {
      writeArtifact: false,
      fetchImpl: (async (u: any, init: any) => {
        url = String(u);
        body = JSON.parse(String(init.body));
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(r.emailed).toBe("sent");
    expect(url).toBe("https://api.resend.com/emails");
    expect(body.to).toEqual([COUNTER_STATE_ALERT_TO]);
    expect(body.subject).toBe(report.subject);
    expect(body.text).toBe(report.text);
  });
  test("writes the notification artifact the workflow uploads", async () => {
    const path = "/tmp/sam-csv-state-alert.test.md";
    rmSync(path, { force: true });
    process.env.SAM_CSV_STATE_CHANGE_FILE = path;
    delete process.env.RESEND_API_KEY;
    const { report } = reports();
    const r = await alertCounterStateChange(report);
    expect(r.artifact).toBe(path);
    const written = await Bun.file(path).text();
    expect(written).toContain(report.subject);
    expect(written).toContain("COUNTER STATE SET CHANGED");
    rmSync(path, { force: true });
  });
});
