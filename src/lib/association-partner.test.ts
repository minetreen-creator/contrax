import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PARTNER_CENTS, PARTNER_PRODUCT, partnerMetadata, partnerOwnerAlert, validatePartnerForm } from "./association-partner";

// Owner 2026-11-05: "We need a checkout option for that $149/month".
const good = { organization: "NAMC Central Texas", contactName: "Pat Lee", email: "Info@Example.org", region: "Central Texas", website: "" };

describe("Association Partner checkout", () => {
  test("the plan is $149 a month on its own product line", () => {
    expect(PARTNER_CENTS).toBe(14900);
    expect(PARTNER_PRODUCT).toBe("association_partner");
  });

  test("a complete form is accepted and cleaned", () => {
    const v = validatePartnerForm({ ...good, organization: "  NAMC   Central Texas " });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.organization).toBe("NAMC Central Texas");
      expect(v.value.email).toBe("info@example.org");
    }
  });

  test("missing fields and bots are refused in plain words", () => {
    expect(validatePartnerForm({ ...good, organization: "" })).toEqual({ ok: false, error: "Please enter your organization's name." });
    expect(validatePartnerForm({ ...good, email: "nope" })).toEqual({ ok: false, error: "Please enter a valid email address." });
    expect(validatePartnerForm({ ...good, region: "" }).ok).toBe(false);
    expect(validatePartnerForm({ ...good, company_site: "spam" }).ok).toBe(false);
    expect(validatePartnerForm(null).ok).toBe(false);
  });

  test("Stripe metadata tags the product and fits Stripe's limits", () => {
    const m = partnerMetadata({ ...good, region: "x".repeat(900) });
    expect(m.product).toBe("association_partner");
    for (const v of Object.values(m)) expect(v.length).toBeLessThanOrEqual(500);
  });

  test("the owner hears about every new partner", () => {
    expect(partnerOwnerAlert("NAMC Central Texas", "info@example.org").title).toContain("$149/month");
  });

  test("checkout is a monthly subscription that returns to /associations", () => {
    const src = readFileSync("src/lib/association-partner.server.ts", "utf8");
    expect(src).toContain('mode: "subscription"');
    expect(src).toContain('recurring: { interval: "month" }');
    expect(src).toContain("/associations?checkout=success");
    expect(src).toContain("subscription_data: { metadata }");
  });

  test("the one verified webhook hands partner events to their own handler before the user-plan flow", () => {
    const s = readFileSync("src/lib/stripe.ts", "utf8");
    const partner = s.indexOf("handlePartnerEvent(event)");
    expect(partner).toBeGreaterThan(0);
    expect(partner).toBeLessThan(s.indexOf("handleTierSubscriptionEvent(event)"));
    expect(partner).toBeLessThan(s.indexOf('Only handle checkout.session.completed'));
  });

  test("the existing /partners page is untouched; the plan lives at /associations", () => {
    expect(readFileSync("src/routes/associations.tsx", "utf8")).toContain('createFileRoute("/associations")');
    expect(readFileSync("src/routes/partners.tsx", "utf8")).not.toContain("Association Partner");
  });
});
