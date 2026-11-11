import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CHECKOUT_OPENED_EVENT, linkVisitorToUser, VISITOR_COOKIE, visitorIdFromCookieHeader } from "./checkout-attribution.server";
import { VISITOR_COOKIE_NAME } from "./visitor";
import { parseAttributionCookie } from "./attribution";

// Owner 2026-11-04: the first $5 buyer paid first (account 11 s later), so the
// visit was not tied to the account and Mission Control read "Checkouts 0".
const read = (f: string) => readFileSync(f, "utf8");

describe("checkout attribution", () => {
  test("reads the visitor cookie the site sets", () => {
    expect(VISITOR_COOKIE).toBe(VISITOR_COOKIE_NAME);
    expect(visitorIdFromCookieHeader("a=1; contrax_vid=3f2b9c1e-1111-4a2b-9c3d-123456789abc; b=2")).toBe("3f2b9c1e-1111-4a2b-9c3d-123456789abc");
    expect(visitorIdFromCookieHeader("contrax_vid=<script>")).toBeNull();
    expect(visitorIdFromCookieHeader(null)).toBeNull();
    expect(visitorIdFromCookieHeader("other=1")).toBeNull();
  });

  test("an invalid visitor id is never written", async () => {
    await expect(linkVisitorToUser("not valid!", 1)).resolves.toBeUndefined();
    await expect(linkVisitorToUser(null, 1)).resolves.toBeUndefined();
  });

  test("all three checkout entry points stamp the visitor and record the checkout server-side", () => {
    for (const f of ["src/routes/api/stripe/create-checkout-session.ts", "vercel-entry.ts", "serve.ts"]) {
      const src = read(f);
      expect({ f, stamps: src.includes("...(visitorId ? { visitorId } : {}),") }).toEqual({ f, stamps: true });
      expect({ f, records: src.includes("await recordCheckoutOpened({") }).toEqual({ f, records: true });
    }
    const stripe = read("src/lib/stripe.ts");
    expect(stripe).toContain("if (opts.visitorId) metadata.visitor_id = String(opts.visitorId).slice(0, 64);");
    expect(stripe).toContain("await linkVisitorToUser(session.metadata.visitor_id, Number(userId));");
  });

  // Owner 2026-11-11: 8 of 12 "Stripe opens" were ad-click robots. Their page views were already
  // hidden (old Android Chrome arriving on a paid ad), but the checkout row had no source, so the
  // robot filter could not see it.
  test("the checkout row carries where the visitor came from, so the robot filter applies to it", () => {
    const src = read("src/lib/checkout-attribution.server.ts");
    expect(src).toContain("const attr = parseAttributionCookie(o.cookieHeader);");
    expect(src).toContain("(event_name, label, path, visitor_id, user_id, ip, user_agent, source, medium, campaign, click_id)");
    for (const f of ["src/routes/api/stripe/create-checkout-session.ts", "vercel-entry.ts", "serve.ts"]) {
      expect({ f, passes: /recordCheckoutOpened\(\{[\s\S]{0,500}?cookieHeader/.test(read(f)) }).toEqual({ f, passes: true });
    }
    // The hidden ad-click rule keys on the browser string plus medium = 'cpc'.
    expect(read("src/lib/blocked-user-agents.ts")).toContain("COALESCE(medium,'') = 'cpc'");
    expect(parseAttributionCookie(`contrax_attr=${encodeURIComponent(JSON.stringify({ source: "google", medium: "cpc", campaign: "c1", click_id: "g1" }))}`)).toEqual({
      source: "google", medium: "cpc", campaign: "c1", click_id: "g1",
    });
    expect(parseAttributionCookie("other=1")).toBeNull();
  });

  test("Mission Control counts the server-side checkout too", () => {
    expect(CHECKOUT_OPENED_EVENT).toBe("checkout_session_created");
    expect(read("src/routes/api/admin/live-console.ts")).toContain("event_name IN ('plan_checkout_redirected', 'checkout_session_created')");
  });
});

// Owner 2026-11-11: nothing recorded a sale as an event, so no report could say where buyers came from.
test("a confirmed payment is recorded as an event, with the source from the visitor's checkout", () => {
  const { readFileSync } = require("node:fs");
  const lib = readFileSync("src/lib/checkout-attribution.server.ts", "utf8");
  expect(lib).toContain('export const PURCHASE_EVENT = "purchase_completed";');
  expect(lib).toContain("AND event_name = ${CHECKOUT_OPENED_EVENT} ORDER BY created_at DESC LIMIT 1");
  const fn = lib.slice(lib.indexOf("export async function recordPurchase"), lib.indexOf("/** Tie a paying visitor's recent anonymous history"));
  expect(fn).toContain("} catch (e) {"); // never fails a payment
  expect(fn).not.toContain("o.ip"); // no address stored with the sale
  expect(fn).not.toContain("user_agent");
  const stripe = readFileSync("src/lib/stripe.ts", "utf8");
  expect(stripe).toContain("await recordPurchase({ visitorId: session.metadata?.visitor_id ?? null, userId: Number(userId), label: String(planTier ?? \"\") });");
  // It runs for every confirmed checkout, not only when a visitor id is known.
  expect(stripe.indexOf("await recordPurchase(")).toBeLessThan(stripe.indexOf("await linkVisitorToUser(session.metadata.visitor_id"));
});
