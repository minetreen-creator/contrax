/**
 * Small, manually verified pilot. These are offers from a named prime, not
 * government solicitations or inferred subcontract scopes. Every card links to
 * the individual SBA SUBNet notice checked on 2026-09-25.
 */
export interface SubcontractOpportunity {
  id: string;
  title: string;
  prime: string;
  state: string;
  trades: string[];
  scope: string;
  dueDate: string;
  requirement?: string;
  contactEmail: string;
  sourceUrl: string;
}

export const SUBCONTRACT_OPPORTUNITIES: SubcontractOpportunity[] = [
  {
    id: "atterbury-landscaping-2026",
    title: "Dorm and common area landscaping",
    prime: "Adams & Associates, Inc. / Atterbury Job Corps",
    state: "IN",
    trades: ["Landscaping"],
    scope: "Landscaping, tree and bush trimming, and campus grounds upkeep.",
    dueDate: "2026-10-12",
    requirement: "Mandatory site visit October 2 at 10:30 a.m.; only attendees' bids will be considered.",
    contactEmail: "swallows.tammy@jobcorps.org",
    sourceUrl: "https://legacy.sba.gov/opportunity/dorm-common-area-landscaping",
  },
  {
    id: "college-place-wwtp-2026",
    title: "College Place WWTP Phase 1B",
    prime: "Prospect Construction, Inc.",
    state: "WA",
    trades: ["Electrical", "HVAC", "Plumbing", "Concrete", "Painting"],
    scope: "Prime requests pricing for listed construction scopes including electrical, HVAC, plumbing, concrete, and painting/coating.",
    dueDate: "2026-10-20",
    requirement: "AIS and Washington prevailing/Davis-Bacon wage requirements apply; check the prime's bid documents.",
    contactEmail: "bids@prospectconst.com",
    sourceUrl: "https://legacy.sba.gov/opportunity/college-place-wwtp-phase-1b",
  },
  {
    id: "hobart-cipp-2026",
    title: "Hobart Brookview Terrace and Merrillville Heights CIPP",
    prime: "SAK Construction, LLC",
    state: "IN",
    trades: ["Traffic Control", "Excavation", "Sewer Rehabilitation"],
    scope: "Subcontract scopes include traffic control, open cut excavation, lateral lining, and manhole rehabilitation.",
    dueDate: "2026-10-06",
    contactEmail: "bidcippc@sakcon.com",
    sourceUrl: "https://legacy.sba.gov/opportunity/hobart-brookview-terrace-merrillville-heights-cipp",
  },
  {
    id: "mtc-san-diego-drain-2026",
    title: "San Diego Job Corps building drain replacement",
    prime: "Management & Training Corporation",
    state: "CA",
    trades: ["Plumbing"],
    scope: "MTC requests plumbing bids for a drain replacement at the San Diego Job Corps Center in Imperial Beach.",
    dueDate: "2026-10-13",
    requirement: "Review the scope of work and supplier packet attached to the SBA notice.",
    contactEmail: "tom.williams@mtctrains.com",
    sourceUrl: "https://legacy.sba.gov/opportunity/cbp6404-bldg-63b-drain-replacement",
  },
  {
    id: "fletc-trade-cargo-2026",
    title: "FLETC Trade & Cargo Academy",
    prime: "Cooper Tacia General Contracting Company",
    state: "SC",
    trades: ["Concrete", "Electrical", "Plumbing", "HVAC", "Painting"],
    scope: "Prime lists demolition, concrete, masonry, steel, millwork, waterproofing, openings, glazing, drywall, painting, flooring, fire suppression, plumbing, mechanical, electrical, and sitework.",
    dueDate: "2026-10-12",
    contactEmail: "Neelesh.vodala@coopertacia.com",
    sourceUrl: "https://legacy.sba.gov/opportunity/fletc-trade-cargo-academy",
  },
  {
    id: "edison-ahu-cleaning-2026",
    title: "Edison Job Corps HVAC and ductwork cleaning",
    prime: "Management & Training Corporation",
    state: "NJ",
    trades: ["HVAC", "Cleaning"],
    scope: "Air handling unit and ductwork cleaning services at the Edison Job Corps Center.",
    dueDate: "2026-10-16",
    requirement: "Review the scope of work and supplier packet attached to the SBA notice.",
    contactEmail: "Wendy.lawrence@mtctrains.com",
    sourceUrl: "https://legacy.sba.gov/opportunity/cbp9772-hvac-air-handling-unit-ahu-ductwork-cleaning-services",
  },
  {
    id: "filanc-ieua-2026",
    title: "IEUA RP-5 offsite facilities and Butterfield lift station",
    prime: "Filanc",
    state: "CA",
    trades: ["Electrical", "Concrete"],
    scope: "Prime seeks quotes for scopes including paving, concrete, coatings, fire suppression, pipe, valves, and electrical and instrumentation work.",
    dueDate: "2026-10-29",
    contactEmail: "jmasaitis@filanc.com",
    sourceUrl: "https://legacy.sba.gov/opportunity/ieua-rp-5-offsite-facilities-project-no-en1900103-butterfield-lift-station-improvements-project-no",
  },
];

/** SUBNet notices give dates, usually without a time; retain through that date in Eastern time. */
export function openSubcontracts(todayEastern: string): SubcontractOpportunity[] {
  return SUBCONTRACT_OPPORTUNITIES.filter((item) => item.dueDate >= todayEastern);
}
