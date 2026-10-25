/**
 * Megaprojects near you (owner 2026-10-25, "1"): the big PRIVATE plants going
 * up in the US (chip fabs, factories, pharma campuses). They aren't government
 * bids, but each one hires hundreds of local small businesses as subs and
 * suppliers, before and after it opens.
 *
 * Curated by hand: every amount, job count and contractor comes from the
 * linked source (the company's own announcement, a state or county economic
 * development office, or a major outlet), checked on `checked`. Nothing here
 * is estimated. A field the source doesn't give stays null and the page says
 * nothing about it.
 */
export type MegaSector = "semiconductors" | "tech" | "manufacturing" | "automotive" | "pharma" | "aerospace-defense" | "battery" | "metals" | "energy" | "food";

export interface Megaproject {
  slug: string;
  company: string;
  project: string;
  city: string;
  state: string;
  sector: MegaSector;
  /** Headline investment for this site, in dollars; null when the source doesn't give one. */
  amount: number | null;
  /** How the source frames the amount, e.g. "up to $100 billion over 20+ years". */
  amountNote: string | null;
  jobs: number | null;
  jobsNote: string | null;
  status: string;
  summary: string;
  generalContractor: { name: string; url: string | null } | null;
  /** Where local suppliers and subs can register or learn how to bid. */
  supplierUrl: { label: string; url: string } | null;
  source: { name: string; url: string };
  checked: string;
}

export const MEGA_SECTORS: Record<MegaSector, { label: string; icon: string }> = {
  semiconductors: { label: "Semiconductors", icon: "💾" },
  tech: { label: "Tech", icon: "🖥️" },
  manufacturing: { label: "Manufacturing", icon: "🏭" },
  automotive: { label: "Automotive", icon: "🚗" },
  pharma: { label: "Pharmaceuticals", icon: "💊" },
  "aerospace-defense": { label: "Aerospace & defense", icon: "🚀" },
  battery: { label: "Batteries", icon: "🔋" },
  metals: { label: "Steel & metals", icon: "🏗️" },
  energy: { label: "Energy", icon: "☀️" },
  food: { label: "Food & beverage", icon: "🥤" },
};

/** The kinds of local work a site like this typically buys (general guidance, not a promise from the company). */
export const LOCAL_WORK = [
  "Site work, paving and concrete",
  "Electrical, HVAC and plumbing",
  "Trucking, hauling and equipment rental",
  "Security guards",
  "Janitorial and industrial cleaning",
  "Landscaping and snow removal",
  "Fencing, signage and maintenance",
  "Catering, staffing and office supply",
];

const C = "2026-10-25";
const STELLANTIS = { name: "Stellantis announcement, Oct 14, 2025", url: "https://www.stellantis.com/en/news/press-releases/2025/october/stellantis-to-invest-13-billion-to-grow-in-the-united-states" };
const STELLANTIS_SUPPLIERS = { label: "Stellantis supplier portal", url: "https://www.esupplierconnect.com" };
const LILLY_SUPPLIERS = { label: "Lilly supplier information", url: "https://www.lilly.com/suppliers" };
const MICRON_SUPPLIERS = { label: "Micron supplier information", url: "https://www.micron.com/about/company/suppliers" };

