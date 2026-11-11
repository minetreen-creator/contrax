import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { alertJobFailedTwice, deadJobEmail, newlyFailedTwice } from "./source-alerts";

// Owner 2026-11-11 ("yes add it"): the subcontracting sweep failed 13 days in a row and told no one.
describe("a whole job that stops working warns the owner once", () => {
  test("warns the first time it has failed twice in a row, and not again while it stays down", () => {
    expect(newlyFailedTwice(["error", "error", "ok"])).toBe(true);
    expect(newlyFailedTwice(["error", "error"])).toBe(true); // a job with only two runs on record
    expect(newlyFailedTwice(["error", "ok", "ok"])).toBe(false); // one failure can be a hiccup
    expect(newlyFailedTwice(["error", "error", "error"])).toBe(false); // already warned
    expect(newlyFailedTwice(["ok", "error", "error"])).toBe(false); // recovered
    expect(newlyFailedTwice([])).toBe(false);
  });

  test("the email says what stopped, why, and what a visitor is missing", () => {
    const m = deadJobEmail(
      { name: "Subcontracting notices (SBA SUBNet)", effect: "the notices on /subcontracts are not updating" },
      "GET https://legacy.sba.gov/opportunity/x failed after 1 attempt(s): HTTP 403 Forbidden",
    );
    expect(m.subject).toBe("Contrax: Subcontracting notices (SBA SUBNet) has stopped working");
    expect(m.text).toContain("failed two runs in a row, so the notices on /subcontracts are not updating");
    expect(m.text).toContain("the site is refusing our reader");
    expect(m.text).toContain("Ask Claude to look at it.");
    expect(m.push.title).toBe("Subcontracting notices (SBA SUBNet) stopped working");
  });

  test("nothing is sent unless it just failed twice", async () => {
    expect(await alertJobFailedTwice({ name: "X", effect: "y" }, "boom", ["error", "ok"])).toBe(false);
    expect(await alertJobFailedTwice({ name: "X", effect: "y" }, "boom", ["error", "error", "error"])).toBe(false);
  });

  test("the subcontracting job calls it after a failed run, and its workflow can send the email", () => {
    const job = readFileSync("src/jobs/subcontract-sync.ts", "utf8");
    expect(job).toContain("await alertJobFailedTwice(");
    expect(job).toContain("recentSubcontractSyncStatuses(SUBNET_SOURCE.sourceKey, 3)");
    expect(job.indexOf("await alertJobFailedTwice(")).toBeLessThan(job.indexOf("process.exit("));
    // A dry run writes no run row, so it must not warn.
    expect(job).toContain("if (!dryRun) {");
    expect(readFileSync(".github/workflows/sync-subcontracts.yml", "utf8")).toContain("RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}");
  });
});
