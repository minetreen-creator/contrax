import { describe, expect, it } from "bun:test";
import { hubDate, hubKey, hubName, hubTrades, parseHubRow } from "~/lib/tx-hub";

const row = (over: Record<string, string> = {}) => ({
  WEB_VID: "17412345678",
  WEB_NAME_VENDOR_NAME: "ACME BUILDERS LLC",
  WEB_ADDR1: "100 MAIN ST",
  WEB_CITY: "SAN ANTONIO",
  WEB_STATE: "TX",
  WEB_ZIP: "78205",
  WEB_PHONE: "2105551234",
  WEB_HUB_STATUS: "A",
  WEB_COUNTY: "BEXAR",
  WEB_DESC: "GENERAL CONTRACTOR,  COMMERCIAL REMODELING AND ROOFING",
  WEB_HUB_EXPIRE_DATE: "31-DEC-2027",
  WEB_CONTACT: "JANE DOE",
  WEB_EMAIL_ADDRESS: "jane@example.com",
  WEB_SDV_FLAG: "Y",
  ...over,
});

describe("parseHubRow", () => {
  it("keeps an active Texas HUB with only public business fields", () => {
    const f = parseHubRow(row(), ["909"]);
    expect(f).not.toBeNull();
    expect(f!.name).toBe("Acme Builders LLC");
    expect(f!.city).toBe("San Antonio");
    expect(f!.county).toBe("Bexar");
    expect(f!.description).toBe("GENERAL CONTRACTOR, COMMERCIAL REMODELING AND ROOFING");
    expect(f!.trades).toEqual(["construction"]);
    expect(f!.expires).toBe("2027-12-31");
    expect(Object.keys(f!).sort()).toEqual(["city", "county", "description", "expires", "key", "name", "trades"]);
  });

  it("never stores the vendor ID, phone, email or contact name", () => {
    const blob = JSON.stringify(parseHubRow(row(), []));
    for (const secret of ["17412345678", "2105551234", "jane@example.com", "JANE DOE", "Jane Doe", "100 MAIN"]) expect(blob).not.toContain(secret);
    expect(parseHubRow(row(), [])!.key).toBe(hubKey("17412345678"));
    expect(hubKey("17412345678")).toMatch(/^txhub-[0-9a-f]{24}$/);
  });

  it("skips rows that are not active Texas HUBs", () => {
    expect(parseHubRow(row({ WEB_HUB_STATUS: "" }), [])).toBeNull();
    expect(parseHubRow(row({ WEB_HUB_STATUS: "I" }), [])).toBeNull();
    expect(parseHubRow(row({ WEB_STATE: "OK" }), [])).toBeNull();
    expect(parseHubRow(row({ WEB_VID: " " }), [])).toBeNull();
    expect(parseHubRow(row({ WEB_NAME_VENDOR_NAME: "" }), [])).toBeNull();
  });
});

describe("hubTrades", () => {
  it("reads NIGP construction and landscaping classes", () => {
    expect(hubTrades("", ["914"])).toEqual(["construction"]);
    expect(hubTrades("", ["988"])).toEqual(["landscaping"]);
    expect(hubTrades("", ["208", "962"])).toEqual([]);
  });
  it("reads trade words in the firm's own description", () => {
    expect(hubTrades("Commercial janitorial and custodial services", [])).toEqual(["janitorial"]);
    expect(hubTrades("HVAC and plumbing repair", [])).toEqual(["hvac"]);
    expect(hubTrades("Electrical contractor", []).sort()).toEqual(["construction", "electrical"]);
    expect(hubTrades("Cybersecurity consulting", [])).toEqual(["cybersecurity"]);
    expect(hubTrades("Transportation planning consultants", [])).toEqual([]);
    expect(hubTrades("Office supplies and furniture", [])).toEqual([]);
  });
});

describe("hubName and hubDate", () => {
  it("title-cases names but keeps suffixes", () => {
    expect(hubName("SMITH & SONS CONSTRUCTION, INC.")).toBe("Smith & Sons Construction, Inc.");
    expect(hubName("A&B HVAC SERVICES LP")).toBe("A&B HVAC Services LP");
  });
  it("parses the file's dates", () => {
    expect(hubDate("05-JAN-2028")).toBe("2028-01-05");
    expect(hubDate("2028-01-05")).toBeNull();
    expect(hubDate("")).toBeNull();
  });
});
