import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("a buyer who lands on sign-up or login after paying is told about the account they already have", () => {
  const signup = read("../routes/signup.tsx");
  expect(signup).toContain("/already exists/i.test(error)");
  expect(signup).toContain("your plan is on that account");
  expect(signup).toContain('href="/forgot-password"');
  expect(read("../routes/login.tsx")).toContain("Paid without making an account?");
});

test("the confirm step's continue tap is sent before the browser leaves for Stripe", () => {
  const sheet = read("../components/UnlockBidSheet.tsx");
  expect(sheet.indexOf("flushTracking();")).toBeGreaterThan(sheet.indexOf('trackEvent("bid_lock_sheet_continue"'));
  expect(sheet.indexOf("flushTracking();")).toBeLessThan(sheet.indexOf("redirectToCheckout("));
});
