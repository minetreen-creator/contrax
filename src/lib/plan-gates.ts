/**
 * PLAN GATES — the ratified gating map (owner decisions, 2026-09-26).
 *
 *   Radar Pro  ($79/mo = the `professional` ladder tier)  →  AI Executive Brief,
 *                                                            bid scoring,
 *                                                            incumbent intelligence
 *   Bid Scout  ($99/mo = its own recurring product)       →  proposal drafting,
 *                                                            pipeline CSV export
 *
 * TWO HARD RULES this module encodes:
 *
 *  1. ATTEMPT-ONLY PROMPTS (owner rule 8). An upgrade prompt fires ONLY when the
 *     user ATTEMPTS a gated paid action — never on page view. `ATTEMPT_EVENT_*`
 *     below pairs each gated action with the standalone funnel event that is
 *     fired at the moment its prompt is shown.
 *  2. CLAIM STANDARD. Every string in here states ONLY what the real entitlement
 *     config says: the $79 Radar Pro tier (`EXPECTED_UNIT_AMOUNTS.professional`
 *     = 7900 in src/lib/stripe.ts) and the $99 Bid Scout price
 *     (`BID_SCOUT_PRICE_USD` = 9900 in src/lib/bid-scout.ts). NEVER "unlimited"
 *     for a free/Basic/Starter plan, and never a price the config does not have.
 *
 * CLIENT-SAFE BY CONSTRUCTION: this file is imported by route components, so it
 * must never import a server module (~/db, ~/lib/trial, Stripe). The
 * entitlement READERS live in src/lib/plan-gates.server.ts.
 *
 * Standalone events only: the names below are display labels in
 * EVENT_LABELS (src/lib/tracking-intake.ts) and are members of NO funnel-stage
 * set — a gated attempt can never synthesize a signup/activation/paid stage.
 */

/** The two paid products that gate the funnel (owner 2026-09-26). */
export type PlanGate = "radar_pro" | "bid_scout";

/** The ladder tier behind Radar Pro: `professional` ($79/mo). */
export const RADAR_PRO_TIER = "professional";
export const RADAR_PRO_PLAN_LABEL = "Radar Pro";
/** Mirrors EXPECTED_UNIT_AMOUNTS.professional (7900) in src/lib/stripe.ts. */
export const RADAR_PRO_PRICE_USD = 79;
export const RADAR_PRO_PRICE_NOTE =
  "$79/mo · 14-day Professional trial · Cancel anytime";
/** Where the Radar Pro CTA goes (existing upgrade surface — untouched). */
export const RADAR_PRO_HREF = "/upgrade";

/** Bid Scout — its own recurring product, NOT a ladder tier. */
export const BID_SCOUT_PRODUCT_LABEL = "Bid Scout";
/** Mirrors BID_SCOUT_PRICE_USD (9_900) in src/lib/bid-scout.ts. */
export const BID_SCOUT_PRICE_USD_MONTHLY = 99;
export const BID_SCOUT_PRICE_NOTE = "$99/mo · Cancel anytime";
/** The ONE purchase path that exists for Bid Scout (intake form → checkout). */
export const BID_SCOUT_HREF = "/bid-scout";

/** Every gated action, keyed to the product that owns it. */
export type GateAction = "ai_brief" | "score" | "incumbent" | "draft" | "export";

export const GATE_FOR_ACTION: Record<GateAction, PlanGate> = {
  ai_brief: "radar_pro",
  score: "radar_pro",
  incumbent: "radar_pro",
  draft: "bid_scout",
  export: "bid_scout",
};

/**
 * The standalone funnel event fired at the moment each gate prompt is shown
 * (i.e. at the attempt boundary). Label is always `GATE_ATTEMPT_LABEL`.
 */
export const ATTEMPT_EVENT_FOR_ACTION: Record<GateAction, string> = {
  ai_brief: "ai_brief_attempted",
  score: "score_attempted",
  incumbent: "incumbent_attempted",
  draft: "draft_attempted",
  export: "export_attempted",
};

/** The label value every gated-attempt event carries. */
export const GATE_ATTEMPT_LABEL = "gated";

/** Every standalone event name this map introduces (for registration/tests). */
export const GATE_ATTEMPT_EVENTS: readonly string[] = [
  "ai_brief_attempted",
  "score_attempted",
  "incumbent_attempted",
  "draft_attempted",
  "export_attempted",
];

