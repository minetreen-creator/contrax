import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";
import { CA_COUNTY_BSO, caDirectDeps, EBMUD_BIDS_URL, fetchCaEbmudBids, pacificEndOfDay, parseEbmudBids } from "./ca-direct";
import { bsoHeaders, isBsoSearchPage, parseBsoRows, readBsoRows } from "./periscope-bso";
import { PERISCOPE_STATES } from "./periscope-states";

// Owner 2026-11-07: "more bids of our own instead of relying mostly on bidnet" -> "Yes start California".
const fx = (f: string) => readFileSync(new URL(`./fixtures/ca-direct/${f}`, import.meta.url), "utf8");
const now = Date.parse("2026-11-07T03:00:00Z");

describe("EBMUD construction bids", () => {
  const html = fx("ebmud-2026-11-07.html");
  test("the three open construction bids; the prequalification call is not a bid", () => {
    const { rows, skipped } = parseEbmudBids(html, now);
    expect(skipped).toEqual({ not_a_bid: 1 });
    expect(rows.map((r) => r.solicitation_number)).toEqual(["2182", "2189", "SD462"]);
    const filters = rows[1];
    expect(filters.title).toBe("Walnut Creek WTP Filters Improvements");
    expect(filters.estimated_value).toBe("$20,000,000 to $25,000,000");
    expect(filters.due_date).toBe("2026-12-03T07:59:00.000Z"); // Dec 2, 11:59 PM PST
    expect(filters.category).toBe("Construction");
    expect(filters.source_url).toBe("https://construction-bids.ebmud.com/SpecMain.aspx?SpecGN=8824&BidMode=Current");
    expect(filters.description).toContain("no time");
  });
  test("dates and page checks", () => {
    expect(pacificEndOfDay("July 01, 2026")).toBe("2026-07-02T06:59:00.000Z"); // PDT
    expect(pacificEndOfDay("Smarch 1, 2026")).toBeNull();
    expect(parseEbmudBids(html, Date.parse("2026-11-25T00:00:00Z")).skipped.closed).toBe(1);
    expect(() => parseEbmudBids("<html></html>", now)).toThrow();
  });
  test("reader fails loudly on HTTP errors", async () => {
    const saved = { ...caDirectDeps };
    try {
      caDirectDeps.fetch = async (url) => { expect(url).toBe(EBMUD_BIDS_URL); return new Response(html, { status: 200 }); };
      expect((await fetchCaEbmudBids(now)).rows).toHaveLength(3);
      caDirectDeps.fetch = async () => new Response("no", { status: 503 });
      await expect(fetchCaEbmudBids(now)).rejects.toThrow();
    } finally { Object.assign(caDirectDeps, saved); }
  });
});

describe("San Bernardino and Contra Costa county BuySpeed marketplaces", () => {
  test("county rows carry the county's name and place, not 'State of California'", () => {
    const html = fx("sbcounty-bso-2026-11-07.html");
    expect(isBsoSearchPage(html)).toBe(true);
    const { rows } = parseBsoRows(CA_COUNTY_BSO[0], readBsoRows(html, bsoHeaders(html)), now);
    expect(rows).toHaveLength(25);
    const sidewalk = rows.find((r) => r.title === "Del Rosa Drive Sidewalk")!;
    expect(sidewalk.agency).toBe("San Bernardino County Public Works");
    expect(sidewalk.location).toBe("San Bernardino County, CA");
    expect(sidewalk.category).toBe("Construction");
    expect(sidewalk.due_date).toBe("2026-12-10T18:00:00.000Z"); // 10:00 AM PST
    expect(sidewalk.source_url).toStartWith("https://epro.sbcounty.gov/bso/");
    expect(JSON.stringify(rows)).not.toContain("State of California");
  });
  test("Contra Costa's marketplace reads as a search page with no open bids today", () => {
    const html = fx("cccounty-bso-2026-11-07.html");
    expect(isBsoSearchPage(html)).toBe(true);
    expect(readBsoRows(html, bsoHeaders(html))).toHaveLength(0);
  });
  test("state marketplaces are unchanged", () => {
    const ma = PERISCOPE_STATES.ma_commbuys;
    const { rows } = parseBsoRows(ma, [{ number: "BD-1", organization: "", description: "Road salt", opening: "12/01/2026 02:00 PM", status: "Sent", alternateId: "" }], now);
    expect(rows[0].agency).toBe("State of Massachusetts");
    expect(rows[0].location).toBe("Massachusetts");
  });
});

test("scheduled, local, in California, with agency pages", () => {
  for (const s of ["ca_san_bernardino_county", "ca_contra_costa_county", "ca_ebmud"]) {
    expect(TAIL_SOURCES.some((t) => t.name === s)).toBe(true);
    expect(SOURCE_CLASSES[s]?.class).toBe("local");
    expect(SOURCE_HOME_JURISDICTIONS[s]).toBe("CA");
    expect(LOCAL_AGENCIES.some((a) => a.source === s)).toBe(true);
  }
});
