import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { fetchVendorlinkBids, mapVendorlink, readVendorlinkGrid, VENDORLINK_SITES, vendorlinkDeadline, vendorlinkDeps, vendorlinkPlace, vendorlinkSearchForm } from "./fl-vendorlink";

// The grid as www.myvendorlink.com/external/bids printed it on 2026-11-16 (read by a GitHub Actions
// job as ContraxBot), cut down to seven of its 86 rows. Row markup is the site's own.
const row = (n: string, agency: string, number: string, title: string, due: string, online = false, pre = false) => `<tr>
<td>${agency}</td><td>${number}</td><td>${title}</td><td align="center">
<input id="ctl00_RegionMiddle_grvSolicitations_ctl${n}_cbRFQuote" type="checkbox" name="ctl00$RegionMiddle$grvSolicitations$ctl${n}$cbRFQuote" ${online ? 'checked="checked" ' : ""}onclick="return false;" />
</td><td><span class='badge badge-success'>Active</span></td><td>
<span id="ctl00_RegionMiddle_grvSolicitations_ctl${n}_lblItemSolicitationBroadcastDate">10/26/2026 8:00 AM</span>
</td><td align="center">
<input id="ctl00_RegionMiddle_grvSolicitations_ctl${n}_cbMandatory" type="checkbox" name="ctl00$RegionMiddle$grvSolicitations$ctl${n}$cbMandatory" ${pre ? 'checked="checked" ' : ""}onclick="return false;" />
</td><td>
<span id="ctl00_RegionMiddle_grvSolicitations_ctl${n}_lblItemSolicitationQuestionEndDate">11/2/2026 1:00 PM</span>
</td><td>
<span id="ctl00_RegionMiddle_grvSolicitations_ctl${n}_lblItemSolicitationDueDate">${due}</span>
</td><td>
<a id="ctl00_RegionMiddle_grvSolicitations_ctl${n}_btnView" title="View" class="fa fa-search-plus fa-lg" href="javascript:__doPostBack(&#39;ctl00$RegionMiddle$grvSolicitations$ctl${n}$btnView&#39;,&#39;&#39;)"></a>
</td>
</tr>`;
const HEAD = `<tr>
<th scope="col" style="width:175px;">Agency</th><th scope="col" style="width:125px;">Number</th><th scope="col">Title</th><th scope="col" style="width:30px;">Online Quote/Bid</th><th scope="col" style="width:100px;">Status</th><th scope="col" style="width:80px;">Broadcast Date</th><th scope="col" style="width:30px;">Mandatory Pre-Bid</th><th scope="col" style="width:80px;">Question End Date</th><th scope="col" style="width:80px;">Due Date</th><th scope="col" style="width:25px;"><span class='hidden'>View</span></th>
</tr>`;
const ROWS = [
  row("02", "Sarasota County School Board", "27-0348", "HYDRAULIC SYSTEMS PARTS &amp; REPAIR SERVICE - QUOTE #27-0348", "11/17/2026 1:00 PM", true),
  row("03", "City of DeLand", "B-26-14", "2024 Downtown South Water Main Improvements-East Phase", "11/17/2026 2:00 PM", true),
  row("05", "Manatee County School District", "27-0082-KCD", "Sole Source - Titan Thermoplastic Flooring and Services", "11/17/2026 3:00 PM"),
  row("21", "Central Florida Electric Cooperative, Inc.", "2026-11", "2027-2029 Office Cleaning Services", "11/23/2026 3:00 PM"),
  row("26", "Hillsborough County Public Schools", "26372-RFP-MST", "HVAC Water Treatment", "11/30/2026 5:00 PM", false, true),
  row("40", "City of Murfreesboro", "ITB-27-01", "Fleet Tires", "12/1/2026 2:00 PM"),
  row("87", "City of St. Cloud", "2026-142", "Custodial Services", ""),
];
const PAGE = `<html><form method="post" action="./bids" id="aspnetForm"><input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="/wEPDwUK&amp;x=" /><input type="hidden" name="__VIEWSTATEGENERATOR" value="C0A1" /><div id="ctl00_RegionMiddle_UpdatePanel6">`;
const GRID = `${PAGE}<table cellspacing="0" id="ctl00_RegionMiddle_grvSolicitations">${HEAD}${ROWS.join("\n")}</table></div></form></html>`;
const main = VENDORLINK_SITES[0];
const now = Date.parse("2026-11-17T01:00:00Z");

