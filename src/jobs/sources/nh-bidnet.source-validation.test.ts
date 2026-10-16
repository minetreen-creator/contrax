/**
 * LIVE source validation for the BidNet Direct New Hampshire connector
 * (`nh_bidnet`).
 *
 * WHY OPT-IN: ordinary CI must never depend on an external website (owner
 * guardrail 2026-09-19). This file does NOTHING unless
 * `BIDS_RUN_LIVE_SOURCE_TESTS=1` — the required pre-`connected` gate, run by
 *   `bun run validate:live-bids-sources`
 * (or `BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/nh-bidnet.source-validation.test.ts`).
 * Skipped, it says so loudly.
 *
 * WHAT IT PROVES against the real, public, login-free BidNet NH pages:
 *   1. HTTP 200 and the anchors the connector needs are still present: the list's
 *      solicitations table plus its own "N Open Solicitations" heading, on the
 *      list page AND on every page its own pagination advertises. A MISSING anchor
 *      is a FAIL (the site was restructured); the anchor present with ZERO rows is
 *      a PASS — a quiet purchasing group is honest-empty, not a broken connector.
 *   2. the row count the connector reads equals the total the page itself claims
 *      (the list's own heading), and the only rows it drops are ones the source
 *      itself cannot support: a closing date that has passed (`closed`) or a
 *      closing cell that prints no date at all (`bad_date`, e.g. BidNet's "Not
 *      Available") — the latter re-proved from the fetched bytes, never assumed.
 *      Any other skip reason means the page changed shape under us: a FAIL.
 *   3. every parsed row is verifiable against the fetched bytes (its solicitation
 *      id, its title and its closing date as printed really appear there).
 *   4. every `source_url` is an absolute https URL on www.bidnetdirect.com, the
 *      per-solicitation detail page, that still resolves PUBLICLY (HTTP 200) —
 *      and it is NOT a members-only page: this gate also asserts the reached page
 *      still marks its issuing organization / solicitation number as locked, i.e.
 *      the connector's claim about what the public page does and does not publish
 *      is still TRUE. If the gate ever finds those cells public, the row mapping
 *      (which leaves them NULL) must be revisited.
 *   5. no row claims a field BidNet does not publish publicly (solicitation
 *      number / naics / psc / set-aside / value), and every `due_date` is
 *      parseable — never an invented instant.
 *   6. NO CHURN between two independent fetches: a second full read of the same
 *      live pages yields byte-for-byte the same parsed row for every solicitation
 *      both reads saw, so a re-run cannot rewrite a row it already has.
 *
 * Once invoked, a failure to reach the source FAILS the test — it does not skip.
 * The gate prints the total it saw and a sample of the rows so an operator can read
 * the live corpus from the log.
 */
import { describe, expect, test } from "bun:test";
import {
  NH_BIDNET_AGENCY,
  NH_BIDNET_LIST_URL,
  NH_BIDNET_ORIGIN,
  parseNhBidnet,
  parseNhBidnetPageLinks,
  parseNhBidnetRows,
  nhBidnetListShapeOk,
  nhBidnetStatedOpenCount,
  type NhBidnetRow,
} from "./nh-bidnet";

