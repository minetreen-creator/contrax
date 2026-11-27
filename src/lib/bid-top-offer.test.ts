import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bidTopLockLine, BID_TOP_ALSO, BID_PAGE_PACK_DETAIL } from "./bid-top-offer";
import { BID_PACK_FILES } from "./bid-pack";

const page = readFileSync(new URL("../routes/bid.$bidId.tsx", import.meta.url), "utf8");

test("the first screen of a locked bid says what is locked and shows one full-width button", () => {
  expect(bidTopLockLine(true)).toContain("contracting officer's contact");
  expect(bidTopLockLine(false)).not.toContain("contact");
  expect(BID_TOP_ALSO).toContain("Cancel anytime");
  expect(page).toContain("{bidTopLockLine(!!bid.has_contact)}");
  expect(page).toContain("{BID_TOP_BUTTON_LEAD}");
  expect(page).toContain("{BID_TOP_ALSO}");
  // Same event and same confirm step as before, so the console's money panel still counts it.
  expect(page).toContain('trackEvent("bid_top_starter_click", locked ? "new" : "members");');
  // The button comes before the job summary.
  expect(page.indexOf("{BID_TOP_BUTTON_LEAD}")).toBeLessThan(page.indexOf('aria-label="What the job is"'));
});

test("the paperwork pack is offered on the bid page, with the real price and file count", () => {
  expect(page).toContain("href={`${BID_PACK_PATH}?source=bid`}");
  expect(page).toContain('trackEvent("bid_pack_click", String(bid.id))');
  expect(page).toContain("{BID_PACK_NAME}, {BID_PACK_PRICE} →");
  // "three more" must stay true: three files are named and the pack holds six.
  expect(BID_PACK_FILES.length).toBe(6);
  expect(BID_PAGE_PACK_DETAIL).toContain("three more Word files");
});
