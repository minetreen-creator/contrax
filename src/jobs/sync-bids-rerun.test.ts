import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-13 ("add the re-run"): a bid sync that dies from a GitHub problem re-runs once.
describe("a failed bid sync re-runs once", () => {
  const wf = readFileSync(".github/workflows/sync-bids-rerun.yml", "utf8");

  test("it follows the Sync Bids workflow by name", () => {
    expect(wf).toContain('workflows: ["Sync Bids"]');
    expect(readFileSync(".github/workflows/sync-bids.yml", "utf8").split("\n")[0]).toBe("name: Sync Bids");
  });

  test("only a failed first attempt is re-run, never a cancelled or second one", () => {
    expect(wf).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(wf).toContain("github.event.workflow_run.run_attempt == 1");
    expect(wf).not.toContain("'cancelled'");
  });

  test("it re-runs only the failed job, with no more access than that needs", () => {
    expect(wf).toContain('gh run rerun "$RUN_ID" --failed');
    expect(wf).toMatch(/permissions:\n  actions: write\n/);
    expect(wf).not.toContain("secrets.");
  });
});
