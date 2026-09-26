/**
 * FUNNEL UX — the post-signup → Radar first-run path (owner rework 2026-09-26, PR-A).
 *
 * This module owns the PURE decisions of the funnel-UX half so both the signup
 * surfaces and /radar read ONE implementation, and so the rules are unit-testable
 * without a router, a DOM, a database or a network:
 *
 *   A. POST-SIGNUP → RADAR.  `resolvePostSignupDestination` is the single landing
 *      rule for the email/password signup flow; `resolveGoogleCallbackDestination`
 *      is the Google callback's mirror of the same default.
 *   B. FIRST-SEARCH GUIDANCE copy (rendered by /radar).
 *   C. BEST-MATCH badge copy.
 *   D/E. The post-save tracking prompt + the funnel event names.
 *
 * WHAT IS DELIBERATELY UNCHANGED (owner: "items 7–8 are a SEPARATE later PR"):
 * nothing here gates, prices or entitles anything. The anonymous Radar gates, the
 * AI-brief allowance ledger, the save-limit paywall and every entitlement check
 * stay exactly where they are.
 *
 * EVENT NAMING: every name below is registered in `EVENT_LABELS`
 * (src/lib/tracking-intake.ts) as a STANDALONE display label — none of them is a
 * member of any funnel-stage set (the frozen 9-stage admin map, the radar
 * conversion funnel, the radar leads funnel, the autopsy funnel, the activation
 * list). Viewing first-run guidance can therefore never synthesize a
 * signup/activation/paid stage. `src/lib/funnel-ux.test.ts` proves it.
 */

/** The Radar search criteria a handoff can carry (all optional/validated upstream). */
export interface RadarCriteria {
  trade?: string | null;
  state?: string | null;
  cert?: string | null;
  size?: string | null;
}

/** `?first_run=1` — the "you just signed up, run your first search" marker. */
export const RADAR_FIRST_RUN_PARAM = "first_run";
/** The canonical post-signup Radar href (no criteria). */
export const RADAR_FIRST_RUN_PATH = "/radar";
/** /radar?first_run=1 — what the Google callback's new-user default lands on. */
export const RADAR_FIRST_RUN_HREF = `${RADAR_FIRST_RUN_PATH}?${RADAR_FIRST_RUN_PARAM}=1`;

/** True only for the exact `first_run=1` flag (anything else is ignored). */
export function isFirstRunSearch(
  search: Record<string, unknown> | URLSearchParams | undefined | null,
): boolean {
  if (!search) return false;
  if (search instanceof URLSearchParams) return search.get(RADAR_FIRST_RUN_PARAM) === "1";
  const raw = search[RADAR_FIRST_RUN_PARAM];
  if (typeof raw === "string") return raw === "1";
  if (Array.isArray(raw)) return String(raw[0] ?? "") === "1";
  return false;
}

/**
 * The `/radar` search params for a first-run landing (`first_run` + the
 * visitor's criteria) — the SAME object `navigate({ to: "/radar", search })`
 * receives on the client. Each field is trimmed + length-capped and EMPTY fields
 * are omitted (the caller validates the cert/size ids against their known sets
 * before calling — see /signup's resolveSignupRadarCriteria).
 */
export function radarFirstRunSearch(criteria: RadarCriteria = {}): Record<string, string> {
  const p = new URLSearchParams();
  p.set(RADAR_FIRST_RUN_PARAM, "1");
  const trade = (criteria.trade ?? "").trim();
  if (trade) p.set("trade", trade.slice(0, 120));
  const state = (criteria.state ?? "").trim().toUpperCase();
  if (state) p.set("state", state.slice(0, 2));
  const cert = (criteria.cert ?? "").trim();
  if (cert) p.set("cert", cert.slice(0, 24));
  const size = (criteria.size ?? "").trim();
  if (size) p.set("size", size.slice(0, 24));
  return Object.fromEntries(p.entries());
}

