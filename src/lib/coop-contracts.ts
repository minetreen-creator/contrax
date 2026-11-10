/**
 * Co-op contracts (owner 2026-11-10: "How does this work" → "yes build it"). Pathway step 5: getting on a
 * purchasing cooperative's contract, so member agencies can buy from you with a purchase order instead of
 * running their own bid. Facts below come from each co-op's own pages (checked 2026-11-10); the open
 * solicitations come from src/jobs/coop-sync.ts. PURE and browser-safe.
 */

export interface Coop {
  key: "sourcewell" | "buyboard" | "tips" | "hgacbuy" | "omnia" | "naspo";
  name: string;
  /** Who runs it, in the co-op's own terms. */
  runBy: string;
  /** Who can buy from its contracts. */
  members: string;
  /** How a business gets on. */
  howToGetOn: string;
  /** Where it posts the solicitations a business answers. */
  postsAt: { label: string; url: string };
  /** True when Contrax reads its open solicitations (public page, robots allow). */
  inContrax: boolean;
}

export const COOPS: readonly Coop[] = [
  {
    key: "sourcewell",
    name: "Sourcewell",
    runBy: "A State of Minnesota local government unit and service cooperative.",
    members: "Thousands of government, K-12, higher education, nonprofit and tribal agencies in the United States and Canada.",
    howToGetOn: "Answer the RFP for your category through the Sourcewell Procurement Portal before its due date. It also runs indefinite-quantity construction solicitations.",
    postsAt: { label: "sourcewell-mn.gov/solicitations", url: "https://www.sourcewell-mn.gov/solicitations" },
    inContrax: true,
  },
  {
    key: "buyboard",
    name: "BuyBoard",
    runBy: "The Local Government Purchasing Cooperative, administered by the Texas Association of School Boards.",
    members: "Texas school districts, cities, counties and other local governments, plus members of its National Cooperative.",
    howToGetOn: "Register as a vendor (free) and submit a proposal for your category's proposal invitation before its due date.",
    postsAt: { label: "buyboard.com/vendor", url: "https://www.buyboard.com/vendor/proposal-invitations" },
    inContrax: true,
  },
  {
    key: "tips",
    name: "TIPS",
    runBy: "Region 8 Education Service Center in Pittsburg, Texas, as lead agency.",
    members: "Public agencies that join TIPS, in Texas and other states.",
    howToGetOn: "Answer the TIPS RFP for your category. Several vendors are often awarded in a category.",
    postsAt: { label: "tips-usa.com", url: "https://www.tips-usa.com/" },
    inContrax: false,
  },
  {
    key: "hgacbuy",
    name: "HGACBuy",
    runBy: "The Houston-Galveston Area Council.",
    members: "Local governments nationwide that sign an interlocal contract with H-GAC.",
    howToGetOn: "Win a category through its public bid or proposal process, posted in its procurement portal.",
    postsAt: { label: "hgacbuy.org/bid-notices", url: "https://hgacbuy.org/bid-notices" },
    inContrax: false,
  },
  {
    key: "omnia",
    name: "OMNIA Partners",
    runBy: "Contracts are bid and awarded by a lead public agency, then offered nationally through OMNIA Partners.",
    members: "Public agencies across the country.",
    howToGetOn: "There is no sign-up: answer the lead agency's RFP. Suppliers pay a small percentage of purchases made on their contract.",
    postsAt: { label: "omniapartners.com solicitations", url: "https://www.omniapartners.com/for-suppliers/solicitations" },
    inContrax: false,
  },
  {
    key: "naspo",
    name: "NASPO ValuePoint",
    runBy: "State procurement offices: one lead state runs each solicitation for the group.",
    members: "State agencies, once their state signs a participating addendum for that contract.",
    howToGetOn: "Answer the lead state's RFP. Each state then decides whether to use the contract.",
    postsAt: { label: "naspovaluepoint.org", url: "https://www.naspovaluepoint.org/" },
    inContrax: false,
  },
];

export const COOP_BY_KEY: Readonly<Record<string, Coop>> = Object.fromEntries(COOPS.map((c) => [c.key, c]));

/** One open (or announced) co-op solicitation, as stored by the sync. */
export interface CoopSolicitation {
  key: string;
  coop: Coop["key"];
  number: string | null;
  title: string;
  /** ISO instant, or null when the co-op has only announced it ("upcoming"). */
  dueAt: string | null;
  url: string;
  trades: string[];
  /** Sourcewell's indefinite-quantity construction (job-order style) solicitations. */
  construction: boolean;
}

/**
 * Contrax trades a co-op category is for, from its title (the trade slugs in src/lib/seo-trades.ts).
 * Equipment and supply categories ("Construction Equipment", "Audio Visual Equipment and Supplies") are
 * not trade work, so they get none unless the title also names service work. PURE.
 */
export function coopTrades(title: string): string[] {
  const t = title.toLowerCase();
  const out = new Set<string>();
  const services = /\bservices?\b|install|repair|renovat|maintenance|rehabilitation|contracting|construction(?! equipment)/.test(t);
  if (/indefinite (?:delivery|quantity).*construction|job order|construction services|general contract/.test(t)) out.add("construction");
  const goodsOnly = /equipment|supplies|products/.test(t) && !services;
  if (!goodsOnly && /flooring|floor finishing|concrete|paving|pavement|roof|painting|carpentry|pipeline|surfac|renovation/.test(t)) out.add("construction");
  if (/\bhvac\b|mechanical|plumbing|heating|air condition/.test(t) && services) out.add("hvac");
  if (/electrical/.test(t) && services) out.add("electrical");
  if (/janitorial|custodial|facility maintenance|cleaning services/.test(t)) out.add("janitorial");
  if (/landscap|grounds maintenance|turf|mowing|tree (?:care|services)/.test(t) && services) out.add("landscaping");
  if (/security (?:guard|officer|services)/.test(t)) out.add("security-guard");
  if (/trucking|hauling|freight/.test(t)) out.add("trucking");
  if (/waste|recycling services|refuse/.test(t) && services) out.add("waste-hauling");
  if (/cyber/.test(t)) out.add("cybersecurity");
  else if (/information technology|software|it services|cloud/.test(t)) out.add("it-services");
  return [...out];
}

/** "Get on a co-op contract" link for a trade (Radar and the Pathway). */
export const coopPath = (trade?: string | null) => (trade ? `/co-op-contracts?trade=${encodeURIComponent(trade)}` : "/co-op-contracts");

/**
 * The Contrax trade a Radar search is for ("roofing" → construction, "plumbing" → hvac), using the same
 * rules as co-op categories, or null. PURE.
 */
export function coopTradeForQuery(q: string | null | undefined): string | null {
  const t = String(q ?? "").trim().toLowerCase();
  if (!t) return null;
  if (/^(?:hvac|electrical|janitorial|landscaping|construction|trucking|cybersecurity)$/.test(t)) return t;
  if (/^it(?: services)?$/.test(t)) return "it-services";
  return coopTrades(`${t} services`)[0] ?? null;
}
