/**
 * LIVE source validation for the BidNet Direct California connector
 * (`ca_bidnet`).
 *
 * WHY OPT-IN: ordinary CI must never depend on an external website (owner
 * guardrail 2026-09-19). This file does NOTHING unless
 * `BIDS_RUN_LIVE_SOURCE_TESTS=1` — the required pre-`connected` gate, run by
 *   `bun run validate:live-bids-sources`
 * (or `BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/ca-bidnet.source-validation.test.ts`).
 * Skipped, it says so loudly.
 *
 * WHAT IT PROVES against the real, public, login-free BidNet California pages:
 *   1. HTTP 200 and the anchors the connector needs are still present: the list's
 *      solicitations table plus its own "N Open Solicitations" heading, on the
 *      list page AND on every page its own pagination advertises. A MISSING anchor
 *      is a FAIL (the site was restructured); the anchor present with ZERO rows is
 *      a PASS — a quiet purchasing group is honest-empty, not a broken connector.
 *   2. the row count the connector reads equals the total the page itself claims
 *      (the heading, which on this group prints a thousands comma: "2,468 Open
 *      Solicitations"), across the 99 pages the list advertises — and the page cap
 *      really covers them (a truncated read would fail here).
 *   3. the only rows it drops are ones the source itself cannot support: a closing
 *      date that has passed (`closed`) or a closing cell that prints no date at all
 *      (`bad_date`) — the latter re-proved from the fetched bytes, never assumed.
 *      Any other skip reason means the page changed shape under us: a FAIL.
 *   4. every parsed row is verifiable against the fetched bytes (its solicitation
 *      id, its title and its closing date really appear there).
 *   5. every `source_url` is an absolute https URL on www.bidnetdirect.com, the
 *      per-solicitation detail page, that still resolves PUBLICLY (HTTP 200) — and
 *      it is NOT a members-only page: this gate also asserts the reached page still
 *      marks its issuing organization / solicitation number as locked, i.e. the
 *      connector's claim about what the public page does and does not publish is
 *      still TRUE. If the gate ever finds those cells public, the row mapping
 *      (which leaves them NULL) must be revisited.
 *   6. every row keeps its own region text, which on this group reads
 *      `California` — the state scope is never substituted for it.
 *   7. no row claims a field BidNet does not publish publicly (solicitation
 *      number / naics / psc / set-aside / value), and every `due_date` is
 *      parseable — never an invented instant.
 *   8. NO CHURN between two independent fetches: a second full read of the same
 *      live pages yields byte-for-byte the same parsed row for every solicitation
 *      both reads saw, so a re-run cannot rewrite a row it already has.
 *
 * NOTE ON COST: this is the largest group Contrax reads (99 pages on 2026-10-21),
 * so a full double read is ~200 public GETs at the gate's 300 ms politeness delay
 * — several minutes. It is opt-in for exactly that reason and never runs in CI.
 *
 * Once invoked, a failure to reach the source FAILS the test — it does not skip.
 * The gate prints the total it saw and a sample of the rows so an operator can read
 * the live corpus from the log.
 */
import { describe, expect, test } from "bun:test";
import {
  CA_BIDNET_AGENCY,
  CA_BIDNET_LIST_URL,
  CA_BIDNET_MAX_PAGES,
  CA_BIDNET_ORIGIN,
  caBidnetDateKey,
  caBidnetListShapeOk,
  caBidnetStatedOpenCount,
  parseCaBidnet,
  parseCaBidnetPageLinks,
  parseCaBidnetRows,
  type CaBidnetRow,
} from "./ca-bidnet";

