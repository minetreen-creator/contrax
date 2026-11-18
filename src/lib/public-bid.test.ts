import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { agencyKind, publicAgency, publicTitle, scrubAgencyName } from "./public-bid";

describe("what a bid shows without a pass (owner 2026-11-18: no more freebies)", () => {
  test("the buyer is described, never named", () => {
    expect(publicAgency("Rock Hill School District 3", "South Carolina")).toBe("A South Carolina school district");
    expect(publicAgency("Clayton County Board Of Education", "Georgia")).toBe("A Georgia school district");
    expect(publicAgency("Hillsborough County Public Schools", "Florida")).toBe("A Florida school district");
    expect(publicAgency("Henrico County Government", "Virginia")).toBe("A Virginia county government");
    expect(publicAgency("County of Guilford", "North Carolina")).toBe("A North Carolina county government");
    expect(publicAgency("City of Winston-Salem", "North Carolina")).toBe("A North Carolina city or town");
    expect(publicAgency("Town of Chapel Hill", "North Carolina")).toBe("A North Carolina city or town");
    expect(publicAgency("University Of Georgia", "Georgia")).toBe("A Georgia college or university");
    expect(publicAgency("Virginia Department of Transportation", "Virginia")).toBe("A Virginia state agency");
    expect(publicAgency("City of Columbus", "Ohio")).toBe("An Ohio city or town");
    expect(publicAgency("Navfacsyscom Southeast", "Florida", "sam_naics_236220")).toBe("A federal agency");
    expect(publicAgency("Gotriangle", "North Carolina")).toBe("A North Carolina public agency");
    expect(publicAgency("City of Corona", null)).toBe("A city or town");
    expect(publicAgency("", "Ohio")).toBeNull();
    expect(publicAgency("Utah Purchasing Group (BidNet Direct)", "Utah")).toBe("A Utah public agency (posted on BidNet Direct)");
    expect(agencyKind("The Citadel")).toBe("public");
  });
  test("the agency's own numbers come out of the title, and the job stays readable", () => {
    expect(publicTitle("IFB-26-27-020 Neighborhood Street Resurfacing Program")).toBe("Neighborhood Street Resurfacing Program");
    expect(publicTitle("RFB 27-54218 Burruss Park Bridge Construction")).toBe("Burruss Park Bridge Construction");
    expect(publicTitle("Bid 4001-091626 High Point Transit System Sewer Line CIPP Rehabilitation")).toBe("High Point Transit System Sewer Line CIPP Rehabilitation");
    expect(publicTitle("#2026-30 Concrete Maintenance")).toBe("Concrete Maintenance");
    expect(publicTitle("BL162-26, Emergency Repair Services for Water and Sewer Mains on an Annual Contract")).toBe("Emergency Repair Services for Water and Sewer Mains on an Annual Contract");
    expect(publicTitle("RFP2027-01 - HVAC City of Duluth", "Duluth, City Of")).toBe("HVAC City of Duluth");
    expect(publicTitle("047-26 Water Department Bathroom Renovation")).toBe("Water Department Bathroom Renovation");
    expect(publicTitle("ITB No. 26-3026-11JL - Westwood Sewer Improvements Phase 1")).toBe("Westwood Sewer Improvements Phase 1");
    expect(publicTitle("RFQ 704022: Construction of the Dulles West Boulevard")).toBe("Construction of the Dulles West Boulevard");
    expect(publicTitle("Construction of the Dulles West Boulevard, RFQ 704022")).toBe("Construction of the Dulles West Boulevard");
    expect(publicTitle("Tara Elementary School HVAC and Roof Replacement, Project No. 2027-01")).toBe("Tara Elementary School HVAC and Roof Replacement");
    expect(publicTitle("Concrete Work and Pavilion Construction at Animal Shelter (IFB 2027-005)")).toBe("Concrete Work and Pavilion Construction at Animal Shelter");
    expect(publicTitle("LU214-27-009 Moton Museum Pavilion Interior Renovation")).toBe("Moton Museum Pavilion Interior Renovation");
    // A year or fiscal year is part of the job's name.
    expect(publicTitle("FY2027 Local Roads Resurfacing")).toBe("FY2027 Local Roads Resurfacing");
    expect(publicTitle("Sunset Park Partial Roof Replacement")).toBe("Sunset Park Partial Roof Replacement");
    expect(publicTitle("HVAC Repair")).toBe("HVAC Repair");
  });
  test("the buyer's name comes out of the title and the description", () => {
    expect(publicTitle("City of Bristol, Virginia is seeking qualified contractors to provide for bridge construction services", "City of Bristol")).toBe("The agency is seeking qualified contractors to provide for bridge construction services");
    expect(scrubAgencyName("Roof work for the Rock Hill School District 3 at two schools.", "Rock Hill School District 3")).toBe("Roof work for the agency at two schools.");
  });
  test("the bid page masks on the server and only a paying member gets the real name back", () => {
    const page = readFileSync(new URL("../routes/bid.$bidId.tsx", import.meta.url), "utf8");
    expect(page).toContain("agency: publicAgency(agency,");
    expect(page).toContain("title: publicTitle(");
    expect(page).toContain("solicitation_number: paid ?");
    expect(page).toContain("agency: paid ?");
  });
  test("the lists that lead to a bid page are masked on the server too", () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    expect(read("./seo-landing.tsx")).toContain("agency: publicAgency(r.agency ? String(r.agency) : null, seoBidStateName(r)");
    expect(read("./seo-landing.tsx")).toContain("recent = pickRegionBids(rows as any[], STATE_CODE_TO_NAME[code] ?? null);");
    expect(read("../routes/open-bids.$state.tsx")).toContain("agency: publicAgency(");
    expect(read("../routes/radar.tsx")).toContain("card.agency = publicAgency(card.agency,");
    expect(read("./sample-bids.ts")).toContain("agency: publicAgency(");
    expect(read("./open-to-all.ts")).toContain("agency: publicAgency(");
  });
});
