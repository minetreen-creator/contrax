/**
 * FUNNEL UX — post-signup → Radar first run (owner rework 2026-09-26, PR-A).
 *
 * Deterministic, network-free, database-free, DOM-free, router-free. It pins:
 *
 *   1. THE LANDING RULE (item 1) — the exact destination for every signup intent
 *      (save_bid / autopsy / radar-family / explicit next / nothing at all), and
 *      the same default mirrored by the Google OAuth callback.
 *   2. THE FIRST-RUN HREF — `/radar?first_run=1&trade=&cert=&state=&size=`, its
 *      per-field source precedence, and that it is always a same-site relative
 *      path (`safeNext` accepts it — no open redirect).
 *   3. THE OWNER-VERBATIM STRINGS — the tracking prompt ("We'll track this
 *      opportunity for you."), the best-match badge, the guidance copy.
 *   4. THE EVENT CONTRACT — the five new names are registered in EVENT_LABELS
 *      (display labels) and appear in NO funnel-stage set, so first-run guidance
 *      can never synthesize a signup/radar/activation/paid stage.
 *   5. THE SAVE-BUTTON LABEL DEFAULTS — the two new SaveToPipeline props change
 *      nothing for the surfaces that do not pass them.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BEST_MATCH_BADGE,
  FIRST_RUN_FREE_NOTE,
  FIRST_RUN_INPUTS,
  FIRST_RUN_SENTENCE,
  FUNNEL_UX_EVENT_NAMES,
  FUNNEL_UX_EVENTS,
  RADAR_FIRST_RUN_HREF,
  RADAR_FIRST_RUN_PARAM,
  SAVE_OPPORTUNITY_LABEL,
  SAVE_TRACKING_PROMPT,
  buildRadarFirstRunHref,
  isFirstRunSearch,
  mergeRadarCriteria,
  radarFirstRunSearch,
  resolveGoogleCallbackDestination,
  resolvePostSignupDestination,
  resolveSaveButtonLabel,
} from "./funnel-ux";
import { safeNext } from "./saved-matches";

const REPO_SRC = join(import.meta.dir, "..");

// ── 1. the first-run flag + href ─────────────────────────────────────────────

describe("first_run flag + the post-signup Radar href", () => {
  test("only the exact '1' value opens first-run mode", () => {
    expect(isFirstRunSearch({ first_run: "1" })).toBe(true);
    expect(isFirstRunSearch(new URLSearchParams("first_run=1"))).toBe(true);
    expect(isFirstRunSearch(new URLSearchParams(`trade=HVAC&${RADAR_FIRST_RUN_PARAM}=1`))).toBe(
      true,
    );
    for (const bad of ["true", "yes", "0", "2", " 1", "1 ", ""]) {
      expect(isFirstRunSearch({ first_run: bad })).toBe(false);
    }
    expect(isFirstRunSearch({})).toBe(false);
    expect(isFirstRunSearch(undefined)).toBe(false);
    expect(isFirstRunSearch(null)).toBe(false);
  });

  test("the canonical href is /radar?first_run=1", () => {
    expect(RADAR_FIRST_RUN_HREF).toBe("/radar?first_run=1");
    expect(buildRadarFirstRunHref()).toBe(RADAR_FIRST_RUN_HREF);
    expect(buildRadarFirstRunHref({ trade: "  ", state: "", cert: "", size: "" })).toBe(
      RADAR_FIRST_RUN_HREF,
    );
  });

  test("criteria ride the href, validated + encoded, empties omitted", () => {
    expect(
      buildRadarFirstRunHref({ trade: "HVAC", state: "va", cert: "sdvosb", size: "under1m" }),
    ).toBe("/radar?first_run=1&trade=HVAC&state=VA&cert=sdvosb&size=under1m");
    // The search object is the SAME data the client hands to navigate().
    expect(radarFirstRunSearch({ trade: "HVAC", state: "VA" })).toEqual({
      first_run: "1",
      trade: "HVAC",
      state: "VA",
    });
    // A trade with a space/ampersand is encoded, never injected into the query.
    const encoded = buildRadarFirstRunHref({ trade: "janitorial & HVAC" });
    expect(encoded).toContain("trade=janitorial+%26+HVAC");
    expect(encoded.split("?").length).toBe(2);
  });

  test("the href is always a same-site relative path (safeNext accepts it)", () => {
    expect(safeNext(buildRadarFirstRunHref({ trade: "HVAC" }))).toBe(
      "/radar?first_run=1&trade=HVAC",
    );
    expect(safeNext(RADAR_FIRST_RUN_HREF)).toBe(RADAR_FIRST_RUN_HREF);
  });

  test("per-field source precedence: URL > verified handoff > saved session", () => {
    expect(
      mergeRadarCriteria(
        { trade: "url-trade", state: "", cert: "url-cert", size: "" },
        { trade: "handoff-trade", state: "WA", cert: "handoff-cert", size: "under1m" },
        { trade: "saved-trade", state: "TX", cert: "saved-cert", size: "any" },
      ),
    ).toEqual({ trade: "url-trade", state: "WA", cert: "url-cert", size: "under1m" });
    expect(mergeRadarCriteria(null, undefined, { trade: "saved", state: "", cert: "", size: "" })).toEqual({
      trade: "saved",
      state: "",
      cert: "",
      size: "",
    });
    expect(mergeRadarCriteria()).toEqual({ trade: "", state: "", cert: "", size: "" });
  });
});

// ── 2. item 1 — the ONE post-signup landing rule ─────────────────────────────

describe("resolvePostSignupDestination — the post-signup landing rule", () => {
  const criteria = { trade: "HVAC", state: "VA", cert: "sdvosb", size: "under1m" };

  test("save_bid keeps today's path exactly (save, then next ?? /dashboard)", () => {
    expect(
      resolvePostSignupDestination({ saveBid: "123", next: "/awards" }, criteria, safeNext),
    ).toEqual({ kind: "save_then_next", href: "/awards" });
    expect(resolvePostSignupDestination({ saveBid: "123" }, criteria, safeNext)).toEqual({
      kind: "save_then_next",
      href: "/dashboard",
    });
    // An unsafe/invalid next is refused by safeNext (never an open redirect).
    expect(
      resolvePostSignupDestination({ saveBid: "123", next: "https://evil.test" }, criteria, safeNext),
    ).toEqual({ kind: "save_then_next", href: "/dashboard" });
    // A non-numeric save_bid is not an intent.
    expect(
      resolvePostSignupDestination({ saveBid: "abc", source: "radar" }, criteria, safeNext).kind,
    ).toBe("radar");
  });

  test("source=autopsy keeps its gifted-first-autopsy landing", () => {
    expect(resolvePostSignupDestination({ source: "autopsy" }, criteria, safeNext)).toEqual({
      kind: "autopsy",
    });
    expect(
      resolvePostSignupDestination({ source: "autopsy", next: "/awards" }, criteria, safeNext).kind,
    ).toBe("autopsy");
  });

  test("NEW: a radar-family signup lands on /radar?first_run=1 pre-filled", () => {
    for (const source of ["radar", "radar_results_unlock", "radar_results_cta"]) {
      const dest = resolvePostSignupDestination({ source, next: "/dashboard?brief=1" }, criteria, safeNext);
      expect(dest.kind).toBe("radar");
      if (dest.kind !== "radar") throw new Error("unreachable");
      // The retired brief-mode return path never wins for a radar signup.
      expect(dest.href).toBe("/radar?first_run=1&trade=HVAC&state=VA&cert=sdvosb&size=under1m");
      expect(dest.search.first_run).toBe("1");
      expect(dest.href.startsWith("/radar?")).toBe(true);
    }
  });

  test("NEW: a cold signup with NO intent lands on /radar?first_run=1 (was /onboarding)", () => {
    expect(resolvePostSignupDestination({}, {}, safeNext)).toEqual({
      kind: "radar",
      href: RADAR_FIRST_RUN_HREF,
      search: { first_run: "1" },
    });
    expect(resolvePostSignupDestination({ source: "closing_soon" }, {}, safeNext).kind).toBe("radar");
  });

  test("an explicit next on a NON-radar source keeps the onboarding first stop", () => {
    expect(
      resolvePostSignupDestination({ source: "closing_soon", next: "/awards" }, criteria, safeNext),
    ).toEqual({ kind: "onboarding" });
    expect(resolvePostSignupDestination({ next: "/#closing-soon" }, {}, safeNext)).toEqual({
      kind: "onboarding",
    });
    // …but an unsafe next is not an intent at all.
    expect(
      resolvePostSignupDestination({ next: "//evil.test/x" }, {}, safeNext).kind,
    ).toBe("radar");
    expect(resolvePostSignupDestination({ next: "javascript:alert(1)" }, {}, safeNext).kind).toBe(
      "radar",
    );
  });
});

describe("resolveGoogleCallbackDestination — the callback mirrors the new default", () => {
  test("brand-new Google user with NO intent lands on /radar?first_run=1", () => {
    expect(resolveGoogleCallbackDestination({ isNewUser: true, saveBid: null, next: null }, safeNext)).toBe(
      RADAR_FIRST_RUN_HREF,
    );
  });

  test("save_bid / returning users / an explicit next are unchanged", () => {
    expect(
      resolveGoogleCallbackDestination({ isNewUser: true, saveBid: 42, next: "/awards" }, safeNext),
    ).toBe("/awards");
    expect(resolveGoogleCallbackDestination({ isNewUser: true, saveBid: 42, next: null }, safeNext)).toBe(
      "/dashboard",
    );
    expect(
      resolveGoogleCallbackDestination({ isNewUser: false, saveBid: null, next: null }, safeNext),
    ).toBe("/dashboard");
    expect(
      resolveGoogleCallbackDestination({ isNewUser: false, saveBid: null, next: "/awards" }, safeNext),
    ).toBe("/awards");
    // A NEW user carrying an explicit next keeps the unchanged /onboarding stop.
    expect(
      resolveGoogleCallbackDestination({ isNewUser: true, saveBid: null, next: "/awards" }, safeNext),
    ).toBe("/onboarding");
    // Unsafe next never escapes the site.
    expect(
      resolveGoogleCallbackDestination({ isNewUser: false, saveBid: null, next: "https://evil.test" }, safeNext),
    ).toBe("/dashboard");
  });
});

// ── 3. the rendered copy ─────────────────────────────────────────────────────

describe("the owner-verbatim copy rendered by the Radar funnel", () => {
  test("the post-save prompt is EXACTLY the owner's sentence", () => {
    expect(SAVE_TRACKING_PROMPT).toBe("We'll track this opportunity for you.");
    // No embellishment: one sentence, one terminator, no trailing space.
    expect(SAVE_TRACKING_PROMPT.trim()).toBe(SAVE_TRACKING_PROMPT);
    expect(SAVE_TRACKING_PROMPT.endsWith(".")).toBe(true);
    expect(SAVE_TRACKING_PROMPT.split(".").filter((s) => s.trim().length > 0).length).toBe(1);
  });

  test("the best-match badge + the primary save CTA keep their owner wording", () => {
    expect(BEST_MATCH_BADGE).toBe("✦ Best match");
    expect(SAVE_OPPORTUNITY_LABEL).toBe("Save Opportunity");
  });

  test("the first-run guidance: ONE sentence + the four inputs + the free note", () => {
    expect(FIRST_RUN_SENTENCE).toBe(
      "Run your first real search to see the live set-aside opportunities your business qualifies for.",
    );
    expect(FIRST_RUN_INPUTS).toEqual([
      "Trade or NAICS code",
      "State",
      "Certification",
      "Preferred contract size",
    ]);
    expect(FIRST_RUN_INPUTS.length).toBe(4);
    expect(FIRST_RUN_FREE_NOTE).toContain("free");
  });
});

// ── 4. the save-button label defaults (SaveToPipeline's two new props) ───────

describe("resolveSaveButtonLabel — nothing changes for existing callers", () => {
  test("absent label ⇒ the historical labels, byte for byte", () => {
    expect(resolveSaveButtonLabel({})).toBe("Save to My Pipeline");
    expect(resolveSaveButtonLabel({ compact: false })).toBe("Save to My Pipeline");
    expect(resolveSaveButtonLabel({ compact: true })).toBe("Save");
    expect(resolveSaveButtonLabel({ compact: true, label: "" })).toBe("Save");
    expect(resolveSaveButtonLabel({ label: "   " })).toBe("Save to My Pipeline");
  });
  test("an explicit label wins (Radar's primary CTA)", () => {
    expect(resolveSaveButtonLabel({ compact: true, label: SAVE_OPPORTUNITY_LABEL })).toBe(
      "Save Opportunity",
    );
    expect(resolveSaveButtonLabel({ label: SAVE_OPPORTUNITY_LABEL })).toBe("Save Opportunity");
  });
});

// ── 5. the event contract ───────────────────────────────────────────────────

/** The text of one exported `const NAME ... = [ ... ];` array, or null. */
function arrayBlock(source: string, name: string): string | null {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) return null;
  const open = source.indexOf("[", start);
  const close = source.indexOf("];", open);
  if (open < 0 || close < 0) return null;
  return source.slice(open, close);
}

