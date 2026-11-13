/**
 * Mega-project leads (/mega-projects): big PRIVATE builds — plants, data centers —
 * whose subcontract work never posts as a public solicitation. Hand-curated
 * (owner 2026-10-24): every fact here carries the public source it came from, and
 * a field we could not confirm (the general contractor, most often) stays null
 * and shows as "not yet named" rather than a guess.
 *
 * Each project also names the public buyers around the site (slugs from
 * src/lib/local-agencies.ts): the county work a project this size sets off —
 * roads, water and sewer, schools — does post publicly, and the page lists it live.
 */
import { AGENCY_BY_SLUG, type LocalAgency } from "~/lib/local-agencies";

export interface MegaProjectSource {
  label: string;
  url: string;
}

export interface MegaProject {
  /** URL slug for /mega-projects/{slug}. */
  slug: string;
  name: string;
  owner: string;
  /** Short plain-language "what is being built". */
  summary: string;
  place: string;
  stateCode: string;
  /** Announced investment, in dollars. */
  investment: number;
  status: "announced" | "under_construction" | "complete";
  /** ISO date of the groundbreaking, when there was one. */
  groundbreaking: string | null;
  /** Expected start of operations, as reported (a year or a season). */
  expectedOpen: string | null;
  constructionJobs: number | null;
  permanentJobs: number | null;
  /** General contractor / construction manager, only when publicly named. */
  generalContractor: string | null;
  /** Street address of the site, when reported. */
  address: string | null;
  /**
   * Other firms publicly tied to the job (engineer on the permits, site contractor…),
   * each with the source that names it. Only firms a source names; never inferred.
   */
  knownFirms: { name: string; role: string; sourceUrl: string }[];
  /** Heading over `knownFirms`; default "Firms already on the job". */
  knownFirmsHeading?: string;
  /** Trades a build of this kind needs; general to the building type, not a bid list. */
  trades: string[];
  /** How a small contractor gets onto the job, in order. */
  howToGetIn: string[];
  /** Public buyers around the site whose open bids the page lists. */
  nearbyAgencySlugs: string[];
  /**
   * Statewide buyers that also build around the site (owner 2026-10-24: VDOT for
   * the roads). Their rows don't say where the work is, so the page lists them in
   * their own section labeled statewide, never mixed into the nearby count.
   */
  statewideAgencies: LocalAgency[];
  /**
   * Place names that flag a statewide bid as possibly near the site (owner
   * 2026-10-24). A text match, shown as one: the card says which word matched
   * and where, and it only reorders the statewide list, never the nearby count.
   */
  areaTerms: string[];
  sources: MegaProjectSource[];
  /** ISO date the entry was last checked against its sources. */
  verifiedOn: string;
}

