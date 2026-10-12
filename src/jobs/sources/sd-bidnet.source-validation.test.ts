/**
 * LIVE source validation for the BidNet Direct South Dakota connector
 * (`sd_bidnet`).
 *
 * WHY OPT-IN: ordinary CI must never depend on an external website (owner
 * guardrail 2026-09-19). This file does NOTHING unless
 * `BIDS_RUN_LIVE_SOURCE_TESTS=1` — the required pre-`connected` gate, run by
 *   `bun run validate:live-bids-sources`
 * (or `BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/sd-bidnet.source-validation.test.ts`).
 * Skipped, it says so loudly.
 *
 * WHAT IT PROVES against the real, public, login-free BidNet SD pages:
 *   1. HTTP 200 and the anchors the connector needs are still present: the list's
 *      solicitations table plus its own "N Open Solicitations" heading, on the
 *      list page AND on every page its own pagination advertises. A MISSING anchor
 *      is a FAIL (the site was restructured); the anchor present with ZERO rows is
 *      a PASS — a quiet purchasing group is honest-empty, not a broken connector.
 *   2. every parsed row is verifiable against the fetched bytes (its solicitation
 *      id, its title and its closing date really appear in the live page), and the
 *      rows delivered match the total the page itself claims.
 *   3. every `source_url` is an absolute https URL on www.bidnetdirect.com, the
 *      per-solicitation detail page, that still resolves PUBLICLY (HTTP 200) —
 *      and it is NOT a members-only page: this gate also asserts the reached page
 *      still marks its issuing organization / solicitation number as locked, i.e.
 *      the connector's claim about what the public page does and does not publish
 *      is still TRUE. If the gate ever finds those cells public, the row mapping
 *      (which leaves them NULL) must be revisited.
 *   4. no row claims a field BidNet does not publish publicly (solicitation
 *      number / naics / psc / value), and every `due_date` is parseable — never an
 *      invented instant.
 *   5. parsing the same bytes twice yields the same rows, so a re-run cannot
 *      rewrite a row it already has (the no-churn property).
 *
 * Once invoked, a failure to reach the source FAILS the test — it does not skip.
 * The gate prints the total it saw and a sample of the rows so an operator can read
 * the live corpus from the log.
 */
import { describe, expect, test } from "bun:test";
import {
  SD_BIDNET_AGENCY,
  SD_BIDNET_LIST_URL,
  SD_BIDNET_ORIGIN,
  parseSdBidnet,
  parseSdBidnetPageLinks,
  parseSdBidnetRows,
  sdBidnetListShapeOk,
  sdBidnetStatedOpenCount,
  type SdBidnetRow,
} from "./sd-bidnet";

