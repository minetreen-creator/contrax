import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-06: "hide the extra features and simplify the offer".
test("one offer: no yearly toggle, a short FAQ, and the extras off the main pages", () => {
  const pricing = readFileSync("src/routes/pricing/index.tsx", "utf8");
  expect(pricing).not.toContain('aria-label="Billing period"');
  expect(pricing).not.toContain("Is there a yearly plan?");
  expect(pricing).not.toContain("Can I switch plans later?");
  const dash = readFileSync("src/routes/dashboard.tsx", "utf8");
  for (const href of ['href="/evaluate"', 'href="/competitors"', 'href="/losses"', 'href="/learnings"', 'href="/trends"', 'href="/awards"', 'href="/compliance"', 'href="/workspace"']) {
    expect(dash).not.toContain(href);
  }
  expect(dash).not.toContain("<LaunchpadDashboardCard");
  const home = readFileSync("src/routes/index.tsx", "utf8");
  expect(home).not.toContain("<FoundingWall />");
  expect(home).not.toContain("<MaxAssistant />");
  expect(readFileSync("src/components/SiteHeader.tsx", "utf8")).not.toContain("Industry Days");
});
