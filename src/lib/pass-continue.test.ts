import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PASS_CONTINUE_MIN_LEAD_SECONDS,
  RENEWAL_REMIND_DAYS,
  STARTER_PASS_AMOUNT,
  STARTER_PASS_CONTINUE_CENTS,
  STARTER_PASS_NOTE,
  STARTER_PASS_SUBMIT_MESSAGE,
  passConfirmationEmail,
  passContinueSubmitMessage,
  passContinueTrialEnd,
  passReminderEmail,
  renewalReminderAmount,
  renewalReminderDue,
  renewalReminderEmail,
  starterMonthlyConfirmationEmail,
  starterMonthlyOwnerAlert,
  starterNextChargeAt,
} from "./starter-pass";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// Owner 2026-11-22: "maybe we should make the $9 recurring", then "1" for "$9 a month, automatic,
// cancel anytime". One price, no jump, and the renewal is said everywhere the price is.
describe("Starter is $9 a month for a new buyer (owner 2026-11-22)", () => {
  test("one price: $9 to start, $9 each month, and the same $9 for a pass holder who continues", () => {
    expect(STARTER_PASS_AMOUNT).toBe(900);
    expect(STARTER_PASS_CONTINUE_CENTS).toBe(900);
    expect(STARTER_PASS_NOTE).toContain("$9 a month. Renews each month until you cancel");
    expect(STARTER_PASS_SUBMIT_MESSAGE).toContain("$9 today, then $9 each month until you cancel");
    expect(STARTER_PASS_SUBMIT_MESSAGE).toContain("Cancel anytime in Settings");
  });

  test("the checkout is a monthly subscription, marked so the one-time pass rules never touch it", () => {
    const stripe = read("./stripe.ts");
    expect(stripe).toContain('unit_amount: STARTER_PASS_AMOUNT,\n          recurring: { interval: "month" },');
    expect(stripe).toContain('const sessionMode: CheckoutMode = starterPass ? "subscription" : mode;');
    expect(stripe).toContain('if (starterPass) metadata[STARTER_MONTHLY_FLAG] = "true";');
    expect(stripe).not.toContain("metadata[STARTER_PASS_FLAG]");
    const server = read("./starter-pass.server.ts");
    expect(server).toContain('session.metadata?.[STARTER_MONTHLY_FLAG] === "true"');
    expect(server).toContain("starterMonthlyConfirmationEmail(next)");
  });

  test("the next charge is the same day next month, as Stripe bills it", () => {
    const sec = (y: number, m: number, d: number) => Date.UTC(y, m, d, 15) / 1000;
    expect(starterNextChargeAt(sec(2026, 10, 22)).toISOString()).toBe("2026-12-22T15:00:00.000Z");
    expect(starterNextChargeAt(sec(2026, 11, 22)).toISOString()).toBe("2027-01-22T15:00:00.000Z");
    expect(starterNextChargeAt(sec(2027, 0, 31)).toISOString()).toBe("2027-02-28T15:00:00.000Z");
  });

  test("the buyer's confirmation says what was charged, that it renews, when, and how to cancel", () => {
    const mail = starterMonthlyConfirmationEmail(new Date(Date.UTC(2026, 11, 22, 15)));
    expect(mail.subject).toBe("Your Contrax Starter plan: $9 a month, next charge December 22");
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("each month");
      expect(body).toContain("December 22");
      expect(body).toContain("https://www.contrax.company/settings");
      expect(body).toContain(`reminder ${RENEWAL_REMIND_DAYS} days before each charge`);
      expect(body).not.toContain("Nothing renews");
    }
    expect(mail.text).toContain("You paid $9 today. Starter renews at $9 each month until you cancel");
  });

  test("the reminder before each charge names the amount, the date and how to cancel", () => {
    const mail = renewalReminderEmail(new Date(Date.UTC(2026, 11, 22, 15)), 900);
    expect(mail.subject).toBe("Your Contrax Starter plan renews on December 22 ($9)");
    expect(mail.text).toContain("Your card will be charged $9 for the next month.");
    expect(mail.text).toContain("To cancel, open Settings and choose Manage subscription before that date.");
    expect(renewalReminderEmail(new Date(Date.UTC(2026, 11, 22, 15)), 1400).subject).toContain("($14)");
  });

  test("the reminder goes out once per charge, three days ahead", () => {
    const now = Date.UTC(2026, 11, 20, 12);
    const end = new Date(Date.UTC(2026, 11, 22, 15));
    expect(RENEWAL_REMIND_DAYS).toBe(3);
    expect(renewalReminderDue({ periodEnd: end, remindedFor: null }, now)).toBe(true);
    expect(renewalReminderDue({ periodEnd: end, remindedFor: end }, now)).toBe(false);
    // Reminded for last month's charge: this month's is due again.
    expect(renewalReminderDue({ periodEnd: end, remindedFor: new Date(Date.UTC(2026, 10, 22, 15)) }, now)).toBe(true);
    expect(renewalReminderDue({ periodEnd: new Date(Date.UTC(2026, 11, 30)), remindedFor: null }, now)).toBe(false);
    expect(renewalReminderDue({ periodEnd: new Date(Date.UTC(2026, 11, 19)), remindedFor: null }, now)).toBe(false);
    expect(renewalReminderDue({ periodEnd: null, remindedFor: null }, now)).toBe(false);
  });

  test("a subscriber who has cancelled, or is not billed monthly, is never told a charge is coming", () => {
    const monthly = { items: { data: [{ price: { unit_amount: 900, recurring: { interval: "month" } } }] } };
    expect(renewalReminderAmount({ status: "active", ...monthly })).toBe(900);
    expect(renewalReminderAmount({ status: "active", cancel_at_period_end: true, ...monthly })).toBeNull();
    expect(renewalReminderAmount({ status: "active", cancel_at: 1_800_000_000, ...monthly })).toBeNull();
    expect(renewalReminderAmount({ status: "canceled", ...monthly })).toBeNull();
    expect(renewalReminderAmount({ status: "active", items: { data: [{ price: { unit_amount: 14000, recurring: { interval: "year" } } }] } })).toBeNull();
    expect(renewalReminderAmount({ status: "active" })).toBeNull();
    const server = read("./starter-pass.server.ts");
    expect(server).toContain("renewals = await sendRenewalReminders();");
    expect(server).toContain("subscriptions.retrieve(u.stripe_subscription_id)");
  });

  test("the owner hears about a new monthly subscriber", () => {
    const alert = starterMonthlyOwnerAlert("buyer@example.com", new Date(Date.UTC(2026, 11, 22, 15)));
    expect(alert.subject).toBe("💰 New $9/month Starter: buyer@example.com");
    expect(alert.push.body).toContain("next charge December 22");
  });

  test("after paying, the page says it renews and where to cancel", () => {
    const page = read("../routes/post-checkout.tsx");
    expect(page).toContain("Starter renews at <span className=\"font-semibold\">$9 each month</span> until you cancel");
    expect(page).toContain('session.metadata?.starter_monthly === "true"');
  });
});

describe("a one-time pass sold before 2026-11-22 stays as it was sold", () => {
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
    expect(passContinueSubmitMessage("December 22")).toContain("$9 a month");
    expect(passContinueSubmitMessage(null)).toContain("from today");
  });

  test("its emails quote $9 a month as the price to continue, and never charge on their own", () => {
    const ends = new Date(Date.UTC(2026, 11, 22, 12));
    const confirm = passConfirmationEmail(ends, { continueUrl: "https://www.contrax.company/api/renew-pass?t=x" });
    expect(confirm.text).toContain("Starter is $9 a month.");
    expect(confirm.text).toContain("https://www.contrax.company/api/renew-pass?t=x");
    const remind = passReminderEmail(ends);
    expect(remind.text).toContain("Keep my bid emails ($9/month)");
    expect(remind.text).toContain("If you do nothing, you won't be charged.");
    expect(remind.text).not.toContain("$14");
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
