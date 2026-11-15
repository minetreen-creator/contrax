import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  cleanPartnerOrder, PARTNER_PRODUCT, partnerFromMetadata, partnerMarketFor, partnerMetadata, partnerMonthlyCents, partnerNotice,
  partnerSiteFits,
  partnerSlug, partnerUnitCents,
} from "./reseller";

// Owner 2026-11-15: reseller pricing ("$199/client for 1-9, dropping to $149/client at 10+"),
// niche-matched previews, and "make sure these payments can be put on stripe too".
test("wholesale price is $199 a client, and $149 on every client from the tenth", () => {
  expect(partnerUnitCents(1)).toBe(19900);
  expect(partnerUnitCents(9)).toBe(19900);
  expect(partnerUnitCents(10)).toBe(14900);
  expect(partnerMonthlyCents(9)).toBe(179100);
  // Ten clients cost less than nine: the push to bring the whole roster.
  expect(partnerMonthlyCents(10)).toBe(149000);
  expect(partnerMonthlyCents(15)).toBe(223500);
});

test("an order needs a real email, a firm and 1 to 200 clients, and survives Stripe metadata", () => {
  expect(cleanPartnerOrder({ email: "a@b.co", firm: "Acme", clients: "7" })).toEqual({ email: "a@b.co", firm: "Acme", clients: 7 });
  for (const bad of [{ email: "x", firm: "Acme", clients: 3 }, { email: "a@b.co", firm: "", clients: 3 }, { email: "a@b.co", firm: "Acme", clients: 0 }, { email: "a@b.co", firm: "Acme", clients: 201 }]) expect(cleanPartnerOrder(bad)).toBeNull();
  const o = { email: "a@b.co", firm: "Acme Proposal Group", clients: 12 };
  expect(partnerMetadata(o).product).toBe(PARTNER_PRODUCT);
  expect(PARTNER_PRODUCT).toBe("contrax_reseller");
  expect(partnerFromMetadata(partnerMetadata(o))).toEqual(o);
  expect(partnerFromMetadata({ product: "contrax_managed" })).toBeNull();
  const n = partnerNotice(o, "started", "cs_1");
  expect(n.title).toBe("💰 New partner: $1,788 a month");
  expect(n.text).toContain("12 clients at $149 each, $1,788 a month");
});

test("the preview address is clean, and the sample fits what the firm's site talks about", () => {
  expect(partnerSlug("Acme Proposal Group, LLC")).toBe("acme-proposal-group-llc");
  expect(partnerSlug("Smith & Jones Consulting")).toBe("smith-and-jones-consulting");
  expect(partnerMarketFor("We help construction contractors and HVAC and electrical trades win bids")).toBe("trades");
  expect(partnerMarketFor("Proposal support for IT services, software and cyber firms")).toBe("it");
  expect(partnerMarketFor("We serve janitorial and custodial companies and landscaping crews")).toBe("janitorial");
  expect(partnerMarketFor("Capture and proposal consulting")).toBe("it");
  // "Contractors" alone is on every government-contracting site and must not tip it to trades.
  expect(partnerMarketFor("We help government contractors and federal contractors win. Engineering firms welcome.")).toBe("it");
  expect(partnerSiteFits("Proposal writing and capture management for small businesses")).toBe(true);
  expect(partnerSiteFits("We help small businesses win federal contracts")).toBe(true);
  expect(partnerSiteFits("We provide roofing, paving and site work to federal agencies")).toBe(false);
});

test("checkout bills per client through Stripe, its events stay off the plan tiers, and the preview only names firms we wrote to", () => {
  const server = readFileSync("src/lib/reseller.server.ts", "utf8");
  expect(server).toContain('mode: "subscription"');
  expect(server).toContain("quantity: order.clients");
  expect(server).toContain("unit_amount: partnerUnitCents(order.clients)");
  const stripe = readFileSync("src/lib/stripe.ts", "utf8");
  expect(stripe).toContain("if (await handleResellerEvent(event)) return { success: true };");
  // The older association checkout keeps its own address.
  expect(readFileSync("src/routes/api/partners/checkout.ts", "utf8")).not.toContain("reseller");
  const preview = readFileSync("src/routes/partner-preview.$firm.tsx", "utf8");
  expect(preview).toContain("WHERE kind = 'partner'");
  expect(preview).toContain('content: "noindex, nofollow"');
  expect(preview).toContain("is not affiliated with Contrax");
  const page = readFileSync("src/routes/resellers.tsx", "utf8");
  expect(page).toContain("<ResellerOrder />");
  expect(page).toContain("{PARTNER_RETAIL} a month");
});

// Owner 2026-11-15 ("operational checklist before pressing send"): a stated turnaround and a
// promise never to solicit a partner's clients, on the page, the preview and the owner's notice.
test("the turnaround and the client-ownership promise are stated wherever a partner decides", async () => {
  const { PARTNER_CLIENT_PROMISE, PARTNER_SLA } = await import("./reseller");
  expect(PARTNER_SLA).toBe("1 business day");
  expect(PARTNER_CLIENT_PROMISE).toContain("we never contact, market to or solicit your clients");
  const page = readFileSync("src/routes/resellers.tsx", "utf8");
  expect(page).toContain("{PARTNER_CLIENT_PROMISE}");
  expect(page).toContain("within {PARTNER_SLA}");
  expect(page).toContain("do-not-contact list");
  expect(readFileSync("src/routes/partner-preview.$firm.tsx", "utf8")).toContain("{PARTNER_CLIENT_PROMISE}");
  const n = partnerNotice({ email: "a@b.co", firm: "Acme", clients: 3 }, "started", "cs_2");
  expect(n.text).toContain("within 1 business day");
  expect(n.text).toContain("Add any client they name to Do not contact");
});

// Owner 2026-11-15: "Watermark the pages too".
test("the preview and the sample report carry the invisible mark, and the preview a visible one", async () => {
  const { decodeWatermarks, watermarkText } = await import("./bid-watermark");
  // The mark survives a copy and paste and decodes to the token that was served.
  expect(decodeWatermarks(watermarkText("Half of these contracts were awarded", "a1b2c3d4"))).toEqual(["a1b2c3d4"]);
  const preview = readFileSync("src/routes/partner-preview.$firm.tsx", "utf8");
  expect(preview).toContain("recordPageWatermark(`/partner-preview/");
  expect(preview).toContain("Preview · Contrax");
  expect(preview).toContain("pointer-events-none");
  expect(preview.match(/watermarkText\(/g)?.length).toBe(2);
  const sample = readFileSync("src/routes/sample-report.tsx", "utf8");
  expect(sample).toContain("recordPageWatermark(`/sample-report?m=${market.key}`)");
  expect(sample).toContain("watermarkText(");
  const server = readFileSync("src/lib/bid-watermark.server.ts", "utf8");
  expect(server).toContain("ADD COLUMN IF NOT EXISTS page TEXT");
  // The owner's trace tool names the page a mark came from.
  expect(readFileSync("src/routes/admin/command.tsx", "utf8")).toContain("Report page {h.page}");
});
