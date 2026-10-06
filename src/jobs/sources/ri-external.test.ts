import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import {
  buildRiExternalRows,
  parseRiExternalDescription,
  parseRiExternalListing,
  riExternalDescriptionUrl,
  riExternalDueMs,
  riExternalSearchForm,
  riExternalTotal,
} from "./ri-external";

const gz = (name: string) => gunzipSync(readFileSync(join(import.meta.dir, "fixtures", "ri-external", name))).toString();
const LISTING = gz("external-listing-2026-10-06.html.gz");
const NOW = Date.parse("2026-10-06T14:00:00Z");

describe("ri_external: RI Division of Purchases external board (owner 2026-10-06)", () => {
  test("all 49 listed rows parse; addenda are skipped", () => {
    expect(riExternalTotal(LISTING)).toBe(49);
    const listed = parseRiExternalListing(LISTING);
    expect(listed.length).toBe(49);
    const r = buildRiExternalRows(listed, new Map(), NOW);
    expect(r.rows.length).toBe(37);
    expect(r.skipped).toEqual({ addendum: 12 });
    // "27-07 A1" has no "addendum" in its title but its base "27-07" is listed.
    expect(r.skippedRows.some((s) => s.id === "riext-ri-public-transit-authority-27-07-a1")).toBe(true);
  });

  test("a row keeps entity, number, Eastern opening time and link", () => {
    const r = buildRiExternalRows(parseRiExternalListing(LISTING), new Map(), NOW);
    const ripta = r.rows.find((b) => b.solicitation_number === "27-07")!;
    expect(ripta.title).toBe("Insurance Broker Services");
    expect(ripta.agency).toBe("RI Public Transit Authority");
    expect(ripta.notice_type).toBe("Quasi-Public");
    expect(ripta.due_date).toBe("2026-10-08T17:00:00.000Z"); // 1:00 PM EDT
    expect(ripta.source_url).toBe(
      "https://purchasing.ri.gov/bidding/ViewExDescription.aspx?BidNum=27-07&BiddingGroup=Quasi-Public&BiddingEntity=RI%20Public%20Transit%20Authority",
    );
    const nk = r.rows.find((b) => b.title === "Contract Cleaning 2026")!;
    expect(nk.agency).toBe("North Kingstown, Rhode Island");
  });

  test("opening times: free-text forms, DST, and date-only", () => {
    expect(riExternalDueMs("10/07/2026", "10 AM")).toEqual({ ms: Date.parse("2026-10-07T14:00:00Z"), timeKnown: true });
    expect(riExternalDueMs("10/06/2026", "11:59pm").ms).toBe(Date.parse("2026-10-07T03:59:00Z"));
    expect(riExternalDueMs("12/01/2026", "04:00 pm").ms).toBe(Date.parse("2026-12-01T21:00:00Z"));
    expect(riExternalDueMs("12/01/2026", "")).toEqual({ ms: Date.parse("2026-12-02T04:59:00Z"), timeKnown: false });
    expect(Number.isNaN(riExternalDueMs("soon", "1 PM").ms)).toBe(true);
  });

  test("descriptions come from the public description page", () => {
    const html = gz("description-RFP-2615.html.gz");
    expect(parseRiExternalDescription(html)).toStartWith("The Rhode Island Commerce Corporation");
    const listed = parseRiExternalListing(LISTING);
    const row = listed.find((r) => r.number === "RFP-2615")!;
    const url = riExternalDescriptionUrl(row.descriptionPath!);
    const r = buildRiExternalRows(listed, new Map([[url, parseRiExternalDescription(html)]]), NOW);
    expect(r.rows.find((b) => b.solicitation_number === "RFP-2615")!.description).toStartWith("The Rhode Island Commerce Corporation");
  });

  test("the search form selects every entity and only the Active status", () => {
    const html = `<input type="hidden" name="__VIEWSTATE" value="v&amp;1" /><input type="submit" name="x" value="Go" />
      <select name="ctl00$ContentPlaceHolder1$lstbox_ExBidStatus"><option value="Active(Scheduled)">A</option><option value="Awarded">B</option></select>
      <select name="ctl00$ContentPlaceHolder1$lstbox_ExBiddingEntities"><option value="1">One</option><option value="2">Two</option></select>`;
    const f = riExternalSearchForm(html);
    expect(f.get("__VIEWSTATE")).toBe("v&1");
    expect(f.has("x")).toBe(false);
    expect(f.getAll("ctl00$ContentPlaceHolder1$lstbox_ExBidStatus")).toEqual(["Active(Scheduled)"]);
    expect(f.getAll("ctl00$ContentPlaceHolder1$lstbox_ExBiddingEntities")).toEqual(["1", "2"]);
    expect(f.get("ctl00$ContentPlaceHolder1$btn_ExSearch")).toBe("Search");
  });
});
