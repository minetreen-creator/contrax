import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PASS_CONTINUE_MIN_LEAD_SECONDS,
  STARTER_PASS_CONTINUE_CENTS,
  STARTER_PASS_NOTE,
  passConfirmationEmail,
  passContinueSubmitMessage,
  passContinueTrialEnd,
  passReminderEmail,
} from "./starter-pass";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("a pass buyer can keep going at $14 a month, by choice (owner 2026-11-22)", () => {
  test("the pass itself is still one payment that does not renew", () => {
    expect(STARTER_PASS_NOTE).toContain("$9 one time for 30 days. Nothing renews");
    expect(STARTER_PASS_NOTE).toContain("unless you choose Starter at $14/month");
    expect(STARTER_PASS_CONTINUE_CENTS).toBe(1400);
  });

  test("the first monthly charge waits for the day the pass ends", () => {
    const now = Date.UTC(2026, 10, 22, 12);
    const ends = new Date(Date.UTC(2026, 11, 22, 12));
    expect(passContinueTrialEnd(ends, now)).toBe(Math.floor(ends.getTime() / 1000));
    // Too close for Stripe to schedule, already ended, or no pass: the month starts right away.
    expect(passContinueTrialEnd(new Date(now + (PASS_CONTINUE_MIN_LEAD_SECONDS - 60) * 1000), now)).toBeNull();
    expect(passContinueTrialEnd(new Date(now - 86_400_000), now)).toBeNull();
    expect(passContinueTrialEnd(null, now)).toBeNull();
  });

  test("Stripe's page says whether anything is charged today", () => {
    expect(passContinueSubmitMessage("December 22")).toContain("No charge today.");
    expect(passContinueSubmitMessage("December 22")).toContain("$14 a month");
    expect(passContinueSubmitMessage(null)).toContain("from today");
  });

  test("both emails quote $14 a month as the price to continue", () => {
    const ends = new Date(Date.UTC(2026, 11, 22, 12));
    const confirm = passConfirmationEmail(ends, { continueUrl: "https://www.contrax.company/api/renew-pass?t=x" });
    expect(confirm.text).toContain("Starter is $14 a month.");
    expect(confirm.text).toContain("https://www.contrax.company/api/renew-pass?t=x");
    expect(confirm.text).toContain("You will not be charged again, and there is nothing to cancel.");
    expect(passConfirmationEmail(ends).text).not.toContain("renew-pass");
    const remind = passReminderEmail(ends);
    expect(remind.text).toContain("Keep my bid emails ($14/month)");
    expect(remind.text).not.toContain("$9/month");
  });

  test("the checkout charges the pass holder's price and only delays the charge for them", () => {
    const stripe = read("./stripe.ts");
    expect(stripe).toContain("unit_amount: STARTER_PASS_CONTINUE_CENTS");
    expect(stripe).toContain("...(trialEnd ? { trial_end: trialEnd } : {})");
    expect(stripe).toContain("const trialEnd = passContinue &&");
    expect(read("../routes/api/renew-pass.ts")).toContain("passContinue: true");
    const page = read("../routes/post-checkout.tsx");
    expect(page).toContain("{PASS_CONTINUE_BUTTON}");
    expect(page).toContain('trackEvent("pass_continue_click", "post_checkout")');
  });
});
