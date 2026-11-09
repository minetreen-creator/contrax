import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FREE_ACCOUNT_RADAR_SCANS } from "./radar-config";
import { STARTER_FIRST_MONTH_NOTE } from "./starter-offer";
import {
  passConfirmationEmail,
  STARTER_PASS_NOTE,
  STARTER_PASS_PRODUCT_DESCRIPTION,
  STARTER_PASS_SUBMIT_MESSAGE,
} from "./starter-pass";

// Owner 2026-11-09 ("Priority 1 — fix the customer journey"): searching is free, a Basic account is
// free, and the $5 Starter pass is one payment for 30 days that ends on its own. No trial, and never
// a line that reads like a charge coming unless the buyer says no.
const read = (f: string) => readFileSync(f, "utf8");

describe("one offer story", () => {
  test("the pass note is the same everywhere and says nothing renews", () => {
    expect(STARTER_FIRST_MONTH_NOTE).toBe(STARTER_PASS_NOTE);
    expect(STARTER_PASS_NOTE).toContain("Nothing renews");
    expect(STARTER_PASS_PRODUCT_DESCRIPTION).toContain("Nothing renews");
    expect(STARTER_PASS_SUBMIT_MESSAGE).toContain("won't be charged again unless you choose");
  });

  test("no page or email says 'ask before charging' or 'then $19'", () => {
    const files = [
      "src/lib/starter-pass.ts", "src/lib/starter-offer.ts", "src/routes/signup.tsx", "src/routes/pricing/index.tsx",
      "src/routes/copilot.tsx", "src/routes/compare/index.tsx", "src/components/TrialEndedCard.tsx",
      "src/components/UnlockBidSheet.tsx", "src/lib/trial-emails.ts", "src/lib/announcement-email.ts", "src/lib/chat.ts",
    ];
    for (const f of files) {
      const src = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");
      expect({ f, hit: /ask before charging|we ask before|then \$19/i.test(src) }).toEqual({ f, hit: false });
    }
  });

  test("no visible trial promise is left", () => {
    for (const f of ["src/lib/ai-brief-allowance.ts", "src/components/RfpSummaryCard.tsx", "src/routes/from-the-ceo.tsx"]) {
      expect(read(f)).not.toContain("7-day Professional trial · Cancel anytime");
      expect(read(f)).not.toContain("our new 7-day trial");
    }
    expect(read("src/components/CEOPosts.tsx")).toContain("Past update: the 7-day trial (ended November 1, 2026)");
    expect(read("src/lib/plan-gates.ts")).toContain('"$79/mo · Cancel anytime"');
    expect(read("src/lib/pipeline-contacts.ts")).toContain('"Starter: $5 for 30 days · Nothing renews"');
  });

  test("free Basic shows the real search limit, and a free signup never says 'Cancel anytime'", () => {
    expect(FREE_ACCOUNT_RADAR_SCANS).toBe(5);
    for (const f of ["src/routes/signup.tsx", "src/lib/plan-features.ts", "src/routes/pricing/index.tsx"]) {
      expect(read(f)).not.toContain("2 Radar searches");
    }
    expect(read("src/routes/signup.tsx")).toContain('selectedPlan === "basic" ? "Free forever"');
  });

  test("the buyer gets the end date in writing, on screen and by email", () => {
    const mail = passConfirmationEmail(new Date("2026-12-09T15:00:00Z"));
    expect(mail.subject).toBe("Your Contrax Starter pass: 30 days, ends December 9. Nothing renews");
    expect(mail.text).toContain("You will not be charged again, and there is nothing to cancel.");
    expect(read("src/lib/starter-pass.server.ts")).toContain("await sendPassConfirmation(firstPurchase[0].email, new Date(ends));");
    expect(read("src/routes/post-checkout.tsx")).toContain("Nothing renews</span>: on that day it simply ends");
    expect(read("src/lib/stripe.ts")).toContain("starterPass ? STARTER_PASS_SUBMIT_MESSAGE : CHECKOUT_SUBMIT_MESSAGE");
  });
});
