/**
 * Private bid requests (owner 2026-11-18: "this is a go"). Businesses post "now accepting bids"
 * for work on their own property, and a contractor does not care whether the customer is a county
 * or a franchise. A request is listed here only with the owner's permission, using only what the
 * owner's own notice says plus what they tell us. Listing is free. Contrax does not verify the
 * business, take a fee, or handle the bids: contractors answer the owner directly.
 *
 * A request is PUBLISHED (shown on /private-bids, indexable) only once `contact` is confirmed by
 * the owner. Until then its page exists for the owner to preview and says how to bid is pending.
 */
export interface PrivateBidRequest {
  slug: string;
  title: string;
  buyer: string;
  trade: string;
  states: string[];
  /** What the owner's notice says they need, in their words where possible. */
  scope: string[];
  locations: string[];
  /** ISO date the owner gave for bids, or null when they gave none. */
  deadline: string | null;
  /** How to send a bid, confirmed by the owner; null until they confirm. */
  contact: { email: string; note?: string } | null;
  listedOn: string;
  permission: string;
}

export const PRIVATE_BID_REQUESTS: readonly PrivateBidRequest[] = [
  {
    slug: "kasselmann-hood-cleaning-ky-in",
    title: "Commercial hood and duct cleaning for 8 restaurants",
    buyer: "Kasselmann Family McDonald's",
    trade: "Commercial kitchen hood cleaning",
    states: ["KY", "IN"],
    scope: [
      "A professional hood cleaning company to service 8 restaurant locations throughout Kentucky and Indiana",
      "Ongoing exhaust hood and duct cleaning services",
      "A reliable, experienced company",
    ],
    locations: ["Buckner, KY", "LaGrange, KY", "Eminence, KY", "Pendleton, KY", "Madison, IN", "Hanover, IN", "Clarksville, IN", "Veterans Parkway, IN"],
    deadline: null,
    // Confirmed by the owner on 2026-11-18: this address takes bids and questions (it is also on her notice).
    contact: { email: "ninet@salibamcd.com", note: "Use the same address for questions about the job." },
    listedOn: "2026-11-18",
    permission: "Listed with the owner's permission, from the owner's own notice.",
  },
  {
    // The company answered "Yes and thank you!" to the offer to list it, 2026-11-18.
    slug: "advanced-pro-cleaning-salt-lake-city-warehouse",
    title: "Janitorial partner for a warehouse contract in Salt Lake City",
    buyer: "Advanced Pro Cleaning, LLC",
    trade: "Commercial janitorial (subcontract)",
    states: ["UT"],
    scope: [
      "An established, insured, locally based janitorial company with commercial and warehouse experience",
      "Commercial warehouse, Monday to Friday, starting 3:30 PM",
      "About 2 hours per visit for one cleaner, on a recurring monthly contract",
      "2 restrooms, 1 cafeteria, 1 general manager's office, 2 medium conference rooms, 2 loading docks (daily dust mopping), public hallways and common areas",
      "Paid twice a month or once at month end, your choice",
      "Selection: a first interview on Zoom, then an in-person walkthrough at the facility",
      "The monthly pay is not in the notice. The company sends the full scope of work and compensation on request",
    ],
    locations: ["Salt Lake City, UT"],
    // The company gave the date when asked, 2026-11-18.
    deadline: "2026-12-01",
    contact: { email: "info@advancedprofessionalcleaning.com", note: "Ask for the full scope of work and the monthly compensation." },
    listedOn: "2026-11-18",
    permission: "Listed with the company's permission, from its own notice.",
  },
];

export const privateBidPublished = (r: PrivateBidRequest): boolean => r.contact !== null;
export const publishedPrivateBids = (): PrivateBidRequest[] => PRIVATE_BID_REQUESTS.filter(privateBidPublished);
export const privateBidBySlug = (slug: string): PrivateBidRequest | null => PRIVATE_BID_REQUESTS.find((r) => r.slug === slug) ?? null;
export const PRIVATE_BIDS_DISCLAIMER =
  "Contrax lists this request for free and does not verify the business, take a fee or handle bids. You deal with the owner directly.";

/**
 * Which requests a page shows (owner 2026-11-19: a Kentucky hood-cleaning job and a Utah
 * janitorial job were showing on the South Carolina construction page). The homepage shows
 * all of them; a state page shows only requests with a location in that state.
 */
export function privateBidsForPlace<T extends { states: string[] }>(requests: T[], variant: "home" | "page", stateCode: string | null | undefined): T[] {
  if (variant === "home") return requests;
  const code = String(stateCode ?? "").toUpperCase();
  return code ? requests.filter((r) => r.states.includes(code)) : [];
}
