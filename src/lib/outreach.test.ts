import { describe, expect, test } from "bun:test";
import {
  addressState,
  CONTACTED_BY_HAND,
  daysUntil,
  bidFitsTrade,
  bidIsServiceJob,
  OUTREACH_TRADES,
  primeAwardFits,
  primeDescription,
  sameCompany,
  emailFitsSite,
  placeIsLocal,
  followupDue,
  outreachEmail,
  validPostalAddress,
  type OutreachEmailInput,
} from "./outreach";
import { unsubscribeToken, verifyUnsubscribeToken } from "./outreach.server";

const base: OutreachEmailInput = {
  kind: "first",
  business: "Acme Cleaning",
  bidId: 123,
  bidTitle: "Janitorial Services",
  buyer: "Botetourt County, Virginia",
  due: "2026-11-05",
  tradeLabel: "janitorial",
  postalAddress: "100 Main St, Richmond VA 23219",
  unsubscribeUrl: "https://www.contrax.company/api/outreach/unsubscribe?t=abc",
  contactId: 7,
};
const ENV = { OUTREACH_SECRET: "s".repeat(32) };

describe("daily bid outreach (owner 2026-10-23)", () => {
  test("every email carries the postal address and a working unsubscribe link (CAN-SPAM)", () => {
    for (const kind of ["first", "followup"] as const) {
      const m = outreachEmail({ ...base, kind });
      for (const part of [m.text, m.html]) {
        expect(part).toContain("100 Main St, Richmond VA 23219");
        expect(part).toContain(base.unsubscribeUrl);
      }
    }
  });

  test("first email names the bid, buyer and due date and links the bid with attribution", () => {
    const m = outreachEmail(base);
    expect(m.subject).toBe("Open janitorial bid from Botetourt County, Virginia, due Nov 5");
    expect(m.text).toContain("Botetourt County, Virginia has an open bid that looks like a fit for Acme Cleaning");
    expect(m.text).toContain("Due: Nov 5, 2026");
    expect(m.text).toContain("https://www.contrax.company/bid/123?utm_source=email&utm_medium=outreach&utm_campaign=bid_outreach_first&oc=7");
    expect(m.text).toContain("other open janitorial bids");
  });

  test("follow-up offers Bid Scout and threads under the first subject", () => {
    const m = outreachEmail({ ...base, kind: "followup" });
    expect(m.subject).toBe("Re: Open janitorial bid from Botetourt County, Virginia, due Nov 5");
    expect(m.text).toContain("Bid Scout");
    expect(m.text).toContain("/bid-scout?source=outreach&utm_source=email");
  });

  test("HTML escapes business and bid text", () => {
    const m = outreachEmail({ ...base, business: "A&B <Cleaning>" });
    expect(m.html).toContain("A&amp;B &lt;Cleaning&gt;");
    expect(m.html).not.toContain("<Cleaning>");
  });

  test("follow-up timing and days until due", () => {
    const sent = new Date("2026-10-23T14:00:00Z");
    expect(followupDue(sent, new Date("2026-10-26T14:00:00Z"))).toBe(false);
    expect(followupDue(sent, new Date("2026-10-27T14:00:00Z"))).toBe(true);
    expect(daysUntil("2026-11-05", new Date("2026-10-26T20:00:00Z"))).toBe(10);
  });

  test("a mailing address is required", () => {
    expect(validPostalAddress("")).toBe(false);
    expect(validPostalAddress(null)).toBe(false);
    expect(validPostalAddress("Virginia")).toBe(false);
    expect(validPostalAddress("100 Main St, Richmond VA 23219")).toBe(true);
  });

  test("unsubscribe tokens name only the signed address", () => {
    const t = unsubscribeToken("Owner@Acme.com", ENV);
    expect(verifyUnsubscribeToken(t, ENV)).toBe("owner@acme.com");
    expect(verifyUnsubscribeToken(t, { OUTREACH_SECRET: "x".repeat(32) })).toBeNull();
    const forged = `${Buffer.from("other@acme.com").toString("base64url")}.${t.split(".")[1]}`;
    expect(verifyUnsubscribeToken(forged, ENV)).toBeNull();
    expect(verifyUnsubscribeToken("garbage", ENV)).toBeNull();
  });

  test("the businesses emailed by hand are never emailed again", () => {
    expect(CONTACTED_BY_HAND).toHaveLength(19);
    expect(CONTACTED_BY_HAND.every((e) => e === e.toLowerCase() && e.includes("@"))).toBe(true);
  });

  test("only addresses that belong to the business are used", () => {
    expect(emailFitsSite("info@acmecleaning.com", "acmecleaning.com")).toBe(true);
    expect(emailFitsSite("office@mail.acmecleaning.com", "acmecleaning.com")).toBe(true);
    expect(emailFitsSite("acmecleaning@gmail.com", "acmecleaning.com")).toBe(true);
    expect(emailFitsSite("team@latofonts.com", "texasranchlandscaping.com")).toBe(false);
    expect(emailFitsSite("hello@webdesigner.io", "acmecleaning.com")).toBe(false);
    expect(emailFitsSite("broken", "acmecleaning.com")).toBe(false);
  });

  test("a personal mailbox must share a word with the business; no hiring mailboxes", () => {
    // 2026-10-23 batch: a font designer's gmail credited on a cleaner's site.
    expect(emailFitsSite("impallari@gmail.com", "marketreadycleaning.com", "Market-Ready Cleaning LLC")).toBe(false);
    expect(emailFitsSite("geauxjanitorial@gmail.com", "geauxjanitorial.com", "Geaux Janitorial")).toBe(true);
    expect(emailFitsSite("phillipslandscaping74@gmail.com", "phillipslandscapingaz.com", "Phillip's Landscaping Services")).toBe(true);
    expect(emailFitsSite("kylejaworski@comcast.net", "kmbjaworski.com", "KMB Jaworski Plumbing & Remodeling LLc")).toBe(true);
    expect(emailFitsSite("jobs@southtexasplumbing.com", "southtexasplumbing.com", "D P South Texas Plumbing")).toBe(false);
    expect(emailFitsSite("info@southtexasplumbing.com", "southtexasplumbing.com", "D P South Texas Plumbing")).toBe(true);
  });

  test("supply, materials, parts and prequalified-pool bids are not service jobs", () => {
    expect(bidIsServiceJob("Paper Products and Janitorial Supplies")).toBe(false);
    expect(bidIsServiceJob("Landscape Materials (Annual Contract)")).toBe(false);
    expect(bidIsServiceJob("Plumbing Parts for Scott Unit")).toBe(false);
    expect(bidIsServiceJob("Steinmetz HS - Hallway & Stairwell Painting Project - Prequalified Various Trades POOL ONLY")).toBe(false);
    expect(bidIsServiceJob("A26-1115 - Janitorial Services for DOM")).toBe(true);
    expect(bidIsServiceJob("Invitation for Bids for On-Call Plumbing Services")).toBe(true);
    // Owner 2026-10-29: invitational bids, RFIs, sources sought and filter buys.
    expect(bidIsServiceJob("DFCM Construction - Invitational - Bridgerland Technical College - HVAC Improvement")).toBe(false);
    expect(bidIsServiceJob("RFI Process control system plumbing and programming")).toBe(false);
    expect(bidIsServiceJob("Sources Sought: Grounds Maintenance")).toBe(false);
    expect(bidIsServiceJob("HVAC Filters for the Hospital and related items")).toBe(false);
    // Owner 2026-10-30: design, consultant and project-management work.
    expect(bidIsServiceJob("Design Services for Hillside Support Facility Roof and HVAC Replacements (STATE)")).toBe(false);
    expect(bidIsServiceJob("D81802 - Project Management Consultant Services for Roof Replacement at Bathgate (State).")).toBe(false);
    expect(bidIsServiceJob("MFD Station #1 HVAC Remodel")).toBe(true);
    expect(bidIsServiceJob("Fenn Ranger Station roofing replacement")).toBe(true);
    expect(bidIsServiceJob("NSN 6150-01-685-8736 - Cable Assembly Power, Electrical Bran")).toBe(false);
    expect(bidIsServiceJob("B21 Utilities & Site Improvements, Communications & Electrical Infrastructure, Dyess AFB OT Feasibility & Business Feedback")).toBe(false);
    expect(bidIsServiceJob("Large Format Wire Electrical Discharge Machining (EDM) System")).toBe(false);
    expect(bidIsServiceJob("ARFQ 4000 PSI Air-Entrained Commercial Concrete for WVPA")).toBe(false);
    expect(bidIsServiceJob("FURNISHING PRECAST CONCRETE METER MANHOLES AND CATCH BASINS")).toBe(false);
    expect(bidIsServiceJob("HWCB27KR: REPLACEMENT OF CONCRETE, STEEL FACED AND GRANITE CURBS AND RELATED SIDEWALK AND ROADWAY RESTORATION")).toBe(true);
    expect(bidIsServiceJob("IFB161310 Fencing Services")).toBe(true);
  });

  test("the added trades match their bids and stay out of others (owner 2026-10-30)", () => {
    const tradeFor = (title: string) => OUTREACH_TRADES.filter((t) => title.toLowerCase().includes(t.match)).map((t) => t.label);
    expect(tradeFor("Electrical Maintenance Services - City Hall")).toContain("electrical");
    expect(tradeFor("Unarmed Security Guard Services")).toContain("security guard");
    expect(tradeFor("Perimeter Fencing Replacement")).toContain("fencing");
    expect(tradeFor("Concrete Sidewalk Repairs")).toContain("concrete");
    expect(tradeFor("Tree Removal and Stump Grinding")).toContain("tree service");
    expect(tradeFor("Street Tree Planting")).not.toContain("tree service");
    expect(tradeFor("Department of Defense Logistics")).not.toContain("fencing");
  });

  test("a roof-top HVAC unit is not roofing work (owner 2026-10-30)", () => {
    expect(bidFitsTrade("roofing", "E-911 Heat Pump and Roof Top Unit (RTU) Replacement")).toBe(false);
    expect(bidFitsTrade("roofing", "Rooftop Units Replacement - Library")).toBe(false);
    expect(bidFitsTrade("roofing", "MU27MSCROOF Memorial Student Center Roof Replacement")).toBe(true);
    expect(bidFitsTrade("HVAC", "E-911 Heat Pump and Roof Top Unit (RTU) Replacement")).toBe(true);
  });

  test("a web address glued to a mailbox is never used (owner 2026-10-30)", () => {
    expect(emailFitsSite("admin@www.advancedroofing.biz", "advancedroofing.biz")).toBe(false);
    expect(emailFitsSite("admin@advancedroofing.biz", "advancedroofing.biz")).toBe(true);
  });

  test("a business's state comes from its Places address; a buying office is not a place (owner 2026-10-30)", () => {
    expect(addressState("123 Main St, Nashville, TN 37201, USA")).toBe("TN");
    expect(addressState("9 Elm Rd, Warner Robins, GA 31088-1234, USA")).toBe("GA");
    expect(addressState("Somewhere, USA")).toBeNull();
    expect(placeIsLocal("255-NETWORK CONTRACT OFFICE 15 (36C255), MO")).toBe(false);
    expect(placeIsLocal("City of Norwalk, CT")).toBe(true);
  });

  test("placeholder and garbled addresses are never used (owner 2026-10-29)", () => {
    expect(emailFitsSite("example@thermodirectinc.com", "thermodirectinc.com")).toBe(false);
    expect(emailFitsSite("%20info@canroofconstruction.com", "canroofconstruction.com")).toBe(false);
    expect(emailFitsSite("info@canroofconstruction.com", "canroofconstruction.com")).toBe(true);
  });

  test("a place must be a town, county or agency, not a state or purchasing group", () => {
    expect(placeIsLocal("Texas")).toBe(false);
    expect(placeIsLocal("TX")).toBe(false);
    expect(placeIsLocal("Texas Purchasing Group (BidNet Direct)")).toBe(false);
    expect(placeIsLocal("")).toBe(false);
    expect(placeIsLocal("Bigfork, MT")).toBe(true);
    expect(placeIsLocal("City of Huntsville")).toBe(true);
    expect(placeIsLocal("Smith Mountain, Virginia")).toBe(true);
    expect(placeIsLocal("PRO_North_East")).toBe(false);
    expect(placeIsLocal("Texas Department of Transportation")).toBe(false);
    expect(placeIsLocal("Tx Dept Crim. Justice/inst Div")).toBe(false);
    expect(placeIsLocal("Office of Injured Employee Counsel")).toBe(false);
    expect(placeIsLocal("CMS - Central Management Services")).toBe(false);
    expect(placeIsLocal("Town of Raynham")).toBe(true);
    expect(placeIsLocal("Brazos River Authority")).toBe(true);
  });
});