export const MEGAPROJECTS: Megaproject[] = [
  {
    slug: "micron-clay-ny",
    company: "Micron",
    project: "Memory chip megafab",
    city: "Clay",
    state: "NY",
    sector: "semiconductors",
    amount: 100e9,
    amountNote: "up to, over 20+ years, for as many as four fabs",
    jobs: 9000,
    jobsNote: "direct Micron jobs; about 50,000 statewide counting suppliers and community jobs",
    status: "Under construction since January 2026; first fab expected around 2030",
    summary: "The largest private investment in New York history: up to four memory chip fabs near Syracuse, built in phases over two decades.",
    generalContractor: { name: "Bechtel", url: "https://www.enr.com/articles/63140-bechtel-award-advances-micron-100b-new-york-megafab-toward-first-construction" },
    supplierUrl: MICRON_SUPPLIERS,
    source: { name: "Micron groundbreaking coverage (Verdict)", url: "https://www.verdict.co.uk/micron-breaks-ground-megafab/" },
    checked: C,
  },
  {
    slug: "micron-boise-id",
    company: "Micron",
    project: "Second Boise memory fab",
    city: "Boise",
    state: "ID",
    sector: "semiconductors",
    amount: 30e9,
    amountNote: "added in 2025 for a second leading-edge fab",
    jobs: null,
    jobsNote: null,
    status: "First fab under construction (output mid-2027); second fab under construction",
    summary: "Two leading-edge memory fabs at Micron's Boise headquarters.",
    generalContractor: null,
    supplierUrl: MICRON_SUPPLIERS,
    source: { name: "Micron annual report (SEC)", url: "https://www.sec.gov/Archives/edgar/data/0000723125/000072312526000023/mu-20260903.htm" },
    checked: C,
  },
  {
    slug: "micron-manassas-va",
    company: "Micron",
    project: "Manassas DRAM fab expansion",
    city: "Manassas",
    state: "VA",
    sector: "semiconductors",
    amount: 2e9,
    amountNote: "more than",
    jobs: null,
    jobsNote: null,
    status: "Expanding; new DRAM production started May 2026",
    summary: "An expansion of Micron's existing Manassas fab to make advanced DRAM memory chips.",
    generalContractor: null,
    supplierUrl: MICRON_SUPPLIERS,
    source: { name: "Evertiq, May 2026", url: "https://evertiq.com/design/2026-05-26-micron-starts-1a-dram-production-at-virginia-fab-in-usd-2-billion-expansion" },
    checked: C,
  },
  {
    slug: "tsmc-phoenix-az",
    company: "TSMC",
    project: "Arizona chip fab complex",
    city: "Phoenix",
    state: "AZ",
    sector: "semiconductors",
    amount: 165e9,
    amountNote: "total in Arizona: six fabs, two packaging plants and an R&D center",
    jobs: 40000,
    jobsNote: "construction jobs over four years",
    status: "First fab producing; more fabs under construction through the end of the decade",
    summary: "The world's biggest chipmaker's U.S. campus in north Phoenix, the largest foreign direct investment in U.S. history.",
    generalContractor: null,
    supplierUrl: null,
    source: { name: "TSMC filing (SEC), March 2025", url: "https://www.sec.gov/Archives/edgar/data/1046179/000104617925000024/tsmcexpandinvestmentintheu.htm" },
    checked: C,
  },
  {
    slug: "apple-houston-tx",
    company: "Apple",
    project: "Houston AI server plant",
    city: "Houston",
    state: "TX",
    sector: "tech",
    amount: null,
    amountNote: null,
    jobs: null,
    jobsNote: null,
    status: "Operating since October 2025; Mac mini production added in 2026",
    summary: "Apple builds AI servers for its data centers here, part of its $600 billion U.S. investment commitment.",
    generalContractor: null,
    supplierUrl: null,
    source: { name: "Apple Newsroom, February 2026", url: "https://www.apple.com/newsroom/2026/02/apple-accelerates-us-manufacturing-with-mac-mini-production/" },
    checked: C,
  },
  {
    slug: "hyundai-translead-joliet-il",
    company: "Hyundai Translead",
    project: "Will County trailer plants",
    city: "Joliet",
    state: "IL",
    sector: "manufacturing",
    amount: 600e6,
    amountNote: "raised from $450 million, adding a third shift",
    jobs: 3750,
    jobsNote: "full-time",
    status: "Announced; two former plants being refitted, production by 2027",
    summary: "Commercial trailers, truck bodies and flatbeds at two retrofitted plants in Will County.",
    generalContractor: null,
    supplierUrl: null,
    source: { name: "Herald-News, Oct 22, 2026", url: "https://www.shawlocal.com/the-herald-news/2026/10/22/pritzker-says-new-will-county-hyundai-plant-will-create-3750-new-jobs/" },
    checked: C,
  },
  {
    slug: "carrier-fort-worth-tx",
    company: "Carrier",
    project: "Fort Worth chiller plant",
    city: "Fort Worth",
    state: "TX",
    sector: "manufacturing",
    amount: 600e6,
    amountNote: "more than, over three years",
    jobs: 1500,
    jobsNote: "manufacturing, engineering and support",
    status: "Announced October 2026; operations expected in 2027",
    summary: "Over a million square feet at AllianceTexas making commercial chillers for data centers, hospitals, schools and industry.",
    generalContractor: null,
    supplierUrl: null,
    source: { name: "Carrier press release, Oct 2026", url: "https://www.carrier.com/us/en/news/corporate/2026/carrierto-invest-more-than-600-million-to-expand-advanced-us-manufacturing-and-engineering-capacity/" },
    checked: C,
  },
  {
    slug: "blue-bird-fort-valley-ga",
    company: "Blue Bird",
    project: "Fort Valley school bus plant",
    city: "Fort Valley",
    state: "GA",
    sector: "automotive",
    amount: 300e6,
    amountNote: "estimated",
    jobs: 375,
    jobsNote: "over three years",
    status: "Announced October 2026; construction to begin early 2027",
    summary: "A former motorhome plant becomes a million-square-foot factory for Type C school buses (diesel, gas, propane and electric).",
    generalContractor: null,
    supplierUrl: { label: "Blue Bird supplier portal", url: "https://service.blue-bird.com/Portal/Supplier-Portal.aspx" },
    source: { name: "Georgia Dept. of Economic Development, Oct 2026", url: "https://georgia.org/press-releases/2026/blue-bird-invests-300-million-peach-county" },
    checked: C,
  },
  {
    slug: "stellantis-belvidere-il",
    company: "Stellantis",
    project: "Belvidere Assembly reopening",
    city: "Belvidere",
    state: "IL",
    sector: "automotive",
    amount: 600e6,
    amountNote: "more than",
    jobs: 3300,
    jobsNote: null,
    status: "Announced; production expected 2027 to 2028",
    summary: "Reopening the idled Belvidere plant to build Jeep models, part of Stellantis' $13 billion U.S. plan.",
    generalContractor: null,
    supplierUrl: STELLANTIS_SUPPLIERS,
    source: STELLANTIS,
    checked: C,
  },
  {
    slug: "stellantis-toledo-oh",
    company: "Stellantis",
    project: "Toledo midsize truck",
    city: "Toledo",
    state: "OH",
    sector: "automotive",
    amount: 400e6,
    amountNote: "about",
    jobs: 900,
    jobsNote: "about",
    status: "Announced; production in 2028",
    summary: "A new midsize truck line at the Toledo Assembly Complex.",
    generalContractor: null,
    supplierUrl: STELLANTIS_SUPPLIERS,
    source: STELLANTIS,
    checked: C,
  },
  {
    slug: "stellantis-detroit-mi",
    company: "Stellantis",
    project: "Detroit Jefferson next Dodge Durango",
    city: "Detroit",
    state: "MI",
    sector: "automotive",
    amount: 130e6,
    amountNote: null,
    jobs: null,
    jobsNote: null,
    status: "Announced; production in 2029",
    summary: "Tooling up the Jefferson plant for the next-generation Dodge Durango.",
    generalContractor: null,
    supplierUrl: STELLANTIS_SUPPLIERS,
    source: STELLANTIS,
    checked: C,
  },
  {
    slug: "stellantis-warren-mi",
    company: "Stellantis",
    project: "Warren Truck large SUV",
    city: "Warren",
    state: "MI",
    sector: "automotive",
    amount: 100e6,
    amountNote: "about",
    jobs: 900,
    jobsNote: "about",
    status: "Announced; production in 2028",
    summary: "A new large SUV at Warren Truck Assembly.",
    generalContractor: null,
    supplierUrl: STELLANTIS_SUPPLIERS,
    source: STELLANTIS,
    checked: C,
  },
  {
    slug: "stellantis-kokomo-in",
    company: "Stellantis",
    project: "Kokomo engine plant",
    city: "Kokomo",
    state: "IN",
    sector: "automotive",
    amount: 100e6,
    amountNote: "more than",
    jobs: 100,
    jobsNote: "more than",
    status: "Announced",
    summary: "Production of a new four-cylinder engine in Kokomo.",
    generalContractor: null,
    supplierUrl: STELLANTIS_SUPPLIERS,
    source: STELLANTIS,
    checked: C,
  },
  {
    slug: "lilly-huntsville-al",
    company: "Eli Lilly",
    project: "Huntsville medicine plant",
    city: "Huntsville",
    state: "AL",
    sector: "pharma",
    amount: 6e9,
    amountNote: "more than",
    jobs: 450,
    jobsNote: "permanent, plus about 3,000 construction jobs",
    status: "Construction from 2026; completion expected 2032",
    summary: "A plant making active pharmaceutical ingredients, one of four new U.S. sites in Lilly's $27 billion plan.",
    generalContractor: null,
    supplierUrl: LILLY_SUPPLIERS,
    source: { name: "Office of Alabama Gov. Kay Ivey, Dec 2025", url: "https://governor.alabama.gov/newsroom/2025/12/governor-ivey-announces-pharmaceutical-giant-lilly-plans-6-billion-advanced-manufacturing-plant-in-huntsville/" },
    checked: C,
  },
  {
    slug: "lilly-houston-tx",
    company: "Eli Lilly",
    project: "Houston Generation Park plant",
    city: "Houston",
    state: "TX",
    sector: "pharma",
    amount: 6.5e9,
    amountNote: null,
    jobs: 615,
    jobsNote: "permanent, plus about 4,000 construction jobs",
    status: "Announced September 2025; operating within about five years",
    summary: "A plant making active pharmaceutical ingredients at Generation Park in northeast Houston.",
    generalContractor: null,
    supplierUrl: LILLY_SUPPLIERS,
    source: { name: "Lilly press release, Sep 2025", url: "https://www.nasdaq.com/press-release/lilly-plans-build-new-65-billion-facility-manufacture-active-pharmaceutical" },
    checked: C,
  },
  {
    slug: "lilly-goochland-va",
    company: "Eli Lilly",
    project: "Goochland medicine plant",
    city: "Goochland",
    state: "VA",
    sector: "pharma",
    amount: 5e9,
    amountNote: null,
    jobs: 650,
    jobsNote: "permanent, plus about 1,800 construction jobs",
    status: "Announced September 2025; completion within about five years",
    summary: "A new medicine plant at West Creek Business Park, west of Richmond.",
    generalContractor: null,
    supplierUrl: LILLY_SUPPLIERS,
    source: { name: "Lilly press release, Sep 2025", url: "https://investor.lilly.com/news-releases/news-release-details/lilly-announces-plans-build-5-billion-manufacturing-facility" },
    checked: C,
  },
  {
    slug: "rivian-stanton-springs-ga",
    company: "Rivian",
    project: "Georgia EV plant",
    city: "Social Circle",
    state: "GA",
    sector: "automotive",
    amount: 5e9,
    amountNote: null,
    jobs: 7500,
    jobsNote: "by 2030",
    status: "Under construction since September 2025; production in 2028",
    summary: "Rivian's East Coast factory at Stanton Springs North, east of Atlanta, for its R2 and R3 vehicles.",
    generalContractor: { name: "Clayco", url: "https://www.costar.com/article/522835006/rivian-to-open-east-coast-headquarters-in-atlanta-with-factory-construction-set-for-next-year" },
    supplierUrl: { label: "Clayco subcontractor prequalification", url: "https://claycorp.com/contact-us/subcontractor-pre-qual" },
    source: { name: "Rivian press release, Sep 2025", url: "https://www.businesswire.com/news/home/20250916595109/en" },
    checked: C,
  },
  {
    slug: "hadrian-cherokee-al",
    company: "Hadrian",
    project: "Submarine parts factory",
    city: "Cherokee",
    state: "AL",
    sector: "aerospace-defense",
    amount: 2.4e9,
    amountNote: "$900 million from the Navy plus $1.5 billion private",
    jobs: 1000,
    jobsNote: "up to",
    status: "Opened March 2026; ramping up",
    summary: "An automated factory making parts for the Navy's Columbia- and Virginia-class submarine programs.",
    generalContractor: null,
    supplierUrl: null,
    source: { name: "U.S. Navy press release, Mar 2026", url: "https://www.navy.mil/Press-Office/Press-Releases/display-pressreleases/Article/4439992/advanced-shipbuilding-factory-of-the-future-opens-in-alabama/" },
    checked: C,
  },
  {
    slug: "valeo-mcallen-tx",
    company: "Valeo",
    project: "McAllen vehicle computer plant",
    city: "McAllen",
    state: "TX",
    sector: "automotive",
    amount: 225e6,
    amountNote: "over five years",
    jobs: 500,
    jobsNote: "up to",
    status: "Under construction since March 2026; production late 2027",
    summary: "A plant making central computers for software-defined vehicles.",
    generalContractor: null,
    supplierUrl: null,
    source: { name: "Valeo press release, Mar 2026", url: "https://www.barchart.com/story/news/932442/valeo-breaks-ground-on-225-million-high-tech-plant-in-mcallen-texas-for-software-defined-vehicle-technology" },
    checked: C,
  },
  {
    slug: "aerovironment-albuquerque-nm",
    company: "AeroVironment",
    project: "Albuquerque defense campus expansion",
    city: "Albuquerque",
    state: "NM",
    sector: "aerospace-defense",
    amount: 30e6,
    amountNote: "more than",
    jobs: 450,
    jobsNote: "more than, over ten years",
    status: "Announced March 2026",
    summary: "Expanding defense manufacturing (optics, ground terminals and RF systems) at Sandia Science & Technology Park.",
    generalContractor: null,
    supplierUrl: { label: "AeroVironment supplier portal", url: "https://suppliers.avinc.com/" },
    source: { name: "New Mexico Economic Development Dept., Mar 2026", url: "https://edd.newmexico.gov/press-releases/av-to-expand-abq-defense-manufacturing-campus/" },
    checked: C,
  },
  {
    slug: "niagara-elsmere-ky",
    company: "Niagara Bottling",
    project: "Elsmere bottled water plant",
    city: "Elsmere",
    state: "KY",
    sector: "food",
    amount: 141e6,
    amountNote: null,
    jobs: 60,
    jobsNote: "full-time",
    status: "Opened October 2026",
    summary: "Niagara's first Kentucky plant: 436,000 square feet of beverage production and distribution at the C5 Airport East Logistics Center in Kenton County.",
    generalContractor: null,
    supplierUrl: null,
    source: { name: "Northern Kentucky Tribune, Oct 2026", url: "https://nkytribune.com/2026/10/niagara-bottling-celebrates-grand-opening-of-new-141-million-production-facility-in-elsmere/" },
    checked: C,
  },
  {
    slug: "primo-hot-springs-ar",
    company: "Primo Brands",
    project: "Mountain Valley spring water plant",
    city: "Hot Springs",
    state: "AR",
    sector: "food",
    amount: null,
    amountNote: null,
    jobs: null,
    jobsNote: null,
    status: "Opened October 14, 2026",
    summary: "A 200,000-square-foot plant with three production lines plus warehouse and logistics space for Mountain Valley spring and sparkling water. Primo didn't disclose the investment or job count.",
    generalContractor: null,
    supplierUrl: null,
    source: { name: "Primo Brands press release, Oct 2026", url: "https://www.bevnet.com/pr/2026/10/15/primo-brands-opens-new-mountain-valley-factory-as-demand-gro" },
    checked: C,
  },
];

/** $1.5 billion, $600 million, $225 million. */
export function megaMoney(n: number | null): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e9) return `$${trimZero(n / 1e9)} billion`;
  if (n >= 1e6) return `$${trimZero(n / 1e6)} million`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function trimZero(x: number): string {
  return (Math.round(x * 10) / 10).toString();
}

/** Biggest first; projects without an amount after, by company. */
export function sortMegaprojects(list: readonly Megaproject[]): Megaproject[] {
  return [...list].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1) || a.company.localeCompare(b.company));
}

export function megaStateCounts(list: readonly Megaproject[]): { code: string; count: number }[] {
  const m = new Map<string, number>();
  for (const p of list) m.set(p.state, (m.get(p.state) ?? 0) + 1);
  return [...m].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

export function megaTotals(list: readonly Megaproject[]): { projects: number; amount: number; jobs: number } {
  return {
    projects: list.length,
    amount: list.reduce((s, p) => s + (p.amount ?? 0), 0),
    jobs: list.reduce((s, p) => s + (p.jobs ?? 0), 0),
  };
}

export function megaprojectsIn(state: string): Megaproject[] {
  const st = state.toUpperCase();
  return sortMegaprojects(MEGAPROJECTS.filter((p) => p.state === st));
}