describe("VendorLink, Florida school districts and cities (owner 2026-11-16)", () => {
  test("the grid is read by its own column headings", () => {
    const g = readVendorlinkGrid(GRID, main)!;
    expect(g.rows).toBe(7);
    expect(g.items[0]).toEqual({ agency: "Sarasota County School Board", number: "27-0348", title: "HYDRAULIC SYSTEMS PARTS & REPAIR SERVICE - QUOTE #27-0348", online: true, status: "Active", due: "11/17/2026 1:00 PM", preBid: false });
    expect(g.items[4].preBid).toBe(true);
    expect(g.items[6].due).toBe("");
  });

  test("a site with one buyer prints no Agency column", () => {
    const ocps = VENDORLINK_SITES.find((s) => s.source === "fl_orange_schools_vendorlink")!;
    const html = GRID.replace('<th scope="col" style="width:175px;">Agency</th>', "").replace(/<tr>\n<td>[^<]*<\/td>/g, "<tr>\n");
    const g = readVendorlinkGrid(html, ocps)!;
    expect(g.items[0].agency).toBe("Orange County Public Schools");
    expect(g.items[0].number).toBe("27-0348");
    // The shared board without its Agency column cannot be read: never guessed.
    expect(readVendorlinkGrid(html, main)).toBeNull();
  });

  test("an empty board is an honest zero; a page with neither a grid nor that line is unreadable", () => {
    expect(readVendorlinkGrid(`${PAGE}No Bids Found</div>`, main)).toEqual({ items: [], rows: 0 });
    expect(readVendorlinkGrid("<html>Login | VendorLink</html>", main)).toBeNull();
  });

  test("Florida public bodies are stored; the rest are counted with the reason", () => {
    const r = mapVendorlink(readVendorlinkGrid(GRID, main)!.items, main, now);
    expect(r.rows.map((b) => b.external_id)).toEqual(["vendorlink-sarasota-county-school-board-27-0348", "vendorlink-city-of-deland-b-26-14", "vendorlink-hillsborough-county-public-schools-26372-rfp-mst"]);
    expect(r.skipped).toEqual({ not_competitive: 1, not_a_public_body: 1, out_of_state: 1, no_deadline: 1 });
    const [sarasota, deland, hcps] = r.rows;
    expect(sarasota.location).toBe("Sarasota County, FL");
    expect(sarasota.due_date).toBe("2026-11-17T18:00:00.000Z");
    expect(sarasota.source_url).toBe("https://www.myvendorlink.com/external/bids");
    expect(sarasota.description).toContain("Closes 11/17/2026 1:00 PM Eastern. Responses are submitted online through VendorLink.");
    expect(sarasota.description).toContain("choose Sarasota County School Board and the Active status, then number 27-0348");
    expect(deland.location).toBe("DeLand, FL");
    expect(hcps.location).toBe("Hillsborough County, FL");
    expect(hcps.description).toContain("A mandatory pre-bid meeting is listed.");
    expect(hcps.solicitation_number).toBe("26372-RFP-MST");
  });

  test("a closed row and a repeated row are counted", () => {
    const items = readVendorlinkGrid(GRID, main)!.items;
    const later = mapVendorlink([...items, items[1]], main, Date.parse("2026-11-17T18:30:00Z"));
    expect(later.skipped.closed).toBe(1);
    expect(later.skipped.duplicate).toBe(1);
  });

  test("places come from the agency's name, never a guess", () => {
    expect(vendorlinkPlace("Polk County School Board")).toEqual({ location: "Polk County, FL", zone: "America/New_York" });
    expect(vendorlinkPlace("Osceola County School Board (now on vendorlink.osceola.org)")).toEqual({ location: "Osceola County, FL", zone: "America/New_York" });
    expect(vendorlinkPlace("City of Milton")).toEqual({ location: "Milton, FL", zone: "America/Chicago" });
    expect(vendorlinkPlace("Orlando Utilities Commission")).toEqual({ location: "Orlando, FL", zone: "America/New_York" });
    expect(vendorlinkPlace("Edgecombe-Martin County Electric Membership Cooperative")).toBe("not_a_public_body");
    expect(vendorlinkPlace("Florida Sheriffs Association")).toBe("not_a_public_body");
    expect(vendorlinkPlace("City of Madison, Georgia")).toBe("out_of_state");
    expect(vendorlinkPlace("Forrest County Board of Supervisors")).toBe("out_of_state");
    expect(vendorlinkPlace("Riverbend Improvement District")).toBe("unknown_agency");
  });

  test("deadlines are the agency's local time", () => {
    expect(vendorlinkDeadline("11/17/2026 1:00 PM", "America/New_York")).toBe("2026-11-17T18:00:00.000Z");
    expect(vendorlinkDeadline("7/1/2026 12:00 AM", "America/New_York")).toBe("2026-07-01T04:00:00.000Z");
    expect(vendorlinkDeadline("12/1/2026 2:00 PM", "America/Chicago")).toBe("2026-12-01T20:00:00.000Z");
    expect(vendorlinkDeadline("soon", "America/New_York")).toBeNull();
  });

  test("the search posts the page's own hidden fields with Status = Active and 100 a page", () => {
    const f = vendorlinkSearchForm(PAGE, "SolicitationDueDateASC")!;
    expect(f.get("__VIEWSTATE")).toBe("/wEPDwUK&x=");
    expect(f.get("ctl00$RegionMiddle$ddlStatus")).toBe("2");
    expect(f.get("ctl00$RegionMiddle$rblSolicitationPageCount")).toBe("100");
    expect(f.get("ctl00$RegionMiddle$ddlAgency")).toBe("");
    expect([...f.keys()].some((k) => /password|login|user/i.test(k))).toBe(false);
    expect(vendorlinkSearchForm("<html></html>", "SolicitationDueDateASC")).toBeNull();
  });

  test("one page read and one search; a failure fails the run", async () => {
    const saved = { ...vendorlinkDeps };
    const calls: { url: string; method: string }[] = [];
    vendorlinkDeps.pause = async () => {};
    vendorlinkDeps.fetch = async (url, init) => { calls.push({ url, method: init.method ?? "GET" }); return new Response(init.method === "POST" ? GRID : PAGE, { status: 200 }); };
    try {
      const r = await fetchVendorlinkBids(main, now);
      expect(r.rows).toHaveLength(3);
      expect(calls).toEqual([{ url: "https://www.myvendorlink.com/external/bids", method: "GET" }, { url: "https://www.myvendorlink.com/external/bids", method: "POST" }]);
      vendorlinkDeps.fetch = async (_u, init) => new Response(init.method === "POST" ? "<html>Login | VendorLink</html>" : PAGE, { status: 200 });
      await expect(fetchVendorlinkBids(main, now)).rejects.toThrow(/fl_vendorlink/);
      vendorlinkDeps.fetch = async () => new Response("down", { status: 503 });
      await expect(fetchVendorlinkBids(main, now)).rejects.toThrow(/HTTP 503/);
    } finally {
      Object.assign(vendorlinkDeps, saved);
    }
  });

  test("the four sites are scheduled and known as Florida sources", () => {
    const runner = readFileSync("src/jobs/runner.ts", "utf8");
    expect(runner).toContain("  ...VENDORLINK_SOURCES,");
    for (const s of VENDORLINK_SITES) {
      expect(SOURCE_CLASSES[s.source]?.scopeState).toBe("FL");
      expect(SOURCE_HOME_JURISDICTIONS[s.source]).toBe("FL");
      expect(s.origin).toMatch(/^https:\/\/(www\.myvendorlink\.com|vendorlink\.(ocps\.net|osceola\.org|scf\.edu))$/);
    }
    // Only the public list is ever requested: no login page, no solicitation pages.
    const src = readFileSync("src/jobs/sources/fl-vendorlink.ts", "utf8");
    expect(src.match(/\/external\/[a-z]+/g)?.every((p) => p === "/external/bids")).toBe(true);
  });
});
