import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  emptyLaunchpad,
  parseLaunchpad,
  capabilityReady,
  launchpadSteps,
  launchpadRadarHref,
  safeOpportunityUrl,
  capabilityPrintHtml,
  capabilityText,
} from "./launchpad";
test("Launchpad restores safe drafts, computes preparation steps and exports only supplied facts", () => {
  const d = emptyLaunchpad();
  assert.equal(launchpadSteps(d, false).filter((x) => x.done).length, 0);
  assert.throws(() => parseLaunchpad("{bad"));
  assert.throws(() => parseLaunchpad('{"version":9}'));
  assert.deepEqual(parseLaunchpad(null), d);
  const restored = parseLaunchpad(
    JSON.stringify({
      version: 1,
      profile: { company: "Acme", state: "xx" },
      registrations: ["buyers", "bogus", "buyers"],
      bid: { scope: "true", decision: "approved" },
    }),
  );
  assert.equal(restored.profile.company, "Acme");
  assert.equal(restored.profile.state, "");
  assert.deepEqual(restored.registrations, ["buyers"]);
  assert.equal(restored.bid.scope, false);
  assert.equal(restored.bid.decision, "");
  assert.equal(safeOpportunityUrl("javascript:alert(1)"), null);
  assert.equal(safeOpportunityUrl("https://user:password@example.com"), null);
  assert.equal(
    safeOpportunityUrl("https://example.com/bid"),
    "https://example.com/bid",
  );
  d.profile = {
    ...d.profile,
    company: "Acme <script>alert(1)</script>",
    trade: "cleaning",
    state: "VA",
    contact: "Owner",
    email: "owner@example.com",
    summary: "We clean offices.",
    competencies: "Janitorial",
    differentiators: "Local team",
  };
  assert(capabilityReady(d.profile));
  assert(!capabilityReady({ ...d.profile, email: "wrong" }));
  const print = capabilityPrintHtml(d.profile);
  assert(!print.includes("<script>"));
  assert(print.includes("&lt;script&gt;"));
  assert(!capabilityText(d.profile).includes("UEI:"));
  assert(capabilityText(d.profile).includes("Company overview"));
  const href = new URL(launchpadRadarHref(d.profile), "https://example.com");
  assert.equal(href.searchParams.get("trade"), "cleaning");
  assert.equal(href.searchParams.get("state"), "VA");
  assert.equal(href.searchParams.get("source"), "learn");
  d.registrations = ["buyers", "records", "requirements", "dates"];
  d.bid = {
    title: "Office cleaning",
    url: "https://example.com/bid",
    decision: "pass",
    notes: "Not enough staff",
    scope: true,
    eligibility: false,
    timing: true,
    action: "Find a smaller bid",
    date: "2026-10-20",
  };
  assert.equal(launchpadSteps(d, true).filter((x) => x.done).length, 6);
  assert.deepEqual(parseLaunchpad(JSON.stringify(d)), d);
  console.log(
    "PASS: 22 Launchpad domain assertions (draft parsing, unsafe links, progress decisions, statement readiness, print escaping, Radar criteria, save round-trip).",
  );
});
