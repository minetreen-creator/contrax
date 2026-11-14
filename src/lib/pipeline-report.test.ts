import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { REPORT_CREDIT_NOTE, REPORT_DELIVERY, REPORT_INCLUDES, REPORT_PRICE, REPORT_PRICE_CENTS, cleanOrder, orderAlert, orderFromMetadata, orderMetadata, ownerNotice, runLine, tradeForText } from "./pipeline-report";

// Owner 2026-11-14: a one-time report for $149 before asking for $499 a month.
const good = { email: " Buyer@Example.com ", company: "Acme  Federal", state: "va", trade: "IT services" };

test("one price, stated once", () => {
  expect(REPORT_PRICE).toBe("$149");
  expect(REPORT_PRICE_CENTS).toBe(14900);
});

test("an order needs a real email, company, state and line of work", () => {
  expect(cleanOrder(good)).toEqual({ email: "buyer@example.com", company: "Acme Federal", state: "VA", trade: "IT services" });
  expect(cleanOrder({ ...good, email: "nope" })).toBeNull();
  expect(cleanOrder({ ...good, state: "ZZ" })).toBeNull();
  expect(cleanOrder({ ...good, trade: "" })).toBeNull();
  expect(cleanOrder({ ...good, company: 7 })).toBeNull();
  expect(cleanOrder(null)).toBeNull();
});

test("the order survives the trip through Stripe metadata, and other products are ignored", () => {
  const order = cleanOrder(good)!;
  expect(orderFromMetadata(orderMetadata(order))).toEqual(order);
  expect(orderFromMetadata({ ...orderMetadata(order), product: "bid_fit_review" })).toBeNull();
  expect(orderFromMetadata(null)).toBeNull();
});

test("the owner's notice says what was bought and where to send it", () => {
  const n = ownerNotice(cleanOrder(good)!, "cs_test_1");
  expect(n.subject).toBe("PAID: $149 pipeline report, IT services in Virginia");
  expect(n.text).toContain("Send to: buyer@example.com");
  expect(n.text).toContain("cs_test_1");
});

test("checkout charges the stated price, only a paid session notifies, and the webhook is wired", () => {
  const server = readFileSync("src/lib/pipeline-report.server.ts", "utf8");
  expect(server).toContain("unit_amount: REPORT_PRICE_CENTS");
  expect(server).toContain('mode: "payment"');
  expect(server).toContain("session.amount_total === REPORT_PRICE_CENTS");
  expect(server).toContain("if (!isPaidReportSession(session)) return true;");
  expect(readFileSync("src/lib/stripe.ts", "utf8")).toContain("if (await handleReportEvent(event)) return { success: true };");
  const route = readFileSync("src/routes/api/pipeline-report/checkout.ts", "utf8");
  expect(route).toContain("checkIpLimit");
  expect(route).toContain("cleanOrder(raw)");
});

test("the teams page offers the single report above the monthly one", () => {
  const page = readFileSync("src/routes/teams.tsx", "utf8");
  expect(page).toContain('<section id="done-for-you"');
  expect(page.indexOf("<PipelineReportOrder />")).toBeLessThan(page.indexOf("Contrax Managed: {MANAGED_PRICE} a month"));
  const form = readFileSync("src/components/PipelineReportOrder.tsx", "utf8");
  expect(form).toContain("One payment, no subscription.");
  expect(form).toContain("not a promise of a rebid");
});

