import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Owner 2026-11-09 ("1"): 110 real people opened a bid page in a week and 4 tapped $5. On a phone
// the $5 button sat below the first screen, the app banner covered it, and a "$19/month" contact
// link under it argued with the $5 (the pass includes the contact).
const page = readFileSync(new URL("../routes/bid.$bidId.tsx", import.meta.url), "utf8");
const banner = readFileSync(new URL("../components/AppInstallBanner.tsx", import.meta.url), "utf8");

test("a locked bid shows the $5 line in the first screen, opening the same confirm step", () => {
  expect(page).toContain('trackEvent("bid_top_starter_click", locked ? "new" : "members");');
  expect(page).toContain("{pass ? `$${STARTER_FIRST_MONTH_PRICE} for 30 days, one time` : `Starter, $${STARTER_FULL_PRICE}/month`}");
  // One sheet for the page; every $5 button calls the same unlock.
  expect(page.match(/<UnlockBidSheet /g)?.length).toBe(1);
  expect(page).toContain("<NoticeLock bidId={bid.id} signedIn={signedIn} isNew={locked} pass={pass} onUnlock={unlock} />");
});

test("the contact link says the $5 pass includes it, and only a used pass is told $19/month", () => {
  expect(page).toContain("{pass ? `See who to contact: included in the $${STARTER_FIRST_MONTH_PRICE} pass →` : `See who to contact: Starter, $${STARTER_FULL_PRICE}/month →`}");
  expect(page).not.toContain("See who to contact: Starter, $19/month →");
});

test("the app banner waits until the visitor has seen the $5 offer", () => {
  expect(page).toContain('<AppInstallBanner where="bid" hold={!checked || (lockShown && !offerSeen)} />');
  // Owner 2026-11-10: and only for paid members (the hold still applies).
  expect(banner).toContain("if (!due || hold || !paid || shown.current || !platform) return;");
  // Still mounted at once, so Android's install event is caught while the banner is held.
  expect(banner).toContain('window.addEventListener("beforeinstallprompt", onPrompt);');
});
