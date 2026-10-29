/**
 * Maricopa County, Arizona — the county's own page on BidNet Direct —
 * `az_maricopa_bidnet` (owner 2026-10-29: "Add the Phoenix, Tempe, Mesa and
 * Maricopa boards").
 *
 * The county moved its solicitations from Periscope S2G to BidNet Direct on
 * May 1, 2025; maricopa.gov/2190/Solicitations links "View Open Solicitations in
 * BidNet Direct" to this page. Its rows are member-agency postings
 * (`origin=2` links), a different listing from the statewide abstracts the
 * Arizona Purchasing Group list (`az_bidnet`) prints, so the two never overlap.
 *
 * SOURCE (captured 2026-10-29 via GitHub Actions, no login, no cookies, no POST):
 *   GET https://www.bidnetdirect.com/arizona/maricopacounty/solicitations/open-bids
 * heading `6 Open Solicitations`, one page. Same markup, parser, honesty rules
 * and bot-wall handling as every BidNet group (`bidnet-direct.ts`); the only
 * differences are the buyer name and the place, which this page states.
 */
import { createBidNetGroup, BIDNET_ORIGIN, type BidNetGroupConfig } from "./bidnet-direct";

export const AZ_MARICOPA_BIDNET_SOURCE = "az_maricopa_bidnet";
export const AZ_MARICOPA_BIDNET_LIST_URL = `${BIDNET_ORIGIN}/arizona/maricopacounty/solicitations/open-bids`;
export const AZ_MARICOPA_BIDNET_AGENCY = "Maricopa County Procurement Services";

const CONFIG: BidNetGroupConfig = {
  source: AZ_MARICOPA_BIDNET_SOURCE,
  idPrefix: "azmaricopabidnet",
  slug: "arizona/maricopacounty",
  stateName: "Arizona",
  groupName: "Arizona Purchasing Group (Maricopa County Procurement Services page)",
  agencyName: AZ_MARICOPA_BIDNET_AGENCY,
  locationName: "Maricopa County, AZ",
  maxPages: 3,
};

const group = createBidNetGroup(CONFIG);

if (group.listUrl !== AZ_MARICOPA_BIDNET_LIST_URL)
  throw new Error("az_maricopa_bidnet: list URL does not match the county's BidNet page");

export const parseAzMaricopaBidnetRows = group.parseRows;
export const azMaricopaBidnetStatedOpenCount = group.statedOpenCount;
/** PURE parse of the county's rows — no network, no DB; `now` is injected. */
export const parseAzMaricopaBidnet = group.parse;
/** Read the county's public BidNet open-bids page. */
export const fetchAzMaricopaBidnetBids = group.fetchBids;
