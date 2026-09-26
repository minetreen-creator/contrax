/**
 * PLAN GATES — the ratified gating map (owner decisions, 2026-09-26).
 *
 * This suite pins the two halves of src/lib/plan-gates{,.server}.ts:
 *
 *   1. THE CLIENT-SAFE MAP AND ITS COPY (plan-gates.ts). Every string is
 *      asserted VERBATIM because it is the honest offer shown at the attempt:
 *      the $79 Radar Pro tier (the `professional` ladder tier) and the $99 Bid
 *      Scout product. The mirrored prices are checked against the real
 *      entitlement config files (stripe.ts's EXPECTED_UNIT_AMOUNTS.professional
 *      and bid-scout.ts's BID_SCOUT_PRICE_USD) by reading them, so a copy/price
 *      drift is a test failure rather than a customer-facing lie.
 *
 *   2. THE SERVER PREDICATES (plan-gates.server.ts). Radar Pro is EXACTLY
 *      `hasProfessionalAccess` (the house Pro predicate in src/lib/trial.ts),
 *      Bid Scout is an `active` bid_scout_subscriptions row plus the same
 *      internal bypasses, and both FAIL CLOSED — an unreadable entitlement is
 *      NOT entitled.
 *
 * DETERMINISTIC, ZERO NETWORK, ZERO DATABASE: every predicate is driven through
 * the module's injectable stores with literal state, and the throw cases use
 * stores that throw. Nothing here reads the live `bids`/`users` tables, and
 * nothing uses `mock.module` (bun's mock registry is process-global and leaks
 * across test files in one run).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ATTEMPT_EVENT_FOR_ACTION,
  BID_SCOUT_HREF,
  BID_SCOUT_PRICE_NOTE,
  BID_SCOUT_PRICE_USD_MONTHLY,
  BID_SCOUT_PRODUCT_LABEL,
  GATE_ATTEMPT_EVENTS,
  GATE_ATTEMPT_LABEL,
  GATE_FOR_ACTION,
  GATE_PROMPTS,
  RADAR_PRO_HREF,
  RADAR_PRO_PLAN_LABEL,
  RADAR_PRO_PRICE_NOTE,
  RADAR_PRO_PRICE_USD,
  RADAR_PRO_TIER,
  gateErrorCode,
  gateFromError,
  gateLockedPayload,
  gatePrompt,
  isGateError,
  isGateLockedPayload,
  promptForAction,
  type GateAction,
} from "./plan-gates";
import {
  hasBidScoutAccess,
  hasRadarProAccess,
  loadGateEntitlements,
  type GateStores,
} from "./plan-gates.server";
import { hasProfessionalAccess, type TrialStatus } from "./trial";

const SRC = join(import.meta.dir, "..");
const ALL_ACTIONS: GateAction[] = ["ai_brief", "score", "incumbent", "draft", "export"];

// ── literal trial/tier state (the exact shape loadUserTrialStatus returns) ────

function trial(over: Partial<TrialStatus> = {}): TrialStatus {
  return {
    active: false,
    daysLeft: 0,
    expired: false,
    endsAt: null,
    planTier: "basic",
    fullAccess: false,
    ...over,
  };
}

/** A store that answers with one literal trial state. */
const trialStore = (status: TrialStatus | null) => ({
  async load(): Promise<TrialStatus> {
    return status as TrialStatus;
  },
});

/** A subscription store that answers with one literal boolean. */
const subStore = (active: boolean) => ({
  async hasActiveSubscription(): Promise<boolean> {
    return active;
  },
});

/** Nothing is queryable — the fail-closed probe. */
const unreadableTrialStore = {
  async load(): Promise<TrialStatus> {
    throw new Error("DATABASE_URL is not set — connect a database before running queries.");
  },
};
const unreadableSubStore = {
  async hasActiveSubscription(): Promise<boolean> {
    throw new Error("relation \"bid_scout_subscriptions\" does not exist");
  },
};
const stores = (over: Partial<GateStores>): Partial<GateStores> => over;

