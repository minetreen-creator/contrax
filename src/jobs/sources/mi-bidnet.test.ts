import { expect, test } from "bun:test";
import { MI_BIDNET_LIST_URL, MI_BIDNET_SOURCE } from "./mi-bidnet";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { isBidnetSource } from "../bidnet-cadence";

// Owner 2026-11-13 ("we need thousands"): Michigan's BidNet group is MITN (slug "mitn").
test("mi_bidnet reads BidNet's MITN group, on the daily BidNet cadence, scoped to Michigan", () => {
  expect(MI_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/mitn/solicitations/open-bids");
  expect(TAIL_SOURCES.some((s) => s.name === MI_BIDNET_SOURCE)).toBe(true);
  expect(isBidnetSource(MI_BIDNET_SOURCE)).toBe(true);
  expect(SOURCE_CLASSES[MI_BIDNET_SOURCE]?.scopeState).toBe("MI");
});
