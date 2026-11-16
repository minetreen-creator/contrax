import { expect, test } from "bun:test";
import { coverageRow, sourceTotals, thinnest } from "./trade-coverage";

test("a state's tally counts its sources and marks the federal ones", () => {
  const r = coverageRow("MI", [{ source: "sam_naics_561720" }, { source: "mi_sigma" }, { source: "mi_sigma" }, { source: "" }]);
  expect(r).toEqual({ state: "MI", open: 4, federal: 1, sources: { sam_naics_561720: 1, mi_sigma: 2, unknown: 1 } });
});

test("the thinnest states are the ones with the fewest state and local bids", () => {
  const rows = [coverageRow("VA", [{ source: "va_eva" }, { source: "va_eva" }]), coverageRow("WY", [{ source: "sam_gov" }, { source: "sam_gov" }, { source: "sam_gov" }]), coverageRow("OH", [{ source: "oh_odot" }])];
  expect(thinnest(rows).map((r) => r.state)).toEqual(["WY", "OH", "VA"]);
  expect(sourceTotals(rows)).toEqual([["sam_gov", 3], ["va_eva", 2], ["oh_odot", 1]]);
});

test("the job is read-only and wired to a hand-run workflow", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const job = readFileSync("src/jobs/trade-coverage.ts", "utf8");
  expect(job).not.toMatch(/INSERT|UPDATE |DELETE |queue|resend/i);
  expect(readFileSync(".github/workflows/trade-coverage.yml", "utf8")).toContain("bun run trade-coverage");
  expect(readFileSync("package.json", "utf8")).toContain('"trade-coverage": "bun run src/jobs/trade-coverage.ts"');
});