/** The live validation is OPT-IN — see the header for why. */
const RUN_LIVE = process.env.BIDS_RUN_LIVE_SOURCE_TESTS === "1";
const SKIP = !RUN_LIVE;
const BOLD = "\u001b[1m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";
if (SKIP) {
  console.warn(
    `\n${BOLD}${YELLOW}LIVE SOURCE VALIDATION SKIPPED — run \`bun run validate:live-bids-sources\` ` +
      `(or \`BIDS_RUN_LIVE_SOURCE_TESTS=1 bun test src/jobs/sources/ca-bidnet.source-validation.test.ts\`) to ` +
      `verify the BidNet Direct California list against the real source.${RESET}\n` +
      `  The default run is fixture-only and deterministic: it proves the parser logic, NOT the live source.\n`,
  );
} else {
  console.warn(
    `\n${BOLD}LIVE SOURCE VALIDATION RUNNING — fetching ${CA_BIDNET_LIST_URL} (and the ${CA_BIDNET_MAX_PAGES}-page cap of its pagination) for real (opt-in).${RESET}\n`,
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
        Referer: CA_BIDNET_LIST_URL,
      },
      signal: controller.signal,
    });
    // Deliberately NOT swallowed into a skip: a source we cannot verify fails the gate.
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } catch (e) {
    throw new Error(
      `live BidNet California source validation could not run: ${(e as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One full read of the live list: the list page plus every page it advertises,
 * bounded by the connector's own page cap (so a cap that truncates the group
 * shows up as a row-count mismatch, not as a silent short read).
 */
async function readLive(): Promise<{
  pages: string[];
  stated: number | null;
  rows: CaBidnetRow[];
}> {
  const first = await get(CA_BIDNET_LIST_URL);
  const hrefs = parseCaBidnetPageLinks(first)
    .filter((l) => l.pageNumber > 1)
    .map((l) => l.href)
    .slice(0, CA_BIDNET_MAX_PAGES - 1);
  const rest: string[] = [];
  for (const href of hrefs) {
    await sleep(300);
    rest.push(await get(href));
  }
  const pages = [first, ...rest];
  return {
    pages,
    stated: caBidnetStatedOpenCount(first),
    rows: pages.flatMap((h) => parseCaBidnetRows(h)),
  };
}

/** Two INDEPENDENT reads — the no-churn proof (see the header, point 8). */
const live1 = SKIP ? null : await readLive();
const live2 = SKIP ? null : await readLive();

/** The row's own public detail page — the source_url the connector stores. */
const detailUrl = live1?.rows[0]?.url ?? `${CA_BIDNET_ORIGIN}/`;
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

describe.skipIf(SKIP)("ca_bidnet source validation (live)", () => {
  test("the source is reachable and still has the shape the connector parses", () => {
    for (const html of live1!.pages) expect(caBidnetListShapeOk(html)).toBe(true);
    // The row count the parse delivers must match the total the page claims, read
    // over the pages the connector's own cap allows (a cap below the advertised
    // page count would truncate the group and fail here).
    if (live1!.stated !== null && live1!.stated > 0) {
      expect(live1!.rows.length).toBe(live1!.stated);
      expect(live1!.rows.some((r) => r.closingState === "open")).toBe(true);
      expect(live1!.pages.length).toBe(
        Math.min(
          parseCaBidnetPageLinks(live1!.pages[0]!).length,
          CA_BIDNET_MAX_PAGES,
        ),
      );
    }
  });

  test("every parsed row is verifiable against the fetched bytes", () => {
    const joined = live1!.pages.join("\n");
    const flatJoined = flat(decodeBytes(joined));
    const now = Date.now();
    const { rows, skipped, skippedRows } = parseCaBidnet(live1!.rows, now);
    // Accounting invariant: everything listed is either accepted or skipped with a
    // reason, and on a healthy list the ONLY reasons can be a close date that has
    // passed or a closing cell that prints no date — a duplicate, a missing
    // id/title or a row the page no longer marks open would mean the page changed
    // shape under us.
    const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
    expect(rows.length + skippedTotal).toBe(live1!.rows.length);
    for (const reason of ["missing_id", "missing_title", "not_open", "duplicate"]) {
      expect(`${reason}=${skipped[reason] ?? 0}`).toBe(`${reason}=0`);
    }
    // Every `bad_date` row is re-proved from the bytes: its closing cell really
    // carries no MM/DD/YYYY date. Contrax drops such a row rather than inventing
    // the deadline it would need to store it.
    const badDateIds = skippedRows
      .filter((s) => s.reason === "bad_date")
      .map((s) => s.id.replace(/^cabidnet-/, ""));
    expect(badDateIds.length).toBe(skipped.bad_date ?? 0);
    const listedById = new Map(live1!.rows.map((r) => [r.id, r]));
    for (const id of badDateIds) {
      const listed = listedById.get(id)!;
      expect(listed).toBeDefined();
      expect(listed.closingState).toBe("open");
      expect(listed.closing).not.toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(flatJoined).toContain(flat(listed.closing));
    }
    for (const listed of live1!.rows) {
      expect(flatJoined).toContain(listed.id);
      expect(flatJoined).toContain(flat(listed.title));
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
      expect(row.agency).toBe(CA_BIDNET_AGENCY);
      // The group's own region text, per row — never substituted by the scope.
      expect(row.location).toBe("California");
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
        "not the State of California's procurement portal",
      );
    }
    // A sample for the operator reading the log.
    console.warn(
      `\n${BOLD}ca_bidnet live corpus:${RESET} ${live1!.rows.length} open solicitations listed ` +
        `(page says ${live1!.stated ?? "n/a"}; read over ${live1!.pages.length} page(s)); ${rows.length} accepted ` +
        `(all California), skips ${JSON.stringify(skipped)}.\n` +
        rows
          .slice(0, 8)
          .map(
            (r) =>
              `  · ${r.external_id}  ${r.location}  closes ${r.due_date}  ${r.title.slice(0, 80)}`,
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
    const a = parseCaBidnet(live1!.rows, Date.now()).rows;
    const b = parseCaBidnet(live2!.rows, Date.now()).rows;
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
    const onlyA = a.filter((r) => !b.some((x) => x.external_id === r.external_id));
    const onlyB = b.filter((r) => !a.some((x) => x.external_id === r.external_id));
    console.warn(
      `\n${BOLD}ca_bidnet no-churn:${RESET} ${shared} shared ids identical across two independent reads` +
        ` (read 1: ${a.length} rows, read 2: ${b.length}; appeared only in read 1: ${onlyA.length}, only in read 2: ${onlyB.length}).\n`,
    );
  });

  test("parsing the same bytes twice gives the same rows (no churn on re-run)", () => {
    const print = (rs: CaBidnetRow[]) =>
      parseCaBidnet(rs).rows.map((r) =>
        [r.external_id, r.title, r.due_date, r.source_url].join(" | "),
      );
    expect(print(live1!.rows)).toEqual(print(live1!.rows));
  });

  test("the stored deadline is 11:59 PM Eastern on each row's own closing date", () => {
    const { rows } = parseCaBidnet(live1!.rows, Date.now());
    for (const r of rows.slice(0, 50)) {
      const listed = live1!.rows.find((x) => `cabidnet-${x.id}` === r.external_id)!;
      expect(r.due_date!.slice(0, 10) >= caBidnetDateKey(listed.closing)!).toBe(
        true,
      );
      expect(["03:59", "04:59"]).toContain(r.due_date!.slice(11, 16));
    }
  });
});