// ── 1. the map: which product owns which gated action ────────────────────────

describe("plan gates: the gating map (owner 2026-09-26)", () => {
  test("Radar Pro is the $79 `professional` ladder tier", () => {
    expect(RADAR_PRO_TIER).toBe("professional");
    expect(RADAR_PRO_PLAN_LABEL).toBe("Radar Pro");
    expect(RADAR_PRO_PRICE_USD).toBe(79);
    expect(RADAR_PRO_PRICE_NOTE).toBe("$79/mo · 14-day Professional trial · Cancel anytime");
    // The CTA reuses the EXISTING upgrade surface (no new door invented).
    expect(RADAR_PRO_HREF).toBe("/upgrade");
  });

  test("Bid Scout is its OWN $99/mo product, not a ladder tier", () => {
    expect(BID_SCOUT_PRODUCT_LABEL).toBe("Bid Scout");
    expect(BID_SCOUT_PRICE_USD_MONTHLY).toBe(99);
    expect(BID_SCOUT_PRICE_NOTE).toBe("$99/mo · Cancel anytime");
    // The ONE purchase path that exists: the intake page.
    expect(BID_SCOUT_HREF).toBe("/bid-scout");
  });

  test("the mirrored prices still match the real entitlement config", () => {
    // Radar Pro mirrors EXPECTED_UNIT_AMOUNTS.professional (cents) in stripe.ts.
    const stripeSrc = readFileSync(join(SRC, "lib", "stripe.ts"), "utf8");
    const professional = stripeSrc.match(/professional:\s*([\d_]+)/);
    expect(professional).not.toBeNull();
    expect(Number(professional![1].replace(/_/g, ""))).toBe(RADAR_PRO_PRICE_USD * 100);

    // Bid Scout mirrors BID_SCOUT_PRICE_USD (cents) in bid-scout.ts.
    const scoutSrc = readFileSync(join(SRC, "lib", "bid-scout.ts"), "utf8");
    const scout = scoutSrc.match(/BID_SCOUT_PRICE_USD\s*=\s*([\d_]+)/);
    expect(scout).not.toBeNull();
    expect(Number(scout![1].replace(/_/g, ""))).toBe(BID_SCOUT_PRICE_USD_MONTHLY * 100);
  });

  test("every gated action belongs to exactly one product", () => {
    expect(Object.keys(GATE_FOR_ACTION).sort()).toEqual([...ALL_ACTIONS].sort());
    expect(GATE_FOR_ACTION.ai_brief).toBe("radar_pro");
    expect(GATE_FOR_ACTION.score).toBe("radar_pro");
    expect(GATE_FOR_ACTION.incumbent).toBe("radar_pro");
    expect(GATE_FOR_ACTION.draft).toBe("bid_scout");
    expect(GATE_FOR_ACTION.export).toBe("bid_scout");
  });

  test("the attempt-event names are the five standalone names, one per action", () => {
    expect(ATTEMPT_EVENT_FOR_ACTION.ai_brief).toBe("ai_brief_attempted");
    expect(ATTEMPT_EVENT_FOR_ACTION.score).toBe("score_attempted");
    expect(ATTEMPT_EVENT_FOR_ACTION.incumbent).toBe("incumbent_attempted");
    expect(ATTEMPT_EVENT_FOR_ACTION.draft).toBe("draft_attempted");
    expect(ATTEMPT_EVENT_FOR_ACTION.export).toBe("export_attempted");
    expect(GATE_ATTEMPT_EVENTS).toEqual([
      "ai_brief_attempted",
      "score_attempted",
      "incumbent_attempted",
      "draft_attempted",
      "export_attempted",
    ]);
    expect(new Set(GATE_ATTEMPT_EVENTS).size).toBe(5);
    // …and the map and the exported list can never drift apart.
    expect(ALL_ACTIONS.map((a) => ATTEMPT_EVENT_FOR_ACTION[a])).toEqual([...GATE_ATTEMPT_EVENTS]);
    // Every name is a domain_action snake_case label and carries the gate label
    // at fire time (the label is what makes a row an ATTEMPT, never a stage).
    for (const name of GATE_ATTEMPT_EVENTS) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
    expect(GATE_ATTEMPT_LABEL).toBe("gated");
  });
});