describe("funnel-UX events: registered display labels, never funnel stages", () => {
  test("exactly the five new names, and each is wired into a component (non-vacuous)", () => {
    expect(FUNNEL_UX_EVENT_NAMES).toEqual([
      "signup_landed_radar",
      "radar_first_run_shown",
      "radar_first_search_started",
      "radar_best_match_highlighted",
      "save_opportunity_prompt_shown",
    ]);
    expect(new Set(FUNNEL_UX_EVENT_NAMES).size).toBe(5);
    expect(FUNNEL_UX_EVENTS.radarFirstRunShown).toBe("radar_first_run_shown");
    // The surfaces that fire them must reference the module's constants.
    const radar = readFileSync(join(REPO_SRC, "routes", "radar.tsx"), "utf8");
    for (const member of [
      "radarFirstRunShown",
      "radarFirstSearchStarted",
      "radarBestMatchHighlighted",
      "saveOpportunityPromptShown",
    ]) {
      expect(radar).toContain(`FUNNEL_UX_EVENTS.${member}`);
    }
    const signup = readFileSync(join(REPO_SRC, "routes", "signup.tsx"), "utf8");
    expect(signup).toContain('trackEvent("signup_landed_radar"');
    expect(signup).toContain("resolvePostSignupDestination");
  });

  test("registered in EVENT_LABELS as display labels", () => {
    const text = readFileSync(join(REPO_SRC, "lib", "tracking-intake.ts"), "utf8");
    const labels = text.slice(text.indexOf("EVENT_LABELS"), text.indexOf("function getClientIp"));
    for (const name of FUNNEL_UX_EVENT_NAMES) {
      expect(labels).toContain(`${name}: "`);
    }
  });

  test("no funnel-stage definition references any of the five names", () => {
    const funnelFiles = [
      "lib/radar-conversion-funnel.ts",
      "lib/radar-leads-funnel.ts",
      "lib/bid-scout-funnel.ts",
      "lib/autopsy-funnel.ts",
      "routes/api/admin/unified-funnel.ts",
      "routes/api/admin/journeys.ts",
    ].map((rel) => join(REPO_SRC, rel));
    expect(funnelFiles.length).toBe(6);
    let checked = 0;
    for (const path of funnelFiles) {
      if (!existsSync(path)) continue;
      const text = readFileSync(path, "utf8");
      for (const name of FUNNEL_UX_EVENT_NAMES) expect(text.includes(name)).toBe(false);
      checked += 1;
    }
    expect(checked).toBe(6);
  });

  test("tracking-intake: the stage sets that live beside EVENT_LABELS stay untouched", () => {
    const text = readFileSync(join(REPO_SRC, "lib", "tracking-intake.ts"), "utf8");
    for (const setName of [
      "ACTIVATION_EVENTS",
      "SIGNUP_VIEWED_EVENTS",
      "SIGNUP_STARTED_EVENTS",
      "RADAR_COMPLETE_EVENT",
    ]) {
      const block = setName === "RADAR_COMPLETE_EVENT" ? null : arrayBlock(text, setName);
      if (block === null) {
        // RADAR_COMPLETE_EVENT is a single string constant, not an array.
        const at = text.indexOf(`export const ${setName} =`);
        expect(at).toBeGreaterThan(-1);
        const line = text.slice(at, text.indexOf(";", at));
        for (const name of FUNNEL_UX_EVENT_NAMES) expect(line.includes(name)).toBe(false);
        continue;
      }
      for (const name of FUNNEL_UX_EVENT_NAMES) expect(block.includes(name)).toBe(false);
    }
    expect(text).toContain('RADAR_COMPLETE_EVENT = "radar_scan_complete"');
  });
});
