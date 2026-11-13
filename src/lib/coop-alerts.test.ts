import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { coopAlertEmail, newForAlert } from "./coop-alerts";
import type { CoopSolicitation } from "./coop-contracts";

// Owner 2026-11-13: "Notify me when my trade opens"; "no daily email".
const sol = (key: string, trades: string[], dueAt: string | null = "2026-12-01T20:00:00Z"): CoopSolicitation => ({
  key, coop: "sourcewell", number: "120126", title: `Roofing ${key}`, dueAt, url: "https://www.sourcewell-mn.gov/solicitations/x", trades, construction: false,
});

test("only new, dated categories for the subscriber's trade are sent", () => {
  const open = [sol("a", ["roofing"]), sol("b", ["roofing"], null), sol("c", ["hvac"]), sol("d", ["roofing"])];
  expect(newForAlert("roofing", open, ["a"]).map((s) => s.key)).toEqual(["d"]);
  expect(newForAlert("roofing", open, ["a", "d"])).toEqual([]);
});

test("the email lists the co-op's own facts and has a one-click unsubscribe", () => {
  const m = coopAlertEmail("construction", [sol("x", ["construction"])], "tok123");
  expect(m.subject).toContain("co-op contract just opened");
  expect(m.text).toContain("https://www.sourcewell-mn.gov/solicitations/x");
  expect(m.html).toContain("coop-alert-unsubscribe?token=tok123");
});

test("the sync sends only when something new opens, and the page offers the alert", () => {
  const sync = readFileSync("src/jobs/coop-sync.ts", "utf8");
  expect(sync).toContain("newForAlert(a.trade, open, a.notified_keys)");
  expect(sync).toContain("if (!fresh.length) continue;");
  expect(readFileSync(".github/workflows/coop-sync.yml", "utf8")).toContain("RESEND_API_KEY");
  const page = readFileSync("src/routes/co-op-contracts.tsx", "utf8");
  expect(page).toContain("<CoopAlertForm");
  expect(page).toContain("a way in for local installers");
});