// ── 2. the prompt copy (owner-locked wording) ────────────────────────────────

describe("plan gates: the attempt prompt copy", () => {
  test("the Radar Pro prompt is the exact string", () => {
    expect(GATE_PROMPTS.radar_pro).toEqual({
      title: "Radar Pro feature",
      body:
        "AI Executive Briefs and bid scoring are Radar Pro features on the Professional plan. Upgrade to unlock them for every opportunity you're tracking.",
      ctaLabel: "Upgrade to Radar Pro →",
      priceNote: "$79/mo · 14-day Professional trial · Cancel anytime",
      href: "/upgrade",
      checkout: true,
      checkoutPlan: "professional",
    });
  });

  test("the Bid Scout prompt is the exact string and links to the intake page", () => {
    expect(GATE_PROMPTS.bid_scout).toEqual({
      title: "Bid Scout feature",
      body:
        "Proposal drafting and pipeline CSV export are part of Bid Scout, our $99/month contract-winning service.",
      ctaLabel: "See Bid Scout →",
      priceNote: "$99/mo · Cancel anytime",
      href: "/bid-scout",
      checkout: false,
      checkoutPlan: "professional",
    });
  });

  test("no prompt promises anything the entitlement config does not have", () => {
    for (const gate of ["radar_pro", "bid_scout"] as const) {
      const p = gatePrompt(gate);
      const text = `${p.title} ${p.body} ${p.ctaLabel} ${p.priceNote}`;
      // Claim standard: never "unlimited" for a plan that does not have it, and
      // never a price the config does not carry.
      expect(text.toLowerCase()).not.toContain("unlimited");
      // Every price mentioned is the product's real price (no invented figure).
      const prices = new Set(text.match(/\$[\d,]+/g) ?? []);
      expect([...prices]).toEqual([gate === "radar_pro" ? "$79" : "$99"]);
      expect(text).not.toContain("free forever");
    }
  });

  test("gatePrompt / promptForAction resolve to the same object (no copy forking)", () => {
    for (const action of ALL_ACTIONS) {
      expect(promptForAction(action)).toBe(gatePrompt(GATE_FOR_ACTION[action]));
    }
  });
});

// ── 3. the sentinel + locked payload contract ────────────────────────────────