export const MEGA_PROJECTS: MegaProject[] = [
  {
    slug: "eli-lilly-goochland-va",
    name: "Eli Lilly medicine plant, Goochland County",
    owner: "Eli Lilly and Company",
    summary:
      "Lilly's first integrated plant making both active pharmaceutical ingredients and finished medicines, focused on antibody-drug conjugates (targeted cancer treatments), on a 227-acre site in West Creek Business Park just west of Richmond.",
    place: "Goochland County",
    stateCode: "VA",
    investment: 5_000_000_000,
    status: "under_construction",
    groundbreaking: "2026-10-22",
    expectedOpen: "2030",
    constructionJobs: 1800,
    permanentJobs: 650,
    generalContractor: null,
    address: "12575 West Creek Parkway, Goochland County, VA",
    knownFirms: [
      {
        name: "Dewberry",
        role: "Engineering firm that filed the stormwater and land-disturbance permit applications with Lilly (June 2026)",
        sourceUrl:
          "https://richmondbizsense.com/2026/06/24/massive-eli-lilly-project-in-goochland-awaits-scc-approval-of-new-dominion-transmission-line/",
      },
    ],
    trades: [
      "Site work, grading and utilities",
      "Concrete and structural steel",
      "Process piping and stainless welding",
      "Cleanroom construction",
      "HVAC and controls",
      "Electrical and instrumentation",
      "Fire protection",
      "Commissioning and validation support",
    ],
    howToGetIn: [
      "Site work (clearing, grading, underground utilities) was set to start in August 2026 under Goochland's land-disturbance permit. Site and utility work may already be under way, so contact the firms named on this page now instead of waiting.",
      "Watch for the general contractor or construction manager to be named. On a plant this size, almost every trade package is bought by that firm, not by Lilly.",
      "Once it is named, get on its subcontractor prequalification list early. Expect to show safety records (EMR, OSHA logs), bonding capacity, insurance, and similar past work.",
      "Get certified as a Virginia small, women- or minority-owned business (SWaM) through the Virginia Department of Small Business and Supplier Diversity if you qualify. Large owners and their contractors often track local and diverse spend.",
      "Bid the public work around the site, listed below. A project this size brings county road, water, sewer and school work that posts publicly.",
    ],
    nearbyAgencySlugs: [
      "goochland-county",
      "goochland-county-public-schools",
      "henrico-county",
      "powhatan-county",
      "hanover-county",
      "louisa-county",
      "city-of-richmond",
    ],
    statewideAgencies: [
      {
        source: "va_eva",
        agencyName: "Virginia Department of Transportation",
        slug: "virginia-department-of-transportation",
        name: "Virginia Department of Transportation (VDOT)",
        via: "eVA, Virginia's procurement portal",
      },
    ],
    // The site's county, its business park, the neighbors on the nearby list, and
    // VDOT's Richmond District (which covers Goochland), as eVA work locations name it.
    areaTerms: ["Goochland", "West Creek", "Henrico", "Powhatan", "Hanover", "Louisa", "Richmond District"],
    sources: [
      {
        label: "Lilly press release (PR Newswire)",
        url: "https://www.prnewswire.com/news-releases/lilly-breaks-ground-in-richmond-to-expand-american-manufacturing-of-next-generation-cancer-medicines-advancing-its-build-out-of-10-new-us-sites-since-2020-302916266.html",
      },
      { label: "Virginia Business", url: "https://virginiabusiness.com/eli-lilly-5b-virginia-manufacturing-site-groundbreaking/" },
      {
        label: "Richmond BizSense: site address and land purchase",
        url: "https://richmondbizsense.com/2026/07/23/breaking-news-eli-lilly-pays-38m-to-secure-land-for-massive-west-creek-pharma-facility",
      },
      {
        label: "Richmond BizSense: permits filed with Dewberry",
        url: "https://richmondbizsense.com/2026/06/24/massive-eli-lilly-project-in-goochland-awaits-scc-approval-of-new-dominion-transmission-line/",
      },
      { label: "ENR: no design or contracting partners named", url: "https://www.enr.com/articles/61440-virginia-wins-5b-eli-lilly-biomanufacturing-facility" },
      { label: "WRIC 8News", url: "https://www.wric.com/news/local-news/goochland-county/groundbreaking-drug-manufacturing-facility/" },
    ],
    verifiedOn: "2026-10-24",
  },
  {
    slug: "rappahannock-general-hospital-kilmarnock-va",
    name: "Rappahannock General Hospital upgrades, Kilmarnock",
    owner: "Bon Secours Mercy Health",
    summary:
      "Modernized patient rooms and updated clinical and support areas at Rappahannock General Hospital in the Northern Neck: about 25,300 square feet of renovation and 18,900 square feet of new construction, phased so the hospital stays open.",
    place: "Kilmarnock",
    stateCode: "VA",
    investment: 73_300_000,
    status: "announced",
    groundbreaking: null,
    expectedOpen: null,
    constructionJobs: null,
    permanentJobs: null,
    generalContractor: null,
    address: null,
    knownFirms: [
      {
        name: "W.M. Jordan Company",
        role: "General contractor on this hospital's 2021–2023 emergency department renovation and expansion (Hummel Associates, architect); not yet named for this project",
        sourceUrl: "https://wmjordan.com/projects/rappahannock-general-hospital-emergency-department-renovation/",
      },
      {
        name: "Connemara Corporation",
        role: "Builder of this hospital's cancer clinic and infusion center, completed 2025; not yet named for this project",
        sourceUrl: "https://rrecord.com/rgh-begins-construction-of-new-infusion-center-and-cancer-clinic/",
      },
    ],
    knownFirmsHeading: "Firms that built this hospital's earlier projects",
    trades: [
      "Selective demolition with infection-control barriers",
      "Framing, drywall and ceilings",
      "Healthcare HVAC and controls",
      "Plumbing and medical gas",
      "Electrical, nurse call and low voltage",
      "Fire protection and life safety",
      "Flooring and finishes",
      "Site work and foundations for the new construction",
    ],
    howToGetIn: [
      "Construction is expected to start in summer 2027, so trade packages will likely be bid in late 2026 and the first half of 2027.",
      "Contact the firms that built this hospital's last two projects, named on this page. Health systems often return to builders who already know the building, and those firms keep subcontractor lists.",
      "Hospital work inside an open building usually requires infection-control (ICRA) training and healthcare experience. Have your certifications, safety record (EMR) and similar past work ready.",
      "Get certified as a Virginia small, women- or minority-owned business (SWaM) if you qualify, and bid the public work in the Northern Neck listed below.",
    ],
    nearbyAgencySlugs: ["westmoreland-county-public-schools"],
    statewideAgencies: [
      {
        source: "va_eva",
        agencyName: "Virginia Department of Transportation",
        slug: "virginia-department-of-transportation",
        name: "Virginia Department of Transportation (VDOT)",
        via: "eVA, Virginia's procurement portal",
      },
    ],
    // Kilmarnock, the Northern Neck's counties, and VDOT's Fredericksburg District (which covers them).
    areaTerms: ["Kilmarnock", "Northern Neck", "Lancaster", "Northumberland", "Westmoreland", "Richmond County", "Fredericksburg District"],
    sources: [
      { label: "Virginia Business", url: "https://virginiabusiness.com/bon-secours-rappahannock-hospital-73-million-investment/" },
      {
        label: "Becker's Hospital Review",
        url: "https://www.beckershospitalreview.com/capital/bon-secours-plans-73-3m-modernization-at-virginia-critical-access-hospital/",
      },
      {
        label: "W.M. Jordan: the 2021–2023 emergency department project",
        url: "https://wmjordan.com/projects/rappahannock-general-hospital-emergency-department-renovation/",
      },
      { label: "Rappahannock Record: the 2025 cancer clinic and infusion center", url: "https://rrecord.com/rgh-begins-construction-of-new-infusion-center-and-cancer-clinic/" },
    ],
    verifiedOn: "2026-10-24",
  },
  {
    slug: "johnston-willis-brain-spine-center-chesterfield-va",
    name: "Johnston-Willis Hospital Brain and Spine Center expansion, Chesterfield",
    owner: "Johnston-Willis Hospital (HCA Virginia)",
    summary:
      "A more than $24 million expansion of the Brain and Spine Center at Johnston-Willis Hospital: a specialized MRI, plus replacement and upgraded equipment for gamma knife treatment and focused ultrasound therapy, with the aim of shorter waits for neurological care.",
    place: "Chesterfield County",
    stateCode: "VA",
    investment: 24_000_000,
    status: "announced",
    groundbreaking: null,
    expectedOpen: "Summer 2027",
    constructionJobs: null,
    permanentJobs: null,
    generalContractor: null,
    address: null,
    knownFirms: [],
    trades: [
      "Selective demolition with infection-control barriers",
      "MRI room construction: RF shielding, magnetic shielding and quench venting",
      "Heavy equipment rigging and structural reinforcement for imaging and radiosurgery equipment",
      "Radiation shielding for the gamma knife suite",
      "Healthcare HVAC and controls, including dedicated equipment cooling",
      "Electrical, emergency power and low voltage",
      "Plumbing and medical gas",
      "Framing, drywall, ceilings, flooring and finishes",
    ],
    howToGetIn: [
      "Construction is expected to take about 10 months, ahead of a planned summer 2027 opening, so trade packages are likely bought soon. Watch for the general contractor to be named; it buys almost every trade package.",
      "Imaging and radiosurgery suites need specialists (RF and magnetic shielding, rigging, radiation shielding). If that's your trade, contact the equipment makers' installation partners and Richmond-area healthcare builders now.",
      "Hospital work inside an open building usually requires infection-control (ICRA) training and healthcare experience. Have your certifications, safety record (EMR) and similar past work ready.",
      "Get certified as a Virginia small, women- or minority-owned business (SWaM) if you qualify, and bid the public work around Richmond listed below.",
    ],
    nearbyAgencySlugs: ["city-of-richmond", "richmond-public-schools", "henrico-county", "powhatan-county", "city-of-hopewell"],
    statewideAgencies: [
      {
        source: "va_eva",
        agencyName: "Virginia Department of Transportation",
        slug: "virginia-department-of-transportation",
        name: "Virginia Department of Transportation (VDOT)",
        via: "eVA, Virginia's procurement portal",
      },
    ],
    // The hospital's county and city, the neighbors on the nearby list, and VDOT's Richmond District.
    areaTerms: ["Chesterfield", "Richmond", "Midlothian", "Henrico", "Powhatan", "Hopewell", "Richmond District"],
    sources: [
      {
        label: "WTVR CBS 6 (Oct 30, 2026)",
        url: "https://www.wtvr.com/news/local-news/johnston-willis-hospital-investing-24m-to-expand-brain-and-spine-center-with-cutting-edge-treatments",
      },
      {
        label: "Richmond BizSense: HCA's 2023 project at Johnston-Willis (owner)",
        url: "https://richmondbizsense.com/2023/08/09/hca-planning-9m-expansion-and-renovation-project-at-johnston-willis/",
      },
    ],
    verifiedOn: "2026-10-30",
  },
  {
    slug: "600-e-street-nw-conversion-washington-dc",
    name: "600 E St. NW office-to-apartments conversion with Sprouts, Washington",
    owner: "Madrone (developer)",
    summary:
      "The D.C. Council approved up to $275 million in bond financing for Madrone, a Berkeley-based nonprofit developer, to convert the vacant 325,000-square-foot former Justice Department office building at 600 E St. NW into 415 apartments, mainly for college students, faculty and staff, with a 25,000-square-foot Sprouts Farmers Market on the ground floor and a 140-space underground garage.",
    place: "Penn Quarter, Washington",
    stateCode: "DC",
    investment: 275_000_000,
    status: "announced",
    groundbreaking: null,
    expectedOpen: null,
    constructionJobs: null,
    permanentJobs: null,
    generalContractor: null,
    address: "600 E St. NW, Washington, DC 20004",
    knownFirms: [],
    trades: [
      "Interior demolition and abatement of a long-vacant office building",
      "Structural alterations for residential layouts, new shafts and openings",
      "Plumbing for 415 apartments (kitchens and baths throughout)",
      "HVAC: new residential systems replacing office systems",
      "Electrical, fire alarm, sprinkler and low voltage",
      "Framing, drywall, doors, cabinets, flooring and finishes",
      "Window, facade and roofing work",
      "Grocery fit-out for the ground-floor Sprouts: refrigeration, kitchen and store build-out",
      "Garage, elevator and fitness/coworking amenity work",
    ],
    howToGetIn: [
      "The general contractor has not been named. It will buy nearly every trade package, so watch for the announcement and get on its bidder list as soon as it is named.",
      "Office-to-residential conversions repeat the same unit layouts hundreds of times: plumbing, drywall, cabinets, flooring and finish subs who can staff a 415-unit job are the ones primes look for.",
      "The Sprouts store is a separate tenant build-out (reported $6 million tenant allowance) and is often bought by the grocer's own contractor. Refrigeration and grocery fit-out specialists should follow Sprouts' construction team.",
      "D.C. projects with public financing usually carry local hiring and small-business goals. Certify with the D.C. Department of Small and Local Business Development (CBE) if you qualify.",
    ],
    nearbyAgencySlugs: ["montgomery-county-md", "fairfax-county", "city-of-alexandria", "arlington-public-schools"],
    statewideAgencies: [],
    areaTerms: ["Washington, DC", "District of Columbia", "Penn Quarter", "Judiciary Square", "Arlington", "Alexandria", "Fairfax", "Montgomery County"],
    sources: [
      { label: "Bisnow: D.C. approves $275M for downtown conversion with grocery store", url: "https://www.bisnow.com/news/washington-dc/office/dc-approves-275m-for-downtown-conversion-with-grocery-store" },
      { label: "The Real Deal (Nov 12, 2026)", url: "https://therealdeal.com/national/washington-dc/2026/11/12/former-doj-office-set-for-student-housing-conversion/" },
    ],
    verifiedOn: "2026-11-13",
  },
  {
    slug: "te-connectivity-henrietta-ny",
    name: "TE Connectivity optical products plant, Henrietta",
    owner: "TE Connectivity",
    summary:
      "A $62 million project to repurpose the vacant 135,000-square-foot former Sam's Club at 1600 Marketplace Drive into a plant making high-density fiber array units and related optical products for AI data centers. New York State says it will create more than 860 jobs, backed by up to $22 million in performance-based Excelsior Jobs Tax Credits.",
    place: "Henrietta, Monroe County",
    stateCode: "NY",
    investment: 62_000_000,
    status: "announced",
    groundbreaking: null,
    expectedOpen: "Spring 2027",
    constructionJobs: null,
    permanentJobs: 860,
    generalContractor: null,
    address: "1600 Marketplace Drive, Henrietta, NY",
    knownFirms: [],
    trades: [
      "Interior demolition of a former big-box store",
      "Clean-room and controlled-environment construction for optical manufacturing",
      "Process HVAC, humidity control and filtration",
      "Heavy electrical service, distribution and backup power for production lines",
      "Compressed air, process piping and plumbing",
      "Concrete floor work, slab cuts and equipment pads",
      "Fire protection upgrades for a manufacturing occupancy",
      "Office, lab and employee-area build-out; parking and site work",
    ],
    howToGetIn: [
      "The site is expected to open in spring 2027, so the build-out of the existing building is likely bought soon. Watch for the general contractor to be named; it buys almost every trade package.",
      "Clean-room, process HVAC and heavy electrical are the specialist packages here. Rochester-area firms with clean-room or manufacturing experience should contact local industrial builders now.",
      "Production ramps up through 2031, so equipment installation, maintenance, janitorial and facility services will be bought for years after the opening.",
      "Get certified as a New York minority- or women-owned business (MWBE) or service-disabled veteran-owned business if you qualify, and bid the public work around Rochester listed below.",
    ],
    nearbyAgencySlugs: ["livingston-county-ny"],
    statewideAgencies: [],
    areaTerms: ["Henrietta", "Rochester", "Monroe County", "Livingston County", "Brighton", "Pittsford", "Rush"],
    sources: [
      { label: "Rochester First / News 8 WROC", url: "https://www.rochesterfirst.com/news/business/local-business/te-connectivity-expands-to-henrietta-creating-800-jobs/" },
      { label: "Rochester Business Journal (Nov 12, 2026)", url: "https://rbj.net/2026/11/12/te-connectivity-62-million-optical-project-henrietta/" },
      { label: "Governor Hochul announcement", url: "https://www.governor.ny.gov/news/governor-hochul-announces-te-connectivity-establish-new-york-operations-monroe-county-creating" },
    ],
    verifiedOn: "2026-11-13",
  },
  {
    slug: "aalo-atomics-georgetown-tx",
    name: "Aalo Atomics reactor factory, Georgetown",
    owner: "Aalo Atomics",
    summary:
      "Aalo Atomics, an Austin startup that builds small factory-made nuclear power plants for AI data centers, filed with the Texas Department of Licensing and Regulation on Aug. 31, 2026 to renovate a 204,350-square-foot warehouse at 4813 N. I-35 into a $25 million machine shop and production floor. The Austin Business Journal also reports it is in talks to lease a 606,000-square-foot industrial building under construction in Georgetown's CrossPoint Business District.",
    place: "Georgetown, Williamson County",
    stateCode: "TX",
    investment: 25_000_000,
    status: "announced",
    groundbreaking: "November 2026 (state filing)",
    expectedOpen: "January 2028 (state filing)",
    constructionJobs: null,
    permanentJobs: null,
    generalContractor: null,
    address: "4813 N. I-35, Georgetown, TX",
    knownFirms: [],
    trades: [
      "Warehouse interior demolition and renovation",
      "Heavy concrete: new slabs, machine foundations and equipment pads",
      "Overhead cranes, crane rails and structural steel reinforcement",
      "Heavy electrical service and distribution for machine tools",
      "Process HVAC, ventilation and compressed air",
      "Fire protection upgrades for a manufacturing occupancy",
      "Office and employee-area build-out; site, paving and security fencing",
    ],
    howToGetIn: [
      "The state filing puts construction from November 2026 to January 2028, so trade packages are being bought now. The general contractor is not yet named; it will be listed on the TDLR filing (search TABS for 4813 N I-35, Georgetown).",
      "Machine-shop conversions need heavy concrete, crane and power work. Austin-area industrial subs in those trades should contact industrial builders working the I-35 corridor now.",
      "If the 606,000-square-foot CrossPoint lease goes ahead, that build-out will be a second, larger round of work. Watch for it.",
      "Get certified as a Texas HUB (historically underutilized business) if you qualify, and bid the public work around Georgetown listed below.",
    ],
    nearbyAgencySlugs: ["city-of-georgetown-tx", "williamson-county-tx", "city-of-round-rock-tx"],
    statewideAgencies: [],
    areaTerms: ["Georgetown", "Williamson County", "Round Rock", "Jarrell", "Leander", "Hutto"],
    sources: [
      { label: "Community Impact: Aalo Atomics plans $25M facility in Georgetown", url: "https://communityimpact.com/georgetown/development/aalo-atomics-plans-25m-advanced-manufacturing-facility-in-georgetown/" },
      { label: "Williamson County Sun", url: "https://www.wilcosun.com/news-georgetown/nuclear-power-manufacturer-open-25-million-facility-georgetown" },
      { label: "CRE News: CrossPoint lease talks (Sep 2, 2026)", url: "https://crenews.com/2026/09/02/nuclear-power-startup-eyes-major-industrial-lease-in-georgetown-texas/" },
    ],
    verifiedOn: "2026-11-13",
  },
];

