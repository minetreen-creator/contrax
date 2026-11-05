import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ASSOCIATIONS, associationFor, bidFits, buildSections, dedupeBids, renderDigest, type DigestBid } from "./association-digest";

// Owner 2026-11-05: associations that hand-curate weekly bid alerts → "Do that".
const bid = (over: Partial<DigestBid>): DigestBid => ({
  id: 1,
  title: "Roof Replacement at City Hall",
  agency: "City of Austin",
  location: "Austin, TX",
  state: "TX",
  category: "Construction",
  due_date: "2026-11-20T21:00:00.000Z",
  estimated_value: "Not specified",
  set_aside: null,
  ...over,
});

describe("association weekly bid list", () => {
  test("seven associations, unique keys", () => {
    expect(ASSOCIATIONS).toHaveLength(7);
    expect(new Set(ASSOCIATIONS.map((a) => a.key)).size).toBe(7);
    expect(associationFor("nope")).toBeNull();
  });

  test("a regional list keeps its own places and trades", () => {
    const ctx = associationFor("namc-central-texas")!;
    expect(bidFits(ctx, bid({}))).toBe(true);
    expect(bidFits(ctx, bid({ location: "Houston, TX", agency: "City of Houston" }))).toBe(false);
    expect(bidFits(ctx, bid({ category: "IT Services" }))).toBe(false);
    expect(bidFits(ctx, bid({ state: "OK" }))).toBe(false);
    const sa = associationFor("hca-san-antonio")!;
    expect(bidFits(sa, bid({ location: "San Antonio, TX", agency: "Bexar County" }))).toBe(true);
    expect(bidFits(sa, bid({}))).toBe(false);
  });

  test("the veteran list only takes veteran set-asides", () => {
    const nv = associationFor("navoba")!;
    expect(bidFits(nv, bid({ set_aside: "SDVOSB" }))).toBe(true);
    expect(bidFits(nv, bid({ state: "CA", set_aside: "Service-Disabled Veteran-Owned Small Business" }))).toBe(true);
    expect(bidFits(nv, bid({}))).toBe(false);
  });

  test("the same solicitation from two boards appears once", () => {
    const out = dedupeBids([bid({ id: 1 }), bid({ id: 2, title: "ROOF REPLACEMENT AT CITY HALL" }), bid({ id: 3, due_date: "2026-11-27T21:00:00.000Z" })]);
    expect(out.map((b) => b.id)).toEqual([1, 3]);
  });

  test("sections follow the association's trade order, soonest due first", () => {
    const md = associationFor("mmca")!;
    const s = buildSections(md, [
      bid({ id: 1, state: "MD", location: "Baltimore, MD", due_date: "2026-11-30T21:00:00.000Z" }),
      bid({ id: 2, state: "MD", location: "Baltimore, MD", title: "HVAC Upgrade", category: "HVAC" }),
      bid({ id: 3, state: "MD", location: "Annapolis, MD", title: "Paving", due_date: "2026-11-12T21:00:00.000Z" }),
    ]);
    expect(s.map((x) => x.category)).toEqual(["Construction", "HVAC"]);
    expect(s[0].bids.map((b) => b.id)).toEqual([3, 1]);
  });

  test("the email names the association, counts the bids and links each one", () => {
    const md = associationFor("mmca")!;
    const s = buildSections(md, [bid({ id: 42, state: "MD", location: "Baltimore, MD", title: "Paving <Phase 2>" })]);
    const m = renderDigest(md, s, new Date("2026-11-05T15:00:00Z"));
    expect(m.count).toBe(1);
    expect(m.subject).toBe("Maryland Minority Contractors Association: 1 open bids in Maryland, week of November 5, 2026");
    expect(m.html).toContain("https://www.contrax.company/bid/42");
    expect(m.html).toContain("Paving &lt;Phase 2&gt;");
    expect(m.text).toContain("Due".toLowerCase());
    expect(m.html).not.toContain("Not specified");
  });

  test("samples only ever go to the owner", () => {
    const job = readFileSync("src/jobs/association-digest.ts", "utf8");
    expect(job).toContain('const OWNER_EMAIL = "minetreen@gmail.com"');
    expect(job).toContain("to: OWNER_EMAIL");
    expect(job.match(/\bto:/g)).toHaveLength(1);
  });
});
