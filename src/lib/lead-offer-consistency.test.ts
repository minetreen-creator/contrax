import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { RADAR_ALERT_PASS_URL } from "./email";
import { SYSTEM_PROMPT } from "./chat";

// Owner 2026-11-08: "these people put their email addresses in but never pay the $5".
// The weekly email to people who only gave an email still offered $19/month (or $99 a year),
// and Max still described a 7-day trial that no longer exists.
describe("email-only leads and Max are offered the $5 pass", () => {
  test("Radar match-alert email offers the $5 pass, not $19/month or the founding year", () => {
    expect(RADAR_ALERT_PASS_URL).toBe("https://www.contrax.company/upgrade?plan=starter&source=radar_alert");
    const src = readFileSync(new URL("./email.ts", import.meta.url), "utf8");
    const start = src.indexOf("function radarMatchAlertHtml");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).toContain("Get the $5 pass");
    expect(body).not.toContain("$19/month");
    expect(body).not.toContain("founding-businesses");
  });

  test("Max tells people about the $5 pass and no automatic trial", () => {
    expect(SYSTEM_PROMPT).toContain("$5 pass");
    expect(SYSTEM_PROMPT).toContain("There is no automatic free trial");
    expect(SYSTEM_PROMPT).not.toContain("7-day Professional trial");
  });
});
