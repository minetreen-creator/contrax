import { afterEach, describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import {
  PORTAL_CONFIGURATION,
  SITE_WEBHOOK_EVENTS,
  fixStripeSetup,
  keyMode,
  missingSiteWebhookEvents,
  portalSessionParams,
  stripeSetupStatus,
} from "./stripe-setup.server";

/** A fake Stripe client: webhook endpoints and portal configurations in memory. */
function fakeStripe(opts: { endpoints?: { id: string; url: string; status?: string; enabled_events: string[] }[]; configs?: { id: string; is_default: boolean }[] }) {
  const endpoints = (opts.endpoints ?? []).map((e) => ({ status: "enabled", ...e }));
  const configs = [...(opts.configs ?? [])];
  const calls = { updated: [] as { id: string; enabled_events: string[] }[], created: [] as unknown[] };
  const stripe = {
    webhookEndpoints: {
      list: async () => ({ data: endpoints }),
      update: async (id: string, p: { enabled_events: string[] }) => {
        calls.updated.push({ id, enabled_events: p.enabled_events });
        endpoints.find((e) => e.id === id)!.enabled_events = p.enabled_events;
        return {};
      },
    },
    billingPortal: {
      configurations: {
        list: async () => ({ data: configs }),
        create: async (p: unknown) => {
          calls.created.push(p);
          configs.push({ id: `bpc_${configs.length + 1}`, is_default: false });
          return configs.at(-1);
        },
      },
    },
  } as unknown as Stripe;
  return { stripe, calls };
}

const SITE = "https://www.contrax.company/api/stripe/webhook";
const env = { key: process.env.STRIPE_SECRET_KEY, secret: process.env.STRIPE_WEBHOOK_SECRET };
afterEach(() => {
  process.env.STRIPE_SECRET_KEY = env.key;
  process.env.STRIPE_WEBHOOK_SECRET = env.secret;
});

describe("Stripe setup (owner 2026-10-22)", () => {
  test("key mode is read from the key's prefix, never its value", () => {
    expect(keyMode("sk_live_abc")).toBe("live");
    expect(keyMode("rk_live_abc")).toBe("live");
    expect(keyMode("sk_test_abc")).toBe("test");
    expect(keyMode(undefined)).toBe("missing");
    expect(keyMode("")).toBe("missing");
  });

  test("the plan flows need the checkout, subscription and invoice events", () => {
    expect(SITE_WEBHOOK_EVENTS).toContain("checkout.session.completed");
    expect(SITE_WEBHOOK_EVENTS).toContain("checkout.session.async_payment_succeeded");
    expect(missingSiteWebhookEvents(["*"])).toEqual([]);
    expect(missingSiteWebhookEvents(["checkout.session.completed"])).not.toContain("checkout.session.completed");
  });

  test("status reports only this site's endpoints, the secrets and the portal", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_x";
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { stripe } = fakeStripe({
      endpoints: [
        { id: "we_1", url: SITE, enabled_events: ["checkout.session.completed"] },
        { id: "we_2", url: "https://other.example/hook", enabled_events: [] },
      ],
    });
    const s = await stripeSetupStatus(stripe);
    expect(s.keyMode).toBe("live");
    expect(s.webhookSecretSet).toBe(false);
    expect(s.endpoints.map((e) => e.id)).toEqual(["we_1"]);
    expect(s.endpoints[0]!.missing.length).toBe(SITE_WEBHOOK_EVENTS.length - 1);
    expect(s.portal).toEqual({ ready: false, isDefault: false, configurationId: null });
  });

  test("fix adds only the missing events (keeping the rest) and creates a portal once", async () => {
    const { stripe, calls } = fakeStripe({
      endpoints: [
        { id: "we_1", url: SITE, enabled_events: ["checkout.session.completed", "charge.refunded"] },
        { id: "we_2", url: "https://other.example/hook", enabled_events: [] },
      ],
    });
    const s = await fixStripeSetup(stripe);
    expect(calls.updated.map((u) => u.id)).toEqual(["we_1"]);
    expect(calls.updated[0]!.enabled_events).toContain("charge.refunded");
    for (const e of SITE_WEBHOOK_EVENTS) expect(calls.updated[0]!.enabled_events).toContain(e);
    expect(calls.created).toEqual([PORTAL_CONFIGURATION]);
    expect(s.endpoints[0]!.missing).toEqual([]);
    expect(s.portal.ready).toBe(true);
    // A second click changes nothing.
    await fixStripeSetup(stripe);
    expect(calls.updated.length).toBe(1);
    expect(calls.created.length).toBe(1);
  });

  test("fix never creates a webhook endpoint (its new secret would need copying by hand)", async () => {
    const { stripe, calls } = fakeStripe({ configs: [{ id: "bpc_d", is_default: true }] });
    const s = await fixStripeSetup(stripe);
    expect(s.endpoints).toEqual([]);
    expect(calls.updated).toEqual([]);
    expect(calls.created).toEqual([]);
  });

  test("portal sessions name the API-created configuration only when there is no default", async () => {
    expect(await portalSessionParams(fakeStripe({ configs: [{ id: "bpc_d", is_default: true }] }).stripe)).toEqual({});
    expect(await portalSessionParams(fakeStripe({ configs: [{ id: "bpc_1", is_default: false }] }).stripe)).toEqual({ configuration: "bpc_1" });
    expect(await portalSessionParams(fakeStripe({}).stripe)).toEqual({});
    // A client that cannot list configurations leaves the session call unchanged.
    expect(await portalSessionParams({} as Stripe)).toEqual({});
  });
});