describe("plan gates: the sentinel and the locked payload", () => {
  test("gateErrorCode names the owning product for each action", () => {
    expect(gateErrorCode("ai_brief")).toBe("GATE_REQUIRED:radar_pro");
    expect(gateErrorCode("score")).toBe("GATE_REQUIRED:radar_pro");
    expect(gateErrorCode("incumbent")).toBe("GATE_REQUIRED:radar_pro");
    expect(gateErrorCode("draft")).toBe("GATE_REQUIRED:bid_scout");
    expect(gateErrorCode("export")).toBe("GATE_REQUIRED:bid_scout");
  });

  test("isGateError matches the sentinel exactly, per action or for any gate", () => {
    for (const action of ALL_ACTIONS) {
      const code = gateErrorCode(action);
      expect(isGateError(code, action)).toBe(true);
      expect(isGateError(code)).toBe(true);
      // A different action's sentinel is NOT this action's gate.
      for (const other of ALL_ACTIONS.filter((a) => a !== action)) {
        if (GATE_FOR_ACTION[other] !== GATE_FOR_ACTION[action]) {
          expect(isGateError(gateErrorCode(other), action)).toBe(false);
        }
      }
    }
    // Near-misses and non-strings are never a gate.
    for (const bad of [undefined, null, 42, {}, "", "GATE_REQUIRED", "please GATE_REQUIRED:radar_pro"]) {
      expect(isGateError(bad)).toBe(false);
    }
    // A bare prefix is a gate "code" with no gate name — never a real gate.
    expect(isGateError("GATE_REQUIRED:")).toBe(true);
    expect(gateFromError("GATE_REQUIRED:")).toBeNull();
    expect(isGateError(gateErrorCode("score"), "draft")).toBe(false);
  });

  test("gateFromError names the gate, and only a real one", () => {
    expect(gateFromError(gateErrorCode("ai_brief"))).toBe("radar_pro");
    expect(gateFromError(gateErrorCode("draft"))).toBe("bid_scout");
    for (const bad of [undefined, null, 7, {}, "GATE_REQUIRED:", "GATE_REQUIRED:super_plan", "nope"]) {
      expect(gateFromError(bad)).toBeNull();
    }
  });

  test("the locked payload states the real price and the action's own gate", () => {
    for (const action of ALL_ACTIONS) {
      const gate = GATE_FOR_ACTION[action];
      const payload = gateLockedPayload(action);
      expect(payload.locked).toBe(true);
      expect(payload.gate).toBe(action);
      expect(payload.upgrade_required).toBe(gate);
      expect(payload.preview).toBe(gatePrompt(gate).body);
      expect(payload.price).toEqual({
        plan: gate,
        amountUsd: gate === "radar_pro" ? 79 : 99,
        note: gatePrompt(gate).priceNote,
      });
      expect(isGateLockedPayload(payload)).toBe(true);
    }
  });

  test("the preview may be the honest raw source text instead of the prompt body", () => {
    expect(gateLockedPayload("ai_brief", "roof replacement, 12 buildings").preview).toBe(
      "roof replacement, 12 buildings",
    );
  });

  test("isGateLockedPayload accepts only the real payload shape", () => {
    for (const bad of [
      undefined,
      null,
      "radar_pro",
      42,
      {},
      { locked: true },
      { locked: true, upgrade_required: "super_plan" },
      { locked: false, upgrade_required: "radar_pro" },
      { upgrade_required: "bid_scout" },
    ]) {
      expect(isGateLockedPayload(bad)).toBe(false);
    }
  });
});

// ── 4. the Radar Pro predicate (== the house Pro predicate) ───────────────────

describe("plan gates: hasProfessionalAccess is the Radar Pro predicate", () => {
  test("BYPASSES: admin, an active grant, and the internal demo tier", () => {
    expect(hasProfessionalAccess(trial({ planTier: "basic" }), { is_admin: true })).toBe(true);
    expect(hasProfessionalAccess(trial({ fullAccess: true }), {})).toBe(true);
    expect(hasProfessionalAccess(trial({ planTier: "demo" }), {})).toBe(true);
  });

  test("the ladder: professional/agency yes; basic/starter/null no", () => {
    expect(hasProfessionalAccess(trial({ planTier: "professional" }), {})).toBe(true);
    expect(hasProfessionalAccess(trial({ planTier: "agency" }), {})).toBe(true);
    expect(hasProfessionalAccess(trial({ planTier: "starter" }), {})).toBe(false);
    expect(hasProfessionalAccess(trial({ planTier: "basic" }), {})).toBe(false);
    expect(hasProfessionalAccess(trial({ planTier: null }), {})).toBe(false);
    expect(hasProfessionalAccess(null, {})).toBe(false);
    expect(hasProfessionalAccess(undefined, {})).toBe(false);
  });

  test("EXPIRED denies — an expired grant or lapsed demo never unlocks Pro", () => {
    expect(hasProfessionalAccess(trial({ planTier: "professional", expired: true }), {})).toBe(false);
    expect(hasProfessionalAccess(trial({ planTier: "agency", expired: true }), {})).toBe(false);
    expect(hasProfessionalAccess(trial({ planTier: "demo", expired: true }), {})).toBe(false);
    // fullAccess is already dropped by computeTrialStatus once a grant lapses,
    // but the predicate must not unlock even if it is passed as true.
    expect(hasProfessionalAccess(trial({ fullAccess: true, expired: true }), {})).toBe(true);
  });
});

