/**
 * Contrax — SUBCONTRACTING preview: analytics contract tests (bun test).
 *
 * Deterministic, network-free, database-free. Two things are pinned here:
 *
 *   1. THE FIVE NAMES ARE THE CONTRACT (owner decision 5, 2026-09-25) and any extra
 *      name invented on this surface is a failure, not a bonus — the plan lists
 *      optional extras and they were explicitly NOT taken.
 *   2. ISOLATION. None of the five appears in ANY funnel-stage definition, so a
 *      subcontracting view can never synthesize a radar/signup/activation/paid
 *      stage. This is the same source-text proof `grants.test.ts` uses, and it is
 *      non-vacuous twice over: it must actually read the funnel files, and it must
 *      find the four LIVE names wired into the page (so a rename that silently
 *      dropped tracking fails too).
 *
 * Plus the two behavioural rules the page depends on: `shouldFireNoticeView` fires
 * once per notice (never twice, never without a label), and
 * `subcontracts_checkout_started` is inert — registered, named as inert, and
 * unreferenced by any surface that could fire it.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  INERT_SUBCONTRACTS_EVENTS,
  SUBCONTRACTS_EVENTS,
  SUBCONTRACTS_EVENT_NAMES,
  SUBCONTRACTS_PAGE_PATH,
  shouldFireNoticeView,
} from "./subcontracts-analytics";

const REPO_SRC = join(import.meta.dir, "..", "..");

/**
 * Every funnel definition: any `*-funnel*.ts` under src/lib (so a NEW funnel file is
 * covered the day it lands, not the day someone remembers to add it here) plus the
 * two admin funnels that keep their own private event sets.
 *
 * `lib/tracking-intake.ts` is NOT in this list even though it owns ACTIVATION_EVENTS:
 * it is also the home of EVENT_LABELS, where these five names MUST appear (they are
 * display labels there). Its stage set is checked precisely, on its own, below.
 */
function funnelSources(): string[] {
  const libDir = join(REPO_SRC, "lib");
  const files = readdirSync(libDir)
    .filter((name) => /funnel.*\.ts$/.test(name) && !name.endsWith(".test.ts"))
    .map((name) => join("lib", name));
  for (const rel of ["routes/api/admin/unified-funnel.ts", "routes/api/admin/journeys.ts"]) {
    if (existsSync(join(REPO_SRC, rel))) files.push(rel);
  }
  return files.map((rel) => join(REPO_SRC, rel));
}

/** The text of one exported `const NAME ... = [ ... ];` array, or null. */
function arrayBlock(source: string, name: string): string | null {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) return null;
  const open = source.indexOf("[", start);
  const close = source.indexOf("];", open);
  if (open < 0 || close < 0) return null;
  return source.slice(open, close);
}

describe("subcontracts analytics: the five approved names (owner decision 5)", () => {
  test("exactly the five owner-approved names, four registered + one inert", () => {
    expect(SUBCONTRACTS_EVENT_NAMES).toEqual([
      "subcontracts_page_viewed",
      "subcontracts_notice_viewed",
      "subcontract_source_open",
      "subcontract_contact_click",
      "subcontracts_checkout_started",
    ]);
    expect(new Set(SUBCONTRACTS_EVENT_NAMES).size).toBe(5);
    // The two draft names are kept VERBATIM (they are the ones that already exist
    // in the wild for this surface) — no `subcontracts_`-style rename of them.
    expect(SUBCONTRACTS_EVENTS.sourceOpen).toBe("subcontract_source_open");
    expect(SUBCONTRACTS_EVENTS.contactClick).toBe("subcontract_contact_click");
    // …and the other two are the `subcontracts_` family.
    expect(SUBCONTRACTS_EVENTS.pageViewed.startsWith("subcontracts_")).toBe(true);
    expect(SUBCONTRACTS_EVENTS.noticeViewed.startsWith("subcontracts_")).toBe(true);
    expect(SUBCONTRACTS_EVENTS.checkoutStarted.startsWith("subcontracts_")).toBe(true);
    expect(SUBCONTRACTS_PAGE_PATH).toBe("/subcontracts");
  });

  test("no filter/prime/card extra events were invented", () => {
    // The plan lists optional extras (filter_changed, prime_dir_viewed,
    // prime_click). The lead's brief froze the contract at five; anything else is a
    // contract change, not an implementation detail.
    const banned = [
      "subcontracts_filter_changed",
      "subcontracts_prime_dir_viewed",
      "subcontracts_prime_click",
      "subcontracts_prime_viewed",
      "subcontracts_filter_applied",
      "subcontracts_notice_clicked",
    ];
    for (const name of banned) expect(SUBCONTRACTS_EVENT_NAMES).not.toContain(name);
  });

  test("checkout is DEFINED but INERT, and only the checkout name is inert", () => {
    expect(INERT_SUBCONTRACTS_EVENTS).toEqual(["subcontracts_checkout_started"]);
    // The four live names are NOT inert.
    for (const live of [
      SUBCONTRACTS_EVENTS.pageViewed,
      SUBCONTRACTS_EVENTS.noticeViewed,
      SUBCONTRACTS_EVENTS.sourceOpen,
      SUBCONTRACTS_EVENTS.contactClick,
    ]) {
      expect(INERT_SUBCONTRACTS_EVENTS).not.toContain(live);
    }
  });

  test("published paths/isolation note: the inert name is documented where it is defined", () => {
    const text = readFileSync(join(import.meta.dir, "subcontracts-analytics.ts"), "utf8");
    expect(text).toContain("INERT");
    expect(text).toContain("subcontracts_checkout_started");
  });
});

