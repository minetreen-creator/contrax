import { describe, expect, test } from "bun:test";
import { applyPlanStates, parseFeedQuery, toFeedRow } from "./data-feed";
import { DATA_FEED_OPENAPI } from "./data-feed-openapi";

const q = (s: string) => {
  const r = parseFeedQuery(new URLSearchParams(s));
  if (!r.ok) throw new Error(r.error);
  return r.query;
};

describe("data feed plan scoping (owner 2026-10-06)", () => {
  test("Pro (no state limit) passes the query through", () => {
    expect(applyPlanStates(q("state=TX"), null)).toEqual({ ok: true, query: q("state=TX") });
    expect(applyPlanStates(q(""), null)).toEqual({ ok: true, query: q("") });
  });

  test("Starter with no state asked gets its plan states", () => {
    const r = applyPlanStates(q(""), ["VA", "NC"]);
    expect(r.ok && r.query.states).toEqual(["VA", "NC"]);
  });

  test("Starter can narrow inside its plan but not reach outside it", () => {
    const inside = applyPlanStates(q("state=va"), ["VA", "NC"]);
    expect(inside.ok && inside.query.states).toEqual(["VA"]);
    const outside = applyPlanStates(q("state=VA,TX"), ["VA", "NC"]);
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.error).toContain("TX");
  });
});

describe("OpenAPI matches the feed", () => {
  test("Bid schema lists exactly the toFeedRow fields", () => {
    const row = toFeedRow({ id: 1, title: "t", agency: "a", source: "s" });
    expect(Object.keys(DATA_FEED_OPENAPI.components.schemas.Bid.properties).sort()).toEqual(Object.keys(row).sort());
  });

  test("documented parameters are the ones parseFeedQuery reads", () => {
    const names = DATA_FEED_OPENAPI.paths["/api/v1/feed"].get.parameters.map((p) => p.name).sort();
    expect(names).toEqual(["after", "limit", "naics", "set_aside", "state", "updated_since"]);
  });
});

describe("checkout plan validation", async () => {
  const { validatePlanStates, DATA_FEED_PLANS } = await import("./data-feed-billing.server");

  test("prices are the published ones", () => {
    expect(DATA_FEED_PLANS.starter.cents).toBe(29900);
    expect(DATA_FEED_PLANS.pro.cents).toBe(79900);
  });

  test("Starter needs 1–5 real states; Pro takes none", () => {
    expect(validatePlanStates("starter", "va, nc ,VA")).toEqual({ ok: true, states: ["VA", "NC"] });
    expect(validatePlanStates("starter", "").ok).toBe(false);
    expect(validatePlanStates("starter", "VA,NC,MD,DE,PA,NJ").ok).toBe(false);
    expect(validatePlanStates("starter", "ZZ").ok).toBe(false);
    expect(validatePlanStates("starter", 5).ok).toBe(false);
    expect(validatePlanStates("pro", "VA")).toEqual({ ok: true, states: [] });
  });
});

describe("Stripe webhook events check", async () => {
  const { missingWebhookEvents, DATA_FEED_WEBHOOK_EVENTS } = await import("./data-feed-billing.server");

  test("lists only what's missing; '*' covers everything", () => {
    expect(missingWebhookEvents(["*"])).toEqual([]);
    expect(missingWebhookEvents([...DATA_FEED_WEBHOOK_EVENTS])).toEqual([]);
    expect(missingWebhookEvents(["checkout.session.completed", "invoice.paid", "charge.refunded"])).toEqual([
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.payment_failed",
    ]);
  });

  test("every event the feed asks for is one handleDataFeedEvent handles", async () => {
    const src = await Bun.file(new URL("./data-feed-billing.server.ts", import.meta.url)).text();
    const handled = src.slice(src.indexOf("const supported = ["), src.indexOf("if (!supported.includes"));
    for (const e of DATA_FEED_WEBHOOK_EVENTS) expect(handled).toContain(`"${e}"`);
  });
});

describe("RapidAPI proxy secret", async () => {
  const { isRapidApiRequest } = await import("./data-feed.server");
  const h = (v?: string) => new Headers(v === undefined ? {} : { "X-RapidAPI-Proxy-Secret": v });

  test("only the exact configured secret is accepted", () => {
    expect(isRapidApiRequest(h("s3cret"), "s3cret")).toBe(true);
    expect(isRapidApiRequest(h("s3cret-x"), "s3cret")).toBe(false);
    expect(isRapidApiRequest(h(""), "s3cret")).toBe(false);
    expect(isRapidApiRequest(h(), "s3cret")).toBe(false);
  });

  test("off when the env var is unset, whatever is sent", () => {
    expect(isRapidApiRequest(h("anything"), undefined)).toBe(false);
    expect(isRapidApiRequest(h(""), "")).toBe(false);
  });
});