describe("plan gates: hasRadarProAccess reads the stored state, fail-closed", () => {
  test("BYPASS: an admin is entitled before any lookup happens", async () => {
    // The store throws: if the bypass were evaluated after the lookup this
    // would be false.
    expect(await hasRadarProAccess(7, { is_admin: true }, stores({ trialStatus: unreadableTrialStore }))).toBe(true);
  });

  test("no identity = no entitlement", async () => {
    for (const id of [null, undefined]) {
      expect(await hasRadarProAccess(id, {}, stores({ trialStatus: trialStore(trial()) }))).toBe(false);
    }
  });

  test("a free Basic user is DENIED (this is the gate the funnel depends on)", async () => {
    expect(await hasRadarProAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "basic" })) }))).toBe(false);
    expect(await hasRadarProAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "starter" })) }))).toBe(false);
  });

  test("an active Professional/agency user and the grant/demo bypasses are ALLOWED", async () => {
    expect(await hasRadarProAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "professional" })) }))).toBe(true);
    expect(await hasRadarProAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "agency" })) }))).toBe(true);
    expect(await hasRadarProAccess(7, {}, stores({ trialStatus: trialStore(trial({ fullAccess: true })) }))).toBe(true);
    expect(await hasRadarProAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "demo" })) }))).toBe(true);
  });

  test("an EXPIRED professional/demo user is DENIED", async () => {
    expect(await hasRadarProAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "professional", expired: true })) }))).toBe(false);
    expect(await hasRadarProAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "demo", expired: true })) }))).toBe(false);
  });

  test("FAIL-CLOSED: a missing row, an unreadable store and an empty result all deny", async () => {
    expect(await hasRadarProAccess(7, {}, stores({ trialStatus: trialStore(null) }))).toBe(false);
    expect(await hasRadarProAccess(7, {}, stores({ trialStatus: unreadableTrialStore }))).toBe(false);
    // an id the store simply cannot answer for
    const emptyStore = { async load() { throw new Error("no rows"); } };
    expect(await hasRadarProAccess(7, {}, stores({ trialStatus: emptyStore }))).toBe(false);
  });

  test("the gate NEVER starts a trial: only the status read is consulted", () => {
    // Source-text proof: the gate module reads state and nothing else — it has
    // no reference to the lazy trial starter, so an attempted paid action can
    // never silently grant trial access (owner decision 1, hard Pro gate).
    const src = readFileSync(join(SRC, "lib", "plan-gates.server.ts"), "utf8");
    expect(src).not.toContain("ensureTrialStarted");
    expect(src).not.toContain("consumeTrial");
    expect(src).toContain("hasProfessionalAccess(await stores.trialStatus.load(userId), user)");
  });
});

// ── 5. the Bid Scout predicate (its own product + the same bypasses) ─────────

