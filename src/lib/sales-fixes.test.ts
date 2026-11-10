import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CHECKOUT_TRUST_TEXT } from "../components/CheckoutTrust";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// Owner 2026-11-10: "No app downloads and no sales".
describe("sales fixes", () => {
  test("the trust line names Stripe, Apple Pay / Google Pay and no auto-renew, under every main $5 button", () => {
    expect(CHECKOUT_TRUST_TEXT).toContain("Secure checkout by Stripe");
    expect(CHECKOUT_TRUST_TEXT).toContain("Apple Pay or Google Pay");
    expect(CHECKOUT_TRUST_TEXT).toContain("No auto-renew");
    for (const f of ["../routes/radar.tsx", "../components/UnlockBidSheet.tsx", "../components/HomeContractFinder.tsx", "./seo-landing.tsx", "../routes/pricing/index.tsx"]) {
      expect(read(f)).toContain("<CheckoutTrust");
    }
  });

  test("the app banner shows only to paid members (alerts need a paid plan), and on their dashboard", () => {
    const banner = read("../components/AppInstallBanner.tsx");
    expect(banner).toContain("hasPaidBidAccess");
    expect(banner).toContain("if (!due || hold || !paid || shown.current || !platform) return;");
    expect(read("../routes/dashboard.tsx")).toContain('<AppInstallBanner where="dashboard" />');
  });
});
