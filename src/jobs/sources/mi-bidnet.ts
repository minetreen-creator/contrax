/**
 * BidNet Direct — MITN, the Michigan Inter-governmental Trade Network — `mi_bidnet`.
 *
 * WHY: owner 2026-11-13 ("we need thousands"; Michigan was among the thinnest states, 182 open
 * bids). Michigan's cities, counties, school districts and authorities post on MITN, BidNet's
 * Michigan purchasing group; its slug is `mitn`, not `michigan` (that path is a 404). The state's
 * own agencies stay on `mi_sigma`.
 *
 * SOURCE (checked 2026-11-13, no login, no CAPTCHA): GET
 * https://www.bidnetdirect.com/mitn/solicitations/open-bids read "248 Open Solicitations", the same
 * server-rendered list the shared `bidnet-direct.ts` engine reads for every other state group.
 * Same honesty, region, bot-wall and daily-cadence rules as `fl-bidnet.ts` and the engine header.
 *
 * IDENTITY: `external_id = mibidnet-<BidNet's own solicitation id>`.
 */
import { createBidNetGroup, BIDNET_ORIGIN, type BidNetGroupConfig } from "./bidnet-direct";

export const MI_BIDNET_SOURCE = "mi_bidnet";
export const MI_BIDNET_LIST_URL = `${BIDNET_ORIGIN}/mitn/solicitations/open-bids`;

const MI_BIDNET_CONFIG: BidNetGroupConfig = {
  source: MI_BIDNET_SOURCE,
  idPrefix: "mibidnet",
  slug: "mitn",
  stateName: "Michigan",
  groupName: "Michigan Inter-governmental Trade Network (MITN)",
};

const group = createBidNetGroup(MI_BIDNET_CONFIG);
if (group.listUrl !== MI_BIDNET_LIST_URL) throw new Error("mi_bidnet: list URL does not match BidNet's group slug");

export const parseMiBidnet = group.parse;
export const parseMiBidnetRows = group.parseRows;
export const fetchMiBidnetBids = group.fetchBids;
