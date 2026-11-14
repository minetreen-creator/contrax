import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ENDING_ALERT_DAYS, ENDING_ALERT_PER_EMAIL, ENDING_ALERT_RUN_CAP, alertTradeFor, endingAlertEmail } from "./ending-alerts";

// Owner 2026-11-14 (competitor review, idea 1): alerts before a contract ends.
const row = (k: string, amount: number) => ({ award_key: k, recipient_name: `Holder ${k}`, amount, end_date: "2027-05-10", agency: "Department of Veterans Affairs" });
const UNSUB = "https://www.contrax.company/api/radar/lead-unsubscribe?token=t";

test("a subscriber's stored trade means one of the site's trades, or nothing", () => {
  expect(alertTradeFor("IT services")).toBe("it-services");
  expect(alertTradeFor("janitorial")).toBe("janitorial");
  expect(alertTradeFor("security guard")).toBe("security-guard");
  expect(alertTradeFor("561720")).toBe("janitorial");
  expect(alertTradeFor("999999")).toBeNull();
  expect(alertTradeFor("")).toBeNull();
  expect(alertTradeFor(null)).toBeNull();
});

test("the email lists at most five contracts, links each record, and never promises a rebid", () => {
  const m = endingAlertEmail({ state: "VA", trade: "it-services", rows: [1, 2, 3, 4, 5, 6, 7].map((n) => row(`K${n}`, n * 1_000_000)), unsubscribeUrl: UNSUB })!;
  expect(m.subject).toBe("5 it services contracts in Virginia end in about 6 months");
  expect((m.text.match(/usaspending\.gov\/award\//g) ?? []).length).toBe(ENDING_ALERT_PER_EMAIL);
  expect(m.text).toContain("not a promise that the work will be rebid");
  expect(m.text).toContain(`Unsubscribe: ${UNSUB}`);
  expect(m.html).toContain(`<a href="${UNSUB}">Unsubscribe</a>`);
  expect(m.text).toContain("recompetes?trade=it-services&state=VA");
});

test("one contract reads in the singular; no contracts or an unknown market sends nothing", () => {
  expect(endingAlertEmail({ state: "TX", trade: "construction", rows: [row("A", 5e6)], unsubscribeUrl: UNSUB })!.subject).toBe("A construction contract in Texas ends in about 6 months");
  expect(endingAlertEmail({ state: "TX", trade: "construction", rows: [], unsubscribeUrl: UNSUB })).toBeNull();
  expect(endingAlertEmail({ state: "ZZ", trade: "construction", rows: [row("A", 1)], unsubscribeUrl: UNSUB })).toBeNull();
});

test("holder names are escaped in the HTML", () => {
  const m = endingAlertEmail({ state: "VA", trade: "janitorial", rows: [{ ...row("A", 1e6), recipient_name: "A & B <CO>" }], unsubscribeUrl: UNSUB })!;
  expect(m.html).toContain("A &amp; B &lt;CO&gt;");
});

test("the sender only writes its own sent-log, respects opt-in and unsubscribe, and is dry by default", () => {
  const job = readFileSync("src/jobs/ending-alerts.ts", "utf8");
  expect(job).toContain("confirmed_at IS NOT NULL AND unsubscribed_at IS NULL AND consent = TRUE");
  expect(job).toContain('const apply = process.env.APPLY === "true";');
  expect(job).toContain("if (sent >= ENDING_ALERT_RUN_CAP) break;");
  expect(job.match(/INSERT INTO (\w+)/g)).toEqual(["INSERT INTO ending_alerts_sent"]);
  expect(job).not.toMatch(/\b(UPDATE|DELETE)\b/);
  expect(ENDING_ALERT_DAYS).toBe(180);
  expect(ENDING_ALERT_RUN_CAP).toBeLessThanOrEqual(60);
  const wf = readFileSync(".github/workflows/ending-alerts.yml", "utf8");
  expect(wf).toContain('cron: "17 14 * * 0"');
  expect(wf).toContain("inputs.apply");
  expect(readFileSync("package.json", "utf8")).toContain('"ending-alerts": "bun run src/jobs/ending-alerts.ts"');
});
