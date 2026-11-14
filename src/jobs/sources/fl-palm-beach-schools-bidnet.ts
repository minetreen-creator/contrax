/**
 * BidNet Direct — School District of Palm Beach County — `fl_palm_beach_schools_bidnet`.
 *
 * WHY: owner 2026-11-14 ("Florida coverage is very thin"). The district (one of the largest in the
 * country) moved its solicitations to BidNet Direct on 1 Jan 2025, in its own purchasing group, not
 * the statewide Florida group `fl_bidnet` reads: none of its open bids were in Contrax.
 *
 * SOURCE (checked 2026-11-14 as ContraxBot, no login, no CAPTCHA, robots.txt allows the path): GET
 * https://www.bidnetdirect.com/palmbeachschools/solicitations/open-bids read "10 Open Solicitations",
 * the same server-rendered list the shared `bidnet-direct.ts` engine reads for every group.
 *
 * IDENTITY: `external_id = flpbschoolsbidnet-<BidNet's own solicitation id>`.
 */
import { createBidNetGroup, BIDNET_ORIGIN, type BidNetGroupConfig } from "./bidnet-direct";

export const FL_PB_SCHOOLS_BIDNET_SOURCE = "fl_palm_beach_schools_bidnet";
export const FL_PB_SCHOOLS_BIDNET_LIST_URL = `${BIDNET_ORIGIN}/palmbeachschools/solicitations/open-bids`;

const CONFIG: BidNetGroupConfig = {
  source: FL_PB_SCHOOLS_BIDNET_SOURCE,
  idPrefix: "flpbschoolsbidnet",
  slug: "palmbeachschools",
  stateName: "Florida",
  groupName: "School District of Palm Beach County Purchasing Group",
};

const group = createBidNetGroup(CONFIG);
if (group.listUrl !== FL_PB_SCHOOLS_BIDNET_LIST_URL) throw new Error("fl_palm_beach_schools_bidnet: list URL does not match BidNet's group slug");

export const parseFlPbSchoolsBidnet = group.parse;
export const fetchFlPbSchoolsBidnetBids = group.fetchBids;