describe("plan gates: hasBidScoutAccess = an active subscription + the bypasses", () => {
  test("BYPASS: an admin is entitled before any lookup happens", async () => {
    expect(
      await hasBidScoutAccess(7, { is_admin: true }, stores({ trialStatus: unreadableTrialStore, bidScout: unreadableSubStore })),
    ).toBe(true);
  });

  test("no identity = no entitlement", async () => {
    for (const id of [null, undefined]) {
      expect(await hasBidScoutAccess(id, {}, stores({ trialStatus: trialStore(trial()), bidScout: subStore(true) }))).toBe(false);
    }
  });

  test("an ACTIVE bid_scout_subscriptions row entitles even on a free Basic tier", async () => {
    expect(await hasBidScoutAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "basic" })), bidScout: subStore(true) }))).toBe(true);
  });

  test("no active row = DENIED (nothing else is consulted as a fallback)", async () => {
    expect(await hasBidScoutAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "basic" })), bidScout: subStore(false) }))).toBe(false);
    // A stopped/cancelled subscription is not an active row.
    let asked: number | null = null;
    const cancelled = {
      async hasActiveSubscription(userId: number) {
        asked = userId;
        return false;
      },
    };
    expect(await hasBidScoutAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "starter" })), bidScout: cancelled }))).toBe(false);
    expect(asked).toBe(7);
  });

  test("the grant and (unexpired) demo bypasses unlock it WITHOUT touching the subscription table", async () => {
    // unreadableSubStore would throw → false; the bypass must win first.
    expect(
      await hasBidScoutAccess(7, {}, stores({ trialStatus: trialStore(trial({ fullAccess: true })), bidScout: unreadableSubStore })),
    ).toBe(true);
    expect(
      await hasBidScoutAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "demo" })), bidScout: unreadableSubStore })),
    ).toBe(true);
  });

  test("an EXPIRED demo is not a bypass — it falls through to the real subscription", async () => {
    expect(
      await hasBidScoutAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "demo", expired: true })), bidScout: subStore(false) })),
    ).toBe(false);
    expect(
      await hasBidScoutAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier: "demo", expired: true })), bidScout: subStore(true) })),
    ).toBe(true);
  });

  test("the ladder tier alone is NOT a Bid Scout entitlement (its own product)", async () => {
    // Same rule the shipped pricing copy states: proposal drafting and pipeline
    // CSV export are part of Bid Scout, not of the Professional plan.
    for (const planTier of ["starter", "professional", "agency"]) {
      expect(
        await hasBidScoutAccess(7, {}, stores({ trialStatus: trialStore(trial({ planTier })), bidScout: subStore(false) })),
      ).toBe(false);
    }
  });

  test("FAIL-CLOSED: a missing row, an unreadable store and a throwing lookup all deny", async () => {
    expect(await hasBidScoutAccess(7, {}, stores({ trialStatus: trialStore(null), bidScout: subStore(true) }))).toBe(false);
    expect(await hasBidScoutAccess(7, {}, stores({ trialStatus: unreadableTrialStore, bidScout: subStore(true) }))).toBe(false);
    expect(await hasBidScoutAccess(7, {}, stores({ trialStatus: trialStore(trial()), bidScout: unreadableSubStore }))).toBe(false);
  });
});

// ── 6. the combined read the client gate context uses ────────────────────────

describe("plan gates: loadGateEntitlements", () => {
  test("a logged-in free Basic user gets neither entitlement", async () => {
    expect(
      await loadGateEntitlements(7, { id: 7 }, {
        stores: { trialStatus: trialStore(trial({ planTier: "basic" })), bidScout: subStore(false) },
      }),
    ).toEqual({ radarPro: false, bidScout: false });
  });

  test("a Professional user gets Radar Pro but NOT Bid Scout", async () => {
    expect(
      await loadGateEntitlements(7, { id: 7 }, {
        stores: { trialStatus: trialStore(trial({ planTier: "professional" })), bidScout: subStore(false) },
      }),
    ).toEqual({ radarPro: true, bidScout: false });
  });

  test("a Bid Scout customer gets drafting + export even on Basic", async () => {
    expect(
      await loadGateEntitlements(7, { id: 7 }, {
        stores: { trialStatus: trialStore(trial({ planTier: "basic" })), bidScout: subStore(true) },
      }),
    ).toEqual({ radarPro: false, bidScout: true });
  });

  test("no identity (or an unreadable store) = both denied, fail-closed", async () => {
    expect(await loadGateEntitlements(null, null)).toEqual({ radarPro: false, bidScout: false });
    const denied = await loadGateEntitlements(null, undefined, { stores: {} });
    expect(denied).toEqual({ radarPro: false, bidScout: false });
    expect(
      await loadGateEntitlements(7, { id: 7 }, {
        stores: { trialStatus: unreadableTrialStore, bidScout: unreadableSubStore },
      }),
    ).toEqual({ radarPro: false, bidScout: false });
  });
});
