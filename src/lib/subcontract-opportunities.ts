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