// Owner 2026-11-14: say exactly what is in it, when it arrives, and how it counts toward Managed.
test("the report states its contents in numbers, a delivery window and the credit toward Managed", () => {
  expect(REPORT_DELIVERY).toBe("1 business day");
  expect(REPORT_INCLUDES.join(" ")).toMatch(/25 largest.*10 agencies.*10 companies.*awarded for.*Up to 5 open bids/);
  expect(REPORT_CREDIT_NOTE).toBe("Move to Contrax Managed within 14 days and the $149 comes off your first month.");
  const form = readFileSync("src/components/PipelineReportOrder.tsx", "utf8");
  expect(form).toContain("Delivered to your inbox within {REPORT_DELIVERY} of payment.");
  expect(form).toContain("{REPORT_CREDIT_NOTE}");
  const page = readFileSync("src/routes/teams.tsx", "utf8");
  expect(page).toContain("Everything in the one-time report, rebuilt every month");
  expect(page).toContain("Bought the one-time report first? {REPORT_CREDIT_NOTE}");
  // The report promises only what the data job returns.
  const job = readFileSync("src/lib/pipeline-report-data.server.ts", "utf8");
  expect(job).toContain("LIMIT 25");
  expect(job).toContain("LIMIT 12");
  expect(job).toContain("LIMIT 10");
  expect(job).toContain("percentile_cont(0.5)");
  expect(job).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  expect(readFileSync("src/jobs/managed-report-data.ts", "utf8")).toContain('from "~/lib/pipeline-report-data.server"');
});

// Owner 2026-11-14: map what they sell to the trade the data job takes, and tell Mission Control.
test("a buyer's own words become the data job's trade, or a prompt to ask", () => {
  expect(tradeForText("IT services")).toBe("it-services");
  expect(tradeForText("Cloud and software development")).toBe("it-services");
  expect(tradeForText("Cybersecurity and zero trust")).toBe("cybersecurity");
  expect(tradeForText("commercial cleaning")).toBe("janitorial");
  expect(tradeForText("Paving and concrete")).toBe("construction");
  expect(tradeForText("trash pickup")).toBe("waste-hauling");
  expect(tradeForText("unit training")).toBeNull();
  const order = cleanOrder(good)!;
  expect(runLine(order)).toBe('Report data: run "Managed report data" with state VA and trade it-services.');
  expect(runLine({ ...order, trade: "court reporting" })).toContain("matches no trade on the site");
  expect(ownerNotice(order, "cs_1").text).toContain("state VA and trade it-services");
});

test("Mission Control is told when an order starts and when it is paid, once each", () => {
  const order = cleanOrder(good)!;
  const paid = orderAlert(order, "cs_test_1", true);
  expect(paid.title).toBe("💵 $149 report paid");
  expect(paid.body).toContain("Acme Federal: IT services in Virginia");
  expect(paid.url).toBe("/admin/live");
  const started = orderAlert(order, "cs_test_1", false);
  expect(started.title).toBe("🧾 Report checkout started");
  expect(started.tag).not.toBe(paid.tag);
  const push = readFileSync("src/lib/live-push.server.ts", "utf8");
  expect(push).toContain("VALUES ('pipeline-report', ${alert.tag})");
  expect(readFileSync("src/lib/pipeline-report.server.ts", "utf8")).toContain("orderAlert(order, session.id, true)");
  expect(readFileSync("src/routes/api/pipeline-report/checkout.ts", "utf8")).toContain("orderAlert(order, sessionId, false)");
});

test("the snapshot reads as a first look, not a cheaper Managed", () => {
  const page = readFileSync("src/routes/teams.tsx", "utf8");
  expect(page).toContain("SNAPSHOT_VS_MANAGED");
  expect(page).toContain(`["Updates", "None. One day's picture", "Rebuilt every month with what changed"]`);
  expect(readFileSync("src/components/PipelineReportOrder.tsx", "utf8")).toContain("does not update");
});

// Owner 2026-11-14 (competitor review): a real sample anyone can read, built by the paid report's own function.
test("the sample report is public, live, and the same function a paid report uses", () => {
  const page = readFileSync("src/routes/sample-report.tsx", "utf8");
  expect(page).toContain('await reportData(SAMPLE_STATE, SAMPLE_TRADE, 12)');
  expect(page).toContain('{ name: "robots", content: "index, follow" }');
  expect(page).toContain("not a promise that the work will be rebid");
  expect(page).toContain("not as a price to bid");
  expect(readFileSync("scripts/generate-sitemap.mjs", "utf8")).toContain('["/sample-report", "weekly", "0.7"]');
  expect(readFileSync("src/components/PipelineReportOrder.tsx", "utf8")).toContain('href="/sample-report"');
  // Open bids are kept only when the title reads as the trade.
  expect(readFileSync("src/lib/pipeline-report-data.server.ts", "utf8")).toContain("tradeForText(b.title) === trade");
});
