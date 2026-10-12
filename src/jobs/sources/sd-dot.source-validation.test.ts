/**
 * LIVE source validation for the SDDOT lettings connector (`sd_dot`).
 *
 * WHY OPT-IN: ordinary CI must never depend on an external website (owner
 * guardrail 2026-09-19). This file does NOTHING unless
 * `BIDS_RUN_LIVE_SOURCE_TESTS=1` — the required pre-`connected` gate, run by
 *   `bun run validate:live-bids-sources`
 * (or `BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/sd-dot.source-validation.test.ts`).
 * Skipped, it says so loudly.
 *
 * WHAT IT PROVES against the real SDDOT site:
 *   1. HTTP 200 and the two anchors the connector needs are still present: the
 *      index's "Lettings Currently Advertised for Bids" repeater and each letting
 *      page's `ctl00_cpSubContent_itemtable` projects table. A MISSING anchor is a
 *      FAIL (the application was restructured); an anchor present with ZERO rows is
 *      a PASS — SDDOT can legitimately have no letting advertised, and honest-empty
 *      is a correct outcome, not a broken connector.
 *   2. every parsed row's letting token really appears in the fetched index bytes,
 *      and every contract number really appears in the fetched letting bytes
 *      (spot-check against the live payload, not just against our own parser);
 *   3. every `source_url` is an absolute URL on apps.sd.gov, and every `due_date`
 *      is parseable — never an invented instant;
 *   4. no row claims a field SDDOT does not publish (naics / psc / value);
 *   5. parsing the same bytes twice yields the same rows, so a re-run cannot
 *      rewrite a row it already has (the no-churn property).
 *
 * Once invoked, a failure to reach the source FAILS the test — it does not skip.
 */
import { describe, expect, test } from "bun:test";
import {
  SD_DOT_LETTINGS_URL,
  parseSdDot,
  parseSdDotDetail,
  parseSdDotIndex,
  sdDotDetailShapeOk,
  sdDotIndexShapeOk,
  sdDotLettingUrl,
  type SdDotLetting,
} from "./sd-dot";

/** The live validation is OPT-IN — see the header for why. */
const RUN_LIVE = process.env.BIDS_RUN_LIVE_SOURCE_TESTS === "1";
const SKIP = !RUN_LIVE;
const BOLD = "\u001b[1m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";
if (SKIP) {
  console.warn(
    `\n${BOLD}${YELLOW}LIVE SOURCE VALIDATION SKIPPED — run \`bun run validate:live-bids-sources\` ` +
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/sd-dot.source-validation.test.ts\`) to ` +
      `verify the SDDOT letting site against the real source.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the parser logic, NOT the live source.\n`,
  );
} else {
  console.warn(`\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching ${SD_DOT_LETTINGS_URL} for real (opt-in).${RESET}\n`);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const LIVE_TIMEOUT_MS = 60_000;

async function get(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html", Referer: SD_DOT_LETTINGS_URL },
      signal: controller.signal,
    });
    // Deliberately NOT swallowed into a skip: a source we cannot verify fails the gate.
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } catch (e) {
    throw new Error(`live SDDOT source validation could not run: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** One live pass, shared by the assertions below (public pages, read only). */
const live = SKIP
  ? null
  : await (async () => {
      const indexHtml = await get(SD_DOT_LETTINGS_URL);
      const links = parseSdDotIndex(indexHtml);
      const pages = await Promise.all(
        links.map(async (l) => ({ link: l, html: await get(sdDotLettingUrl(l.args)) })),
      );
      const lettings = pages
        .map((p) => parseSdDotDetail(p.link.args, p.html))
        .filter((l): l is SdDotLetting => l !== null);
      return { indexHtml, links, pages, lettings };
    })();

describe.skipIf(SKIP)("sd_dot source validation (live)", () => {
  test("the source is reachable and still has the shape the connector parses", () => {
    expect(sdDotIndexShapeOk(live!.indexHtml)).toBe(true);
    for (const p of live!.pages) {
      // A missing table = the letting page was restructured → FAIL. A table with
      // zero rows is honest-empty → PASS (see the file header).
      expect(sdDotDetailShapeOk(p.html)).toBe(true);
    }
  });
  test("every parsed row is verifiable against the fetched bytes", () => {
    const { rows } = parseSdDot(live!.lettings);
    expect(rows.length).toBeGreaterThanOrEqual(0);
    // The page is read as-is but SDDOT pads cells with runs of spaces (e.g. the
    // contract number "CIP 11120(  )"), so the spot-check compares on a
    // whitespace-flattened copy of the live bytes.
    const flat = (s: string) => s.replace(/\s+/g, " ");
    for (const l of live!.links) expect(live!.indexHtml).toContain(`args=${l.args}`);
    for (const r of rows) {
      expect(live!.indexHtml).toContain(new URL(r.source_url).searchParams.get("args")!);
      expect(live!.pages.some((p) => flat(p.html).includes(r.solicitation_number!))).toBe(true);
      const u = new URL(r.source_url);
      expect(u.host).toBe("apps.sd.gov");
      expect(u.pathname).toBe("/HC65BidLetting/ebslettingsdetail1.aspx");
      expect(r.location).toBe("South Dakota");
      expect(r.agency).toBe("South Dakota Department of Transportation");
      expect(r.category).toBe("Construction");
      // Null-or-parseable, never invented.
      expect(Number.isNaN(Date.parse(r.due_date))).toBe(false);
      // Nothing is claimed about fields this source does not publish.
      expect(r.naics_code).toBeNull();
      expect(r.psc).toBeNull();
      expect(r.set_aside).toBeNull();
      expect(r.estimated_value).toBe("Not specified");
    }
  });
  test("parsing the same bytes twice gives the same rows (no churn on re-run)", () => {
    const print = (ls: SdDotLetting[]) =>
      parseSdDot(ls).rows.map((r) => [r.external_id, r.title, r.due_date, r.source_url].join(" | "));
    expect(print(live!.lettings)).toEqual(print(live!.lettings));
  });
});
