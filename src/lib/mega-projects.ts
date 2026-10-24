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
