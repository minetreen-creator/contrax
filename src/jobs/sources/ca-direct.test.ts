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

// Batch 2 (owner 2026-11-07: "Yes do batch 2").
describe("California batch 2", async () => {
  const c = await import("./ca-direct");
  const at = Date.parse("2026-11-07T03:30:00Z");

  test("LA County: open rows from its public API, Pacific wall-clock times, past 'continuous' dates skipped", () => {
    const la = JSON.parse(fx("lacounty-by-dept-2026-11-07.json"));
    const rows = Object.values(la.all).flatMap((v: any) => (Array.isArray(v.data) ? v.data : []));
    const r = c.parseLaCounty(rows, at);
    expect(rows).toHaveLength(216);
    expect(r.rows).toHaveLength(85);
    expect(r.skipped).toEqual({ closed: 131 });
    const fs = r.rows.find((x) => x.title.startsWith("Fire Station 163"))!;
    expect(fs.agency).toBe("Los Angeles County Public Works");
    expect(fs.due_date).toBe("2026-11-19T18:00:00.000Z"); // "10:00:00.000Z" = 10:00 AM Pacific
    expect(fs.category).toBe("Construction");
    expect(fs.source_url).toBe(c.LA_COUNTY_PAGE);
    expect(r.rows.some((x) => x.agency.includes("County LA County"))).toBe(false);
  });

  test("LA County reader walks every department and fails loudly", async () => {
    const saved = { ...c.caDirectDeps };
    const urls: string[] = [];
    try {
      c.caDirectDeps.pause = async () => {};
      c.caDirectDeps.fetch = async (url: string) => {
        urls.push(url);
        if (url.endsWith("/departments")) return new Response(JSON.stringify([{ DeptNbr: "29" }, { DeptNbr: "x" }]), { status: 200 });
        return new Response(JSON.stringify([{ "Bid#": "B1", BidRefNbr: "1", Title: "Road work", Type: "Construction", DeptName: "Public Works", ClosingDate: "2026-12-01T14:00:00.000Z" }]), { status: 200 });
      };
      expect((await c.fetchCaLaCountyBids(at)).rows).toHaveLength(1);
      expect(urls).toEqual([`${c.LA_COUNTY_API}/departments`, `${c.LA_COUNTY_API}/departments/29`]);
      c.caDirectDeps.fetch = async () => new Response("Cannot GET", { status: 404 });
      await expect(c.fetchCaLaCountyBids(at)).rejects.toThrow();
    } finally { Object.assign(c.caDirectDeps, saved); }
  });

  test("Port of Oakland: current rows only, Pacific deadlines", () => {
    const r = c.parsePortOfOakland(fx("portoakland-2026-11-07.html"), at);
    expect(r.rows).toHaveLength(5);
    expect(r.skipped).toEqual({ not_current: 2 });
    const laptops = r.rows.find((x) => x.solicitation_number === "26-27/14")!;
    expect(laptops.title).toBe("Lenovo Business Laptops and Docking Stations");
    expect(laptops.due_date).toBe("2026-11-19T22:00:00.000Z"); // 2:00 pm PST
    expect(laptops.notice_type).toBe("ITB");
  });

  test("City of Berkeley: due time from the page's machine-readable date", () => {
    const r = c.parseBerkeley(fx("berkeley-2026-11-07.html"), at);
    expect(r.rows.map((x) => x.solicitation_number)).toEqual(["27-11797-C", "27-11810-C"]);
    expect(r.rows[0].due_date).toBe("2026-11-20T22:00:00.000Z");
  });

  test("UC Berkeley: construction table, PST times, rows without a number skipped", () => {
    const r = c.parseUcBerkeley(fx("ucb-2026-11-07.html"), at);
    expect(r.rows.map((x) => x.solicitation_number)).toEqual(["16416A", "12044B", "19098A"]);
    expect(r.rows[0].title).toBe("FS Dwinelle Hall Card Readers Installation");
    expect(r.rows[0].due_date).toBe("2026-12-03T18:00:00.000Z");
    expect(r.rows.every((x) => x.category === "Construction")).toBe(true);
  });

  test("UCLA: listings from the page, deadline only from each ad PDF, never guessed", () => {
    const ls = c.parseUclaPage(fx("ucla-2026-11-07.html"));
    expect(ls).toHaveLength(41);
    expect(ls[0].number).toBe("907078.01");
    expect(c.uclaPdfDeadline(fx("ucla-ad-1-2026-11-07.txt"))).toBe("2026-07-28T21:00:00.000Z"); // 2:00 p.m. PDT
    const early = Date.parse("2026-01-01T00:00:00Z");
    const r = c.collectUcla([{ listing: ls[1], pdfText: fx("ucla-ad-1-2026-11-07.txt") }, { listing: ls[2], pdfText: "no deadline here" }, { listing: ls[3], pdfText: null }], early);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].description.length).toBeLessThan(700);
    expect(r.rows[0].description).not.toContain("TO VIEW AND DOWNLOAD");
    expect(r.skipped).toEqual({ no_deadline: 1, pdf_unreadable: 1 });
    expect(c.collectUcla([{ listing: ls[1], pdfText: fx("ucla-ad-1-2026-11-07.txt") }], at).skipped).toEqual({ closed: 1 });
  });

  test("batch 2 sources are scheduled, local, in California, with agency pages", () => {
    for (const s of ["ca_la_county", "ca_port_of_oakland", "ca_berkeley", "ca_uc_berkeley", "ca_ucla_capital"]) {
      expect(TAIL_SOURCES.some((t) => t.name === s)).toBe(true);
      expect(SOURCE_CLASSES[s]?.class).toBe("local");
      expect(SOURCE_HOME_JURISDICTIONS[s]).toBe("CA");
      expect(LOCAL_AGENCIES.some((a) => a.source === s)).toBe(true);
    }
  });
});