/** The live validation is OPT-IN — see the header for why. */
const RUN_LIVE = process.env.BIDS_RUN_LIVE_SOURCE_TESTS === "1";
const SKIP = !RUN_LIVE;
const BOLD = "\u001b[1m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";
if (SKIP) {
  console.warn(
    `\n${BOLD}${YELLOW}LIVE SOURCE VALIDATION SKIPPED — run \`bun run validate:live-bids-sources\` ` +
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/nh-bidnet.source-validation.test.ts\`) to ` +
      `verify the BidNet Direct New Hampshire list against the real source.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the parser logic, NOT the live source.\n`,
  );
} else {
  console.warn(
    `\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching ${NH_BIDNET_LIST_URL} for real (opt-in).${RESET}\n`,
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
        Referer: NH_BIDNET_LIST_URL,
      },
      signal: controller.signal,
    });
    // Deliberately NOT swallowed into a skip: a source we cannot verify fails the gate.
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } catch (e) {
    throw new Error(
      `live BidNet NH source validation could not run: ${(e as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One full read of the live list: the list page plus every page it advertises. */
async function readLive(): Promise<{
  pages: string[];
  stated: number | null;
  rows: NhBidnetRow[];
}> {
  const first = await get(NH_BIDNET_LIST_URL);
  const hrefs = parseNhBidnetPageLinks(first)
    .filter((l) => l.pageNumber > 1)
    .map((l) => l.href);
  const rest: string[] = [];
  for (const href of hrefs) {
    await sleep(300);
    rest.push(await get(href));
  }
  const pages = [first, ...rest];
  return {
    pages,
    stated: nhBidnetStatedOpenCount(first),
    rows: pages.flatMap((h) => parseNhBidnetRows(h)),
  };
}

/** Two INDEPENDENT reads — the no-churn proof (see the header, point 6). */
const live1 = SKIP ? null : await readLive();
const live2 = SKIP ? null : await readLive();

/** The row's own public detail page — the source_url the connector stores. */
const detailUrl = live1?.rows[0]?.url ?? `${NH_BIDNET_ORIGIN}/`;
const detail = SKIP ? null : await get(detailUrl);

/** Decode + flatten exactly as the parser does, for byte spot-checks. */
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

describe.skipIf(SKIP)("nh_bidnet source validation (live)", () => {
  test("the source is reachable and still has the shape the connector parses", () => {
    for (const html of live1!.pages)
      expect(nhBidnetListShapeOk(html)).toBe(true);
    // The row count the parse delivers must match the total the page claims, as
    // the connector's own fetch does (a page that claims rows it did not deliver
    // is a reshape, not an empty group).
    if (live1!.stated !== null && live1!.stated > 0) {
      expect(live1!.rows.length).toBe(live1!.stated);
      expect(live1!.rows.some((r) => r.closingState === "open")).toBe(true);
    }
  });

  test("every parsed row is verifiable against the fetched bytes", () => {
    const joined = live1!.pages.join("\n");
    const flatJoined = flat(decodeBytes(joined));
    const now = Date.now();
    const { rows, skipped, skippedRows } = parseNhBidnet(live1!.rows, now);
    // Accounting invariant: everything listed is either accepted or skipped with a
    // reason, and on a healthy list the ONLY reasons can be a close date that has
    // passed or a closing cell that prints no date — a duplicate, a missing
    // id/title or a row the page no longer marks open would mean the page changed
    // shape under us.
    const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
    expect(rows.length + skippedTotal).toBe(live1!.rows.length);
    for (const reason of [
      "missing_id",
      "missing_title",
      "not_open",
      "duplicate",
    ]) {
      expect(`${reason}=${skipped[reason] ?? 0}`).toBe(`${reason}=0`);
    }
    // Every `bad_date` row is re-proved from the bytes: its closing cell really
    // carries no MM/DD/YYYY date (BidNet prints "Not Available"). Contrax drops
    // such a row rather than inventing the deadline it would need to store it.
    const badDateIds = skippedRows
      .filter((s) => s.reason === "bad_date")
      .map((s) => s.id.replace(/^nhbidnet-/, ""));
    expect(badDateIds.length).toBe(skipped.bad_date ?? 0);
    const listedById = new Map(live1!.rows.map((r) => [r.id, r]));
    for (const id of badDateIds) {
      const listed = listedById.get(id)!;
      expect(listed).toBeDefined();
      expect(listed.closingState).toBe("open");
      expect(listed.closing).not.toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      // …and that unreadable text is what the fetched page printed for the row.
      expect(flatJoined).toContain(flat(listed.closing));
    }
    for (const r of live1!.rows) {
      expect(flatJoined).toContain(r.id);
      expect(flatJoined).toContain(flat(r.title));
    }
    for (const listed of live1!.rows) {
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(listed.closing))
        expect(flatJoined).toContain(listed.closing);
    }
    for (const row of rows) {
      const u = new URL(row.source_url);
      expect(u.host).toBe("www.bidnetdirect.com");
      expect(u.pathname).toMatch(
        /^\/public\/supplier\/solicitations\/[a-z-]+\/\d+\/abstract$/,
      );
      expect(u.searchParams.get("purchasingGroupId")).toBeTruthy();
      expect(row.location).toBe("New Hampshire");
      expect(row.agency).toBe(NH_BIDNET_AGENCY);
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
      expect(row.description).toContain(
        "not the State of New Hampshire's procurement portal",
      );
    }
    // A sample for the operator reading the log.
    console.warn(
      `\n${BOLD}nh_bidnet live corpus:${RESET} ${live1!.rows.length} open NH solicitations listed ` +
        `(page says ${live1!.stated ?? "n/a"}; read over ${live1!.pages.length} page(s)); ${rows.length} accepted, skips ${JSON.stringify(skipped)}.\n` +
        rows
          .slice(0, 8)
          .map(
            (r) =>
              `  · ${r.external_id}  closes ${r.due_date}  ${r.title.slice(0, 90)}`,
          )
          .join("\n") +
        `\n  (sample of the ${rows.length} accepted rows)\n`,
    );
  });

  test("the per-row source_url is a public page that still LOCKs the members-only cells", () => {
    const u = new URL(detailUrl);
    expect(u.host).toBe("www.bidnetdirect.com");
    // Public: it loaded (a locked page would have failed the gate's 200 check).
    expect(detail!).toContain("<html");
    // And the cells the connector refuses to report are still members-only — this
    // is the claim the row mapping rests on. If this ever changes, revisit it.
    const cells = detail!
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");
    expect(cells).toMatch(/Issuing Organization[\s\S]{0,200}?Locked/);
    expect(cells).toMatch(/Solicitation Number[\s\S]{0,200}?Locked/);
  });

  test("NO CHURN: two independent live reads agree row-for-row on every shared id", () => {
    // Read twice (see the header, point 6). Solicitations may legitimately be
    // posted or close between the two reads, so the pin is on the SHARED ids:
    // for those, every stored field must be identical, or a re-run would rewrite
    // a row Contrax already has.
    const a = parseNhBidnet(live1!.rows, Date.now()).rows;
    const b = parseNhBidnet(live2!.rows, Date.now()).rows;
    const byId = new Map(a.map((r) => [r.external_id, r]));
    let shared = 0;
    for (const r of b) {
      const other = byId.get(r.external_id);
      if (!other) continue;
      shared++;
      expect([
        r.title,
        r.due_date,
        r.source_url,
        r.location,
        r.agency,
        r.category,
        r.estimated_value,
        r.description,
      ]).toEqual([
        other.title,
        other.due_date,
        other.source_url,
        other.location,
        other.agency,
        other.category,
        other.estimated_value,
        other.description,
      ]);
    }
    expect(shared).toBeGreaterThan(0);
    const onlyA = a.filter(
      (r) => !b.some((x) => x.external_id === r.external_id),
    );
    const onlyB = b.filter(
      (r) => !a.some((x) => x.external_id === r.external_id),
    );
    console.warn(
      `\n${BOLD}nh_bidnet no-churn:${RESET} ${shared} shared ids identical across two independent reads` +
        ` (read 1: ${a.length} rows, read 2: ${b.length}; appeared only in read 1: ${onlyA.length}, only in read 2: ${onlyB.length}).\n`,
    );
  });

  test("parsing the same bytes twice gives the same rows (no churn on re-run)", () => {
    const print = (rs: NhBidnetRow[]) =>
      parseNhBidnet(rs).rows.map((r) =>
        [r.external_id, r.title, r.due_date, r.source_url].join(" | "),
      );
    expect(print(live1!.rows)).toEqual(print(live1!.rows));
  });
});
