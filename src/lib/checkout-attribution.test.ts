import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CHECKOUT_OPENED_EVENT, linkVisitorToUser, VISITOR_COOKIE, visitorIdFromCookieHeader } from "./checkout-attribution.server";
import { VISITOR_COOKIE_NAME } from "./visitor";

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

  test("Mission Control counts the server-side checkout too", () => {
    expect(CHECKOUT_OPENED_EVENT).toBe("checkout_session_created");
    expect(read("src/routes/api/admin/live-console.ts")).toContain("event_name IN ('plan_checkout_redirected', 'checkout_session_created')");
  });
});