/** Prompt copy per gate — the house gate UI (PremiumUpgradeModal) renders these. */
export interface GatePrompt {
  title: string;
  body: string;
  ctaLabel: string;
  priceNote: string;
  /** Radar Pro → the existing /upgrade surface; Bid Scout → its buy page. */
  href: string;
  /** True when the CTA is a Stripe Checkout redirect handled by the modal. */
  checkout: boolean;
  checkoutPlan: "starter" | "professional" | "agency";
}

export const GATE_PROMPTS: Record<PlanGate, GatePrompt> = {
  radar_pro: {
    title: "Radar Pro feature",
    body:
      "AI Executive Briefs and bid scoring are Radar Pro features on the Professional plan. Upgrade to unlock them for every opportunity you're tracking.",
    ctaLabel: "Upgrade to Radar Pro →",
    priceNote: RADAR_PRO_PRICE_NOTE,
    href: RADAR_PRO_HREF,
    checkout: true,
    checkoutPlan: "professional",
  },
  bid_scout: {
    title: "Bid Scout feature",
    body:
      "Proposal drafting and pipeline CSV export are part of Bid Scout, our $99/month contract-winning service.",
    ctaLabel: "See Bid Scout →",
    priceNote: BID_SCOUT_PRICE_NOTE,
    href: BID_SCOUT_HREF,
    checkout: false,
    checkoutPlan: "professional",
  },
};

/** The prompt for a gate (never a view trigger — callers open it on attempt). */
export function gatePrompt(gate: PlanGate): GatePrompt {
  return GATE_PROMPTS[gate];
}

/** Prompt for the gate that owns an action. */
export function promptForAction(action: GateAction): GatePrompt {
  return gatePrompt(GATE_FOR_ACTION[action]);
}

/**
 * Sentinel error text a gated server function / API returns when the caller
 * ATTEMPTED a gated action without entitlement. The client matches it exactly
 * to open the prompt (same pattern as FREE_LIMIT_REACHED_MESSAGE).
 */
export function gateErrorCode(action: GateAction): string {
  return `GATE_REQUIRED:${GATE_FOR_ACTION[action]}`;
}

/** True when an error message is a gate sentinel (optionally for one action). */
export function isGateError(message: unknown, action?: GateAction): boolean {
  if (typeof message !== "string") return false;
  const code = action ? gateErrorCode(action) : null;
  if (code) return message === code;
  return message.startsWith("GATE_REQUIRED:");
}

/** The gate named by a sentinel message, or null. */
export function gateFromError(message: unknown): PlanGate | null {
  if (typeof message !== "string" || !message.startsWith("GATE_REQUIRED:")) return null;
  const gate = message.slice("GATE_REQUIRED:".length);
  return gate === "radar_pro" || gate === "bid_scout" ? gate : null;
}

/**
 * The JSON body a gated read endpoint returns for an attempted paid action.
 * `locked` is the flag the existing brief surface already understands, so the
 * attempt renders the gate (prompt) instead of the paid result. Nothing is
 * fabricated: only the honest raw description / preview and the real price
 * note for the owning product.
 */
export interface GateLockedPayload {
  locked: true;
  gate: GateAction;
  upgrade_required: PlanGate;
  preview: string;
  price: { plan: PlanGate; amountUsd: number; note: string };
}

export function gateLockedPayload(
  action: GateAction,
  preview?: string,
): GateLockedPayload {
  const gate = GATE_FOR_ACTION[action];
  const prompt = gatePrompt(gate);
  return {
    locked: true,
    gate: action,
    upgrade_required: gate,
    preview: preview ?? prompt.body,
    price: {
      plan: gate,
      amountUsd: gate === "radar_pro" ? RADAR_PRO_PRICE_USD : BID_SCOUT_PRICE_USD_MONTHLY,
      note: prompt.priceNote,
    },
  };
}

/** True when a response body is the gate payload above (client type guard). */
export function isGateLockedPayload(body: unknown): body is GateLockedPayload {
  if (!body || typeof body !== "object") return false;
  const b = body as { locked?: unknown; upgrade_required?: unknown };
  return (
    b.locked === true &&
    (b.upgrade_required === "radar_pro" || b.upgrade_required === "bid_scout")
  );
}
