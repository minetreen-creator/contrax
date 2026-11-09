import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { splitDigestBids } from "./digest-open-to-all";
import { bidDigestHtml, type NewBidSummary } from "./email";

// Owner 2026-11-09 ("yes add them to the email alerts"): the 6 AM email lists federal bids that
// name no set-aside in their own block, and leaves out market research and overseas work.
const bid = (o: Partial<NewBidSummary>): NewBidSummary => ({
  title: "Job",
  agency: "Agency",
  source_url: "https://example.gov/1",
  location: "Raleigh, NC",
  due_date: "2026-12-01T00:00:00Z",
  set_aside: null,
  source: "nc_evp",
  ...o,
});

describe("6 AM email: open to all businesses", () => {
  test("splits federal no-set-aside bids out and drops market research and overseas work", () => {
    const r = splitDigestBids([
      bid({ title: "City HVAC Repair", source: "nc_evp" }),
      bid({ title: "Custodial Services", source: "sam_gov", set_aside: "Total Small Business Set-Aside" }),
      bid({ title: "Correct Electrical Deficiencies", source: "nh", location: "Fayetteville, NC" }),
      bid({ title: "Sources Sought - Generator Installation", source: "sam_gov" }),
      bid({ title: "U.S. Mission Burundi Local Guard Program", source: "sam_gov", location: "" }),
    ]);
    expect(r.main.map((b) => b.title)).toEqual(["City HVAC Repair", "Custodial Services"]);
    expect(r.openToAll.map((b) => b.title)).toEqual(["Correct Electrical Deficiencies"]);
    expect(r.dropped).toBe(2);
  });

  test("the email shows the block under its own label, and counts it in the header", () => {
    const html = bidDigestHtml([bid({ title: "City HVAC Repair" })], 1, null, {
      matchLabel: "electrical in NC",
      openToAll: [bid({ title: "Correct Electrical Deficiencies", source: "nh" })],
      openToAllTotal: 3,
    });
    expect(html).toContain("🆕 4 New Bids Found");
    expect(html).toContain("Open to all businesses (no set-aside)");
    expect(html).toContain("Correct Electrical Deficiencies");
    expect(html).toContain("+ 2 more open to all businesses on Contrax.");
    expect(html.indexOf("City HVAC Repair")).toBeLessThan(html.indexOf("Open to all businesses (no set-aside)"));
  });

  test("an email with only open-to-all bids has no empty main list", () => {
    const html = bidDigestHtml([], 0, null, { openToAll: [bid({ title: "Correct Electrical Deficiencies", source: "nh" })], openToAllTotal: 1 });
    expect(html).toContain("🆕 1 New Bid Found");
    expect(html).not.toContain("Here's what's new:");
  });

  test("an email without them is unchanged", () => {
    const html = bidDigestHtml([bid({ title: "City HVAC Repair" })], 1, null, { matchLabel: "hvac in NC" });
    expect(html).not.toContain("Open to all businesses");
    expect(html).toContain("🆕 1 New Bid Found");
  });

  test("the morning job uses the split", () => {
    const job = readFileSync(new URL("../jobs/send-bid-digest.ts", import.meta.url), "utf8");
    expect(job).toContain("splitDigestBids(");
  });
});