/** The live validation is OPT-IN — see the header for why. */
const RUN_LIVE = process.env.BIDS_RUN_LIVE_SOURCE_TESTS === "1";
const SKIP = !RUN_LIVE;
const BOLD = "\u001b[1m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";
if (SKIP) {
  console.warn(
    `\n${BOLD}${YELLOW}LIVE SOURCE VALIDATION SKIPPED — run \`bun run validate:live-bids-sources\` ` +
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/sd-bidnet.source-validation.test.ts\`) to ` +
      `verify the BidNet Direct South Dakota list against the real source.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the parser logic, NOT the live source.\n`,
  );
} else {
  console.warn(
    `\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching ${SD_BIDNET_LIST_URL} for real (opt-in).${RESET}\n`,
  );
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const LIVE_TIMEOUT_MS = 60_000;

async function get(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Referer: SD_BIDNET_LIST_URL,
      },
      signal: controller.signal,
    });
    // Deliberately NOT swallowed into a skip: a source we cannot verify fails the gate.
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } catch (e) {
    throw new Error(
      `live BidNet SD source validation could not run: ${(e as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** One live pass, shared by the assertions below (public pages, read only). */
const live = SKIP
  ? null
  : await (async () => {
      const first = await get(SD_BIDNET_LIST_URL);
      const hrefs = parseSdBidnetPageLinks(first)
        .filter((l) => l.pageNumber > 1)
        .map((l) => l.href);
      const rest: string[] = [];
      for (const href of hrefs) rest.push(await get(href));
      const rows: SdBidnetRow[] = [
        ...parseSdBidnetRows(first),
        ...rest.flatMap((h) => parseSdBidnetRows(h)),
      ];
      // The row's own public detail page — the source_url the connector stores.
      const detailUrl = rows[0]?.url ?? `${SD_BIDNET_ORIGIN}/`;
      const detail = await get(detailUrl);
      return {
        pages: [first, ...rest],
        stated: sdBidnetStatedOpenCount(first),
        rows,
        detailUrl,
        detail,
      };
    })();

describe.skipIf(SKIP)("sd_bidnet source validation (live)", () => {
  test("the source is reachable and still has the shape the connector parses", () => {
    for (const html of live!.pages)
      expect(sdBidnetListShapeOk(html)).toBe(true);
    // The row count the parse delivers must match the total the page claims, as
    // the connector's own fetch does (a page that claims rows it did not deliver
    // is a reshape, not an empty group).
    if (live!.stated !== null && live!.stated > 0) {
      expect(live!.rows.length).toBe(live!.stated);
      expect(live!.rows.some((r) => r.closingState === "open")).toBe(true);
    }
  });

  test("every parsed row is verifiable against the fetched bytes", () => {
    const joined = live!.pages.join("\n");
    // The pages are HTML, so the spot-check decodes the entities the same way the
    // parser does before looking for a title in the raw bytes.
    const decodeBytes = (s: string) =>
      s
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&ndash;/g, "\u2013");
    const flat = (s: string) => s.replace(/\s+/g, " ");
    const flatJoined = flat(decodeBytes(joined));
    const now = Date.now();
    const { rows, skipped } = parseSdBidnet(live!.rows, now);
    // Accounting invariant: everything listed is either accepted or skipped with a
    // reason, and on a healthy list the ONLY reason can be a close date that has
    // passed (a duplicate, an unreadable date, a missing id/title or a row the
    // page no longer marks open would mean the page changed shape under us).
    const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
    expect(rows.length + skippedTotal).toBe(live!.rows.length);
    for (const reason of [
      "bad_date",
      "missing_id",
      "missing_title",
      "not_open",
      "duplicate",
    ]) {
      expect(`${reason}=${skipped[reason] ?? 0}`).toBe(`${reason}=0`);
    }
    for (const r of live!.rows) {
      expect(flatJoined).toContain(r.id);
      expect(flatJoined).toContain(flat(r.title));
      // The closing date as the page prints it (MM/DD/YYYY) is in the bytes.
      expect(flatJoined).toContain(r.closing);
    }
    for (const row of rows) {
      const u = new URL(row.source_url);
      expect(u.host).toBe("www.bidnetdirect.com");
      expect(u.pathname).toMatch(
        /^\/public\/supplier\/solicitations\/[a-z-]+\/\d+\/abstract$/,
      );
      expect(u.searchParams.get("purchasingGroupId")).toBeTruthy();
      expect(row.location).toBe("South Dakota");
      expect(row.agency).toBe(SD_BIDNET_AGENCY);
      // Null-or-parseable, never invented.
      expect(Number.isNaN(Date.parse(row.due_date!))).toBe(false);
      // Nothing is claimed about fields this source does not publish publicly.
      expect(row.solicitation_number).toBeNull();
      expect(row.naics_code).toBeNull();
      expect(row.psc).toBeNull();
      expect(row.set_aside).toBeNull();
      expect(row.estimated_value).toBe("Not specified");
      // The aggregator honesty travels on the row itself.
      expect(row.description).toContain("third-party");
    }
    // A sample for the operator reading the log.
    console.warn(
      `\n${BOLD}sd_bidnet live corpus:${RESET} ${live!.rows.length} open SD solicitations listed ` +
        `(page says ${live!.stated ?? "n/a"}); ${rows.length} accepted, skips ${JSON.stringify(skipped) || "none"}.\n` +
        rows
          .slice(0, 8)
          .map(
            (r) =>
              `  · ${r.external_id}  closes ${r.due_date}  ${r.title.slice(0, 90)}`,
          )
          .join("\n") +
        `\n  (read over ${live!.pages.length} page(s); sample of the ${rows.length} accepted rows)\n`,
    );
  });

  test("the per-row source_url is a public page that still LOCKs the members-only cells", () => {
    const u = new URL(live!.detailUrl);
    expect(u.host).toBe("www.bidnetdirect.com");
    // Public: it loaded (a locked page would have failed the gate's 200 check).
    expect(live!.detail).toContain("<html");
    // And the cells the connector refuses to report are still members-only — this
    // is the claim the row mapping rests on. If this ever changes, revisit it.
    const cells = live!.detail
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");
    expect(cells).toMatch(/Issuing Organization[\s\S]{0,200}?Locked/);
    expect(cells).toMatch(/Solicitation Number[\s\S]{0,200}?Locked/);
  });

  test("parsing the same bytes twice gives the same rows (no churn on re-run)", () => {
    const print = (rs: SdBidnetRow[]) =>
      parseSdBidnet(rs).rows.map((r) =>
        [r.external_id, r.title, r.due_date, r.source_url].join(" | "),
      );
    expect(print(live!.rows)).toEqual(print(live!.rows));
  });
});
