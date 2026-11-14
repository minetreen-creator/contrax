import { expect, test } from "bun:test";
import { FL_PB_SCHOOLS_BIDNET_LIST_URL, FL_PB_SCHOOLS_BIDNET_SOURCE } from "./fl-palm-beach-schools-bidnet";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { isBidnetSource } from "../bidnet-cadence";

// Owner 2026-11-14 ("Florida coverage is very thin"): Palm Beach County's school district posts on its own BidNet group.
test("fl_palm_beach_schools_bidnet reads the district's BidNet group, on the daily BidNet cadence, scoped to Florida", () => {
  expect(FL_PB_SCHOOLS_BIDNET_LIST_URL).toBe("https://www.bidnetdirect.com/palmbeachschools/solicitations/open-bids");
  expect(TAIL_SOURCES.some((s) => s.name === FL_PB_SCHOOLS_BIDNET_SOURCE)).toBe(true);
  expect(isBidnetSource(FL_PB_SCHOOLS_BIDNET_SOURCE)).toBe(true);
  expect(SOURCE_CLASSES[FL_PB_SCHOOLS_BIDNET_SOURCE]?.scopeState).toBe("FL");
});