export const MEGA_PROJECT_BY_SLUG: Record<string, MegaProject> = Object.fromEntries(
  MEGA_PROJECTS.map((p) => [p.slug, p]),
);

export function megaProjectHref(p: { slug: string }): string {
  return `/mega-projects/${p.slug}`;
}

/** Nearby buyers that resolve in the local registry (unknown slugs drop out). */
export function nearbyAgencies(p: MegaProject) {
  return p.nearbyAgencySlugs.map((s) => AGENCY_BY_SLUG[s]).filter((a) => a !== undefined);
}

export const STATUS_LABEL: Record<MegaProject["status"], string> = {
  announced: "Announced",
  under_construction: "Under construction",
  complete: "Complete",
};

export interface AreaMention {
  term: string;
  /** Where it matched: eVA's stated work location is the strongest. */
  field: "location" | "title" | "description";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * First area term a bid names, checking the work location, then the title, then
 * the description. Whole words, any case ("Goochland" matches "GOOCHLAND CO",
 * not "Goochlandia"). Null when none match.
 */
export function areaMention(
  b: { location: string | null; title: string; description: string | null },
  terms: readonly string[],
): AreaMention | null {
  if (terms.length === 0) return null;
  const fields: [AreaMention["field"], string | null][] = [
    ["location", b.location],
    ["title", b.title],
    ["description", b.description],
  ];
  for (const [field, text] of fields) {
    if (!text) continue;
    for (const term of terms) {
      if (new RegExp(`\\b${escapeRe(term)}\\b`, "i").test(text)) return { term, field };
    }
  }
  return null;
}