describe("subcontracts analytics: ISOLATION from every funnel stage set", () => {
  test("no funnel source references ANY of the five names (source-text proof)", () => {
    const files = funnelSources();
    // Non-vacuous: the funnel files must actually have been read.
    expect(files.length).toBeGreaterThanOrEqual(5);
    let read = 0;
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      read += 1;
      for (const name of SUBCONTRACTS_EVENT_NAMES) {
        expect(text.includes(name)).toBe(false);
      }
    }
    expect(read).toBe(files.length);
  });

  test("tracking-intake: the five names are DISPLAY LABELS only, never in ACTIVATION_EVENTS", () => {
    const text = readFileSync(join(REPO_SRC, "lib", "tracking-intake.ts"), "utf8");
    for (const name of SUBCONTRACTS_EVENT_NAMES) expect(text).toContain(`${name}:`);
    // ACTIVATION_EVENTS is a real funnel stage set living in that same file, so the
    // whole-file scan above cannot cover it — this reads the array itself.
    const activation = arrayBlock(text, "ACTIVATION_EVENTS");
    expect(activation).not.toBeNull();
    expect(activation!.length).toBeGreaterThan(50); // non-vacuous: the array was found
    for (const name of SUBCONTRACTS_EVENT_NAMES) {
      expect(activation!.includes(name)).toBe(false);
    }
  });

  test("the four LIVE names are wired into the page (guard is not vacuous)", () => {
    const page = readFileSync(join(REPO_SRC, "routes", "subcontracts.tsx"), "utf8");
    expect(page).toContain("trackSubcontractsEvent");
    expect(page).toContain("shouldFireNoticeView");
    expect(page).toContain("SUBCONTRACTS_EVENTS.pageViewed");
    expect(page).toContain("SUBCONTRACTS_EVENTS.noticeViewed");
    expect(page).toContain("SUBCONTRACTS_EVENTS.sourceOpen");
    expect(page).toContain("SUBCONTRACTS_EVENTS.contactClick");
    // The inert name must NOT appear on any surface that could fire it.
    expect(page.includes(SUBCONTRACTS_EVENTS.checkoutStarted)).toBe(false);
  });

  test("no server route writes an analytics event for this surface", () => {
    for (const rel of [
      join("routes", "api", "subcontracts", "index.ts"),
      join("routes", "api", "subcontracts", "primes.ts"),
      join("lib", "subcontracts", "read.server.ts"),
      join("lib", "subcontracts", "read.ts"),
    ]) {
      const path = join(REPO_SRC, rel);
      expect(existsSync(path)).toBe(true);
      const text = readFileSync(path, "utf8");
      expect(text.includes("trackEvent")).toBe(false);
      for (const name of SUBCONTRACTS_EVENT_NAMES) expect(text.includes(name)).toBe(false);
    }
  });
});

describe("subcontracts analytics: 'once per notice' notice-view guard", () => {
  test("fires the FIRST time a notice is seen and never again", () => {
    const seen = new Set<string>();
    expect(shouldFireNoticeView(seen, "dorm-common-area-landscaping")).toBe(true);
    expect(shouldFireNoticeView(seen, "dorm-common-area-landscaping")).toBe(false);
    expect(shouldFireNoticeView(seen, "dorm-common-area-landscaping")).toBe(false);
    // A different notice is independent of the first.
    expect(shouldFireNoticeView(seen, "mound-mn-water-treatment-facility")).toBe(true);
    expect(shouldFireNoticeView(seen, "mound-mn-water-treatment-facility")).toBe(false);
    expect(seen.size).toBe(2);
  });

  test("never fires without a label (an unattributable row is worse than no row)", () => {
    const seen = new Set<string>();
    expect(shouldFireNoticeView(seen, null)).toBe(false);
    expect(shouldFireNoticeView(seen, undefined)).toBe(false);
    expect(shouldFireNoticeView(seen, "")).toBe(false);
    expect(shouldFireNoticeView(seen, "   ")).toBe(false);
    expect(seen.size).toBe(0);
  });

  test("two notices with the same id and surrounding whitespace are the SAME notice", () => {
    const seen = new Set<string>();
    expect(shouldFireNoticeView(seen, " slug-a ")).toBe(true);
    expect(shouldFireNoticeView(seen, "slug-a")).toBe(false);
  });
});