/**
 * Build the post-signup Radar href: `/radar?first_run=1&trade=…&cert=…&state=…&size=…`.
 * Encoded with URLSearchParams, so the result is always a same-site relative path
 * that `safeNext()` accepts (used for the `next` param of the radar signup CTAs).
 */
export function buildRadarFirstRunHref(criteria: RadarCriteria = {}): string {
  return `${RADAR_FIRST_RUN_PATH}?${new URLSearchParams(radarFirstRunSearch(criteria)).toString()}`;
}

/**
 * Per-field first-non-empty merge, in the order the sources are given. /signup's
 * directive order is: URL search params (an explicit deep link) > the verified
 * locked-results handoff cookie > the visitor's saved radar session.
 */
export function mergeRadarCriteria(...sources: (RadarCriteria | null | undefined)[]): RadarCriteria {
  const pick = (key: keyof RadarCriteria): string =>
    sources.map((s) => (s?.[key] ?? "").trim()).find((v) => v.length > 0) ?? "";
  return {
    trade: pick("trade"),
    state: pick("state"),
    cert: pick("cert"),
    size: pick("size"),
  };
}

// ── A. POST-SIGNUP DESTINATIONS ───────────────────────────────────────────────

/** The three radar-family signup sources (all share the same handoff/attribution). */
export const RADAR_FAMILY_SOURCES: readonly string[] = [
  "radar",
  "radar_results_unlock",
  "radar_results_cta",
];

export function isRadarFamilySource(source: unknown): boolean {
  return typeof source === "string" && RADAR_FAMILY_SOURCES.includes(source);
}

export type PostSignupDestination =
  /** save_bid intent: save the bid, then land per today (unchanged). */
  | { kind: "save_then_next"; href: string }
  /** source=autopsy: the gifted first autopsy (unchanged). */
  | { kind: "autopsy" }
  /** an explicit `next` on a non-radar source: onboarding, which routes onward (unchanged). */
  | { kind: "onboarding" }
  /** THE NEW DEFAULT: straight to Radar with the visitor's criteria pre-filled. */
  | { kind: "radar"; href: string; search: Record<string, string> };

/**
 * The ONE post-signup landing rule (owner rework 2026-09-26, item 1).
 *
 *  1. `save_bid` present            → save, then `next` ?? /dashboard   (UNCHANGED)
 *  2. `source === "autopsy"`        → /autopsy                          (UNCHANGED)
 *  3. radar-family source           → /radar?first_run=1 + criteria     (NEW — was /dashboard)
 *  4. any other explicit `next`     → /onboarding (next is latched by
 *     `storeRememberedNext` and honored on completion)                 (UNCHANGED)
 *  5. no intent at all              → /radar?first_run=1 + criteria     (NEW — was /onboarding)
 *
 * A radar-family signup ALWAYS wins over an explicit `next`: `radarSignupHref`
 * now sets `next` to this very Radar href, and honoring `/dashboard?brief=1`
 * there was the old (now retired) "run my first Executive Brief" post-signup card.
 */
export function resolvePostSignupDestination(
  intent: { saveBid?: string | null; next?: string | null; source?: string | null },
  criteria: RadarCriteria,
  safeNext: (value: unknown) => string | null,
): PostSignupDestination {
  const saveBid = (intent.saveBid ?? "").trim();
  if (/^\d{1,10}$/.test(saveBid)) {
    return { kind: "save_then_next", href: safeNext(intent.next) ?? "/dashboard" };
  }
  if (intent.source === "autopsy") return { kind: "autopsy" };
  const radar = (): PostSignupDestination => ({
    kind: "radar",
    href: buildRadarFirstRunHref(criteria),
    search: radarFirstRunSearch(criteria),
  });
  if (isRadarFamilySource(intent.source)) return radar();
  if (safeNext(intent.next)) return { kind: "onboarding" };
  return radar();
}