describe("outreach review fixes (owner 2026-10-25)", () => {
  const base = {
    kind: "first" as const,
    business: "Acme Cleaning",
    bidId: 123,
    bidTitle: "Janitorial Services",
    buyer: "Botetourt County, Virginia",
    due: "2026-11-05",
    tradeLabel: "janitorial",
    postalAddress: "100 Main St, Richmond VA 23219",
    unsubscribeUrl: "https://www.contrax.company/api/outreach/unsubscribe?t=x",
    contactId: 7,
  };
  test("the first email hands over the official posting and makes one ask, no prices", () => {
    const m = outreachEmail({ ...base, sourceUrl: "https://www.botetourtva.gov/bids/123" });
    expect(m.text).toContain("Official posting: https://www.botetourtva.gov/bids/123");
    expect(m.text).toContain("Summary on Contrax: https://www.contrax.company/bid/123");
    expect(m.text).toContain('reply "yes"');
    expect(m.text).not.toContain("$");
    expect(m.text).not.toContain("/pricing");
  });
  test("without a usable posting link it falls back to the Contrax page", () => {
    for (const sourceUrl of [null, "javascript:alert(1)", "not a url"]) {
      const m = outreachEmail({ ...base, sourceUrl });
      expect(m.text).toContain("Details: https://www.contrax.company/bid/123");
      expect(m.text).not.toContain("Official posting");
    }
  });
  test("a long buyer name is left out of the subject", () => {
    const m = outreachEmail({ ...base, buyer: "Department of General Services, Division of Purchases and Supply" });
    expect(m.subject).toBe("Open janitorial bid, due Nov 5");
  });
  test("the follow-up keeps the free offer first and the official link", () => {
    const m = outreachEmail({ ...base, kind: "followup", sourceUrl: "https://example.gov/b" });
    expect(m.text).toContain("Official posting: https://example.gov/b");
    expect(m.text.indexOf('reply "yes"')).toBeLessThan(m.text.indexOf("Starter"));
  });

  test("prime outreach: which awards qualify (owner 2026-10-30)", () => {
    const base = { naics_code: "561720", recipient_state: "FL", pop_state: "TX", amount: 250_000 };
    expect(primeAwardFits(base)).toBe(true);
    expect(primeAwardFits({ ...base, pop_state: "FL" })).toBe(false); // works in its own state
    expect(primeAwardFits({ ...base, naics_code: "541512" })).toBe(false); // IT, not subcontractable trade work
    expect(primeAwardFits({ ...base, amount: 10_000 })).toBe(false);
    expect(primeAwardFits({ ...base, recipient_state: null })).toBe(false);
  });

  test("prime outreach: only the awarded company's own listing is used", () => {
    expect(sameCompany("ACME FACILITY SERVICES LLC", "Acme Facility Services")).toBe(true);
    expect(sameCompany("The Bellwether Group, Inc.", "Bellwether Janitorial")).toBe(true);
    expect(sameCompany("ACME FACILITY SERVICES LLC", "Best Janitorial of Houston")).toBe(false);
    expect(primeDescription("JANITORIAL   SERVICES\nFOR BLDG 12")).toBe("JANITORIAL SERVICES FOR BLDG 12");
    expect(primeDescription("x ".repeat(200)).length).toBeLessThanOrEqual(140);
  });

  test("prime outreach email: one free-list ask, no price, no bid link", () => {
    const mail = outreachEmail({
      kind: "prime",
      business: "Acme Facility Services LLC",
      bidId: 991,
      bidTitle: "JANITORIAL SERVICES FOR THE GALVESTON FEDERAL BUILDING",
      buyer: "General Services Administration",
      due: "2026-11-29",
      tradeLabel: "janitorial",
      place: "Texas",
      postalAddress: "203 Homestead Dr, Colonial Heights VA 23834",
      unsubscribeUrl: "https://www.contrax.company/api/outreach/unsubscribe?t=x",
      contactId: 1,
    });
    expect(mail.subject).toBe("Local janitorial subcontractor for your Texas contract?");
    expect(mail.text).toContain("Congratulations on your recent General Services Administration janitorial contract in Texas:");
    expect(mail.text).toContain("The first list is free.");
    expect(mail.text).toContain("Unsubscribe: https://www.contrax.company/api/outreach/unsubscribe?t=x");
    expect(mail.text).toContain("203 Homestead Dr");
    expect(mail.text).not.toContain("/bid/");
    expect(mail.text).not.toContain("$");
  });
});
