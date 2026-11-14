import { describe, expect, test } from "bun:test";
import { agencyCore, domainFitsAgency, govDomainFor, parseGovDomains, pickAgencyAddress, purchasingLinks } from "./buyer-lookup";
import { buyerEmail } from "./outreach";

// Owner 2026-11-14: the first buyer notes run found a buyer for 5 of 40 bids.
const CSV = [
  "Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email",
  "frontroyalva.gov,City,Town of Front Royal,,Front Royal,VA,(blank)",
  "fairfaxcounty.gov,County,Fairfax County,,Fairfax,VA,(blank)",
  "fairfaxva.gov,City,City of Fairfax,,Fairfax,VA,(blank)",
  'kalispell.gov,City,"City of Kalispell, Montana",,Kalispell,MT,(blank)',
  "vsp.gov,State,Virginia State Police,,Richmond,VA,(blank)",
  "greer.gov,City,City of Greer,,Greer,TX,(blank)",
  "not-a-domain,City,City of Nowhere,,Nowhere,VA,(blank)",
].join("\n");

describe("buyer lookup", () => {
  const rows = parseGovDomains(CSV);
  test("the registry file parses by header name and keeps only .gov domains", () => {
    expect(rows.length).toBe(6);
    expect(rows[0]).toEqual({ domain: "frontroyalva.gov", type: "City", org: "Town of Front Royal", city: "Front Royal", state: "VA" });
    expect(parseGovDomains("")).toEqual([]);
    expect(parseGovDomains("a,b\n1,2")).toEqual([]);
  });
  test("a town, city or county resolves to its own domain in its own state", () => {
    expect(agencyCore("Town of Front Royal")).toEqual({ kind: "town", core: "front royal" });
    expect(govDomainFor("Town of Front Royal", "VA", rows)).toBe("frontroyalva.gov");
    expect(govDomainFor("County of Fairfax", "VA", rows)).toBe("fairfaxcounty.gov");
    expect(govDomainFor("City of Fairfax", "VA", rows)).toBe("fairfaxva.gov");
    expect(govDomainFor("City of Kalispell", "MT", rows)).toBe("kalispell.gov");
    expect(agencyCore("Commerce , City Of")).toEqual({ kind: "city", core: "commerce" });
    expect(agencyCore("Municipality of Bethel Park, Allegheny County")).toEqual({ kind: "municipality", core: "bethel park" });
    // Same name, another state: not theirs.
    expect(govDomainFor("City of Greer", "SC", rows)).toBeNull();
    // State agencies and schools are left alone.
    expect(govDomainFor("Virginia State Police", "VA", rows)).toBeNull();
    expect(govDomainFor("Rockbridge County Public Schools", "VA", rows)).toBeNull();
    expect(govDomainFor(null, "VA", rows)).toBeNull();
  });
  test("a .org or .com that carries the agency's name counts; free mail and other names do not", () => {
    expect(domainFitsAgency("townofpulaski.org", "Town of Pulaski")).toBe(true);
    expect(domainFitsAgency("pulaskitown.com", "Town of Pulaski")).toBe(true);
    expect(domainFitsAgency("gmail.com", "Town of Pulaski")).toBe(false);
    expect(domainFitsAgency("acme-roofing.com", "Town of Pulaski")).toBe(false);
    expect(domainFitsAgency("bidnetdirect.com", "City of Bid")).toBe(false);
    expect(buyerEmail(["bids@townofpulaski.org"], (d) => domainFitsAgency(d, "Town of Pulaski"))).toBe("bids@townofpulaski.org");
    expect(buyerEmail(["bids@townofpulaski.org"])).toBeNull();
  });
  test("on the agency's site the purchasing mailbox wins, then a general office one, never another department or a help box", () => {
    expect(pickAgencyAddress(["police@frontroyalva.gov", "info@frontroyalva.gov", "purchasing@frontroyalva.gov"], "frontroyalva.gov")).toBe("purchasing@frontroyalva.gov");
    expect(pickAgencyAddress(["police@frontroyalva.gov", "clerk@frontroyalva.gov"], "frontroyalva.gov")).toBe("clerk@frontroyalva.gov");
    expect(pickAgencyAddress(["jsmith@frontroyalva.gov", "helpdesk@frontroyalva.gov"], "frontroyalva.gov")).toBeNull();
    expect(pickAgencyAddress(["purchasing@elsewhere.gov"], "frontroyalva.gov")).toBeNull();
  });
  test("purchasing pages are found on the same site only", () => {
    const html = '<a href="/departments/purchasing">Purchasing</a><a href="https://other.com/bids">Bids</a><a href="/bids.pdf">Bid list</a><a href="/parks">Parks</a>';
    expect(purchasingLinks(html, "https://www.frontroyalva.gov")).toEqual(["https://www.frontroyalva.gov/departments/purchasing"]);
  });
});