/**
 * The Google OAuth callback's single-destination rule — the SAME new default,
 * mirrored (owner rework 2026-09-26, item 1).
 *
 *   save_bid present        → `next` ?? /dashboard                      (UNCHANGED)
 *   new user, NO `next`     → /radar?first_run=1                        (NEW — was /onboarding)
 *   new user WITH `next`    → /onboarding                               (UNCHANGED)
 *   returning user          → `next` ?? /dashboard                      (UNCHANGED)
 *
 * The callback carries no radar criteria through OAuth `state`, and it does not
 * need to: /radar restores the visitor's saved answers / seen matches
 * (localStorage) itself, so `first_run` alone lands them on a pre-filled form.
 */
export function resolveGoogleCallbackDestination(
  input: { isNewUser: boolean; saveBid: number | null; next: string | null },
  safeNext: (value: unknown) => string | null,
): string {
  if (input.saveBid !== null) return safeNext(input.next) ?? "/dashboard";
  if (input.isNewUser) return input.next ? "/onboarding" : RADAR_FIRST_RUN_HREF;
  return safeNext(input.next) ?? "/dashboard";
}

// ── B. FIRST-SEARCH GUIDANCE COPY (owner-verbatim intent) ─────────────────────

/** Exactly ONE clear sentence (item 2). */
export const FIRST_RUN_SENTENCE =
  "Run your first real search to see the live set-aside opportunities your business qualifies for.";
/** The four inputs the scan form asks for, listed in form order. */
export const FIRST_RUN_INPUTS: readonly string[] = [
  "Trade or NAICS code",
  "State",
  "Certification",
  "Preferred contract size",
];
/** The honesty/price note: discovery stays free (owner item 6). */
export const FIRST_RUN_FREE_NOTE = "Search is always free — no card required.";
/** Eyebrow of the guidance banner. */
export const FIRST_RUN_EYEBROW = "Your first search";

// ── C/D/E. BEST-MATCH + SAVE CTA + POST-SAVE PROMPT COPY ──────────────────────

/** Item 3 — the badge on the single top-ranked card. */
export const BEST_MATCH_BADGE = "✦ Best match";
/** Item 4 — the primary CTA label on a signed-in Radar card. */
export const SAVE_OPPORTUNITY_LABEL = "Save Opportunity";
/** Item 5 — OWNER-VERBATIM. Do not embellish, do not reword. */
export const SAVE_TRACKING_PROMPT = "We'll track this opportunity for you.";

/**
 * The ONE label resolver for the existing ⭐ save button, so the two new flags
 * (`label`, `onSaved`) change NOTHING for the surfaces that do not pass them:
 *   no label            → "Save to My Pipeline" (or "Save" when compact)
 *   label, not compact  → the label verbatim
 *   label + compact     → the label verbatim (the Radar card's "Save Opportunity")
 */
export function resolveSaveButtonLabel(opts: {
  compact?: boolean;
  label?: string | null;
}): string {
  const explicit = (opts.label ?? "").trim();
  if (explicit) return explicit;
  return opts.compact ? "Save" : "Save to My Pipeline";
}

// ── F. FUNNEL EVENTS (registered in EVENT_LABELS; no funnel-stage membership) ──

export const FUNNEL_UX_EVENTS = {
  /** /signup (or the Google callback) routed the new account to Radar. */
  signupLandedRadar: "signup_landed_radar",
  /** The first-run guidance banner rendered above the scan form. */
  radarFirstRunShown: "radar_first_run_shown",
  /** The first scan a signed-up user ran after landing on Radar. */
  radarFirstSearchStarted: "radar_first_search_started",
  /** The top-ranked match card got its "Best match" treatment. */
  radarBestMatchHighlighted: "radar_best_match_highlighted",
  /** The owner-verbatim "We'll track this opportunity for you." prompt appeared. */
  saveOpportunityPromptShown: "save_opportunity_prompt_shown",
} as const;

export const FUNNEL_UX_EVENT_NAMES: readonly string[] = Object.values(FUNNEL_UX_EVENTS);
