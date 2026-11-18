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
    contact: null,
    listedOn: "2026-11-18",
    permission: "Listed with the owner's permission, from the owner's own notice.",
  },
];

export const privateBidPublished = (r: PrivateBidRequest): boolean => r.contact !== null;
export const publishedPrivateBids = (): PrivateBidRequest[] => PRIVATE_BID_REQUESTS.filter(privateBidPublished);
export const privateBidBySlug = (slug: string): PrivateBidRequest | null => PRIVATE_BID_REQUESTS.find((r) => r.slug === slug) ?? null;
export const PRIVATE_BIDS_DISCLAIMER =
  "Contrax lists this request for free and does not verify the business, take a fee or handle bids. You deal with the owner directly.";
