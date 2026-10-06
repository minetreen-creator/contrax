/**
 * Texas university JAGGAER tenants (`tx_uh_jaggaer`, `tx_tamu_jaggaer`,
 * `tx_texastech_jaggaer`, `tx_utsa_jaggaer`) and the shared JAGGAER reader's
 * count gates. Zero network, no database: every byte it reads is a committed
 * capture of the live tenant pages in `fixtures/tx-*-jaggaer/` (see their
 * READMEs; `now` is injected everywhere). The one place a fetch happens, its
 * response is stubbed from those same fixtures — no request leaves the process.
 *
 * It also pins THE TWO PAGE SHAPES the family must tolerate (jaggaer-public.ts's
 * header): TAMU's page prints its own "1-21 of 21 Results" total while UH, Texas
 * Tech and UT San Antonio print no total at all. Both are accepted, and the row
 * count is cross-checked either way, so neither shape can silently drop rows.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES, type FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import {
  countJaggaerCloseRows,
  fetchJaggaerBids,
  jaggaerDateToIso,
  parseJaggaerPage,
  readJaggaerEvents,
  type JaggaerConfig,
  type JaggaerParseResult,
} from "./jaggaer-public";
import { MT_EMACS_CONFIG, parseMtEmacsPage } from "./mt-emacs";
import {
  TX_TAMU_JAGGAER_CONFIG,
  TX_TAMU_JAGGAER_COPY,
  TX_TAMU_JAGGAER_URL,
  fetchTxTamuJaggaerBids,
  parseTxTamuJaggaerPage,
} from "./tx-tamu-jaggaer";
import {
  TX_TEXASTECH_JAGGAER_CONFIG,
  TX_TEXASTECH_JAGGAER_COPY,
  TX_TEXASTECH_JAGGAER_URL,
  fetchTxTexasTechJaggaerBids,
  parseTxTexasTechJaggaerPage,
} from "./tx-texastech-jaggaer";
import {
  TX_UH_JAGGAER_CONFIG,
  TX_UH_JAGGAER_COPY,
  TX_UH_JAGGAER_URL,
  fetchTxUhJaggaerBids,
  parseTxUhJaggaerPage,
} from "./tx-uh-jaggaer";
import {
  TX_UTSA_JAGGAER_CONFIG,
  TX_UTSA_JAGGAER_COPY,
  TX_UTSA_JAGGAER_URL,
  fetchTxUtsaJaggaerBids,
  parseTxUtsaJaggaerPage,
} from "./tx-utsa-jaggaer";

const openForBid = (dir: string, date = "2026-10-06") =>
  gunzipSync(readFileSync(new URL(`./fixtures/${dir}/open-for-bid-${date}.html.gz`, import.meta.url))).toString("utf8");

const UH = openForBid("tx-uh-jaggaer");
const TAMU = openForBid("tx-tamu-jaggaer");
const TEXASTECH = openForBid("tx-texastech-jaggaer");
const UTSA = openForBid("tx-utsa-jaggaer");
/** Montana's own committed capture — used only to prove per-tenant keying. */
const MT_EMACS = openForBid("mt-emacs", "2026-10-02");
/** The captures' own instant (2026-10-06 ~05:58Z), before every close date in them. */
const CAPTURED = Date.parse("2026-10-06T05:58:00Z");

interface Tenant {
  cfg: JaggaerConfig;
  html: string;
  parse: (html: string, now?: number) => JaggaerParseResult;
  fetch: (now?: number) => Promise<FetchResult>;
  url: string;
  copy: { publisherLine: string; badge: string; openSetDefinition: string; buyerMixNote: string; timeZoneNote: string; noClaimsLine: string };
  rows: number;
  total: number | null;
}

/** The four tenants, in registry order. */
const TENANTS: Tenant[] = [
  {
    cfg: TX_UH_JAGGAER_CONFIG,
    html: UH,
    parse: parseTxUhJaggaerPage,
    fetch: fetchTxUhJaggaerBids,
    url: TX_UH_JAGGAER_URL,
    copy: TX_UH_JAGGAER_COPY,
    rows: 5,
    total: null,
  },
  {
    cfg: TX_TAMU_JAGGAER_CONFIG,
    html: TAMU,
    parse: parseTxTamuJaggaerPage,
    fetch: fetchTxTamuJaggaerBids,
    url: TX_TAMU_JAGGAER_URL,
    copy: TX_TAMU_JAGGAER_COPY,
    rows: 21,
    total: 21,
  },
  {
    cfg: TX_TEXASTECH_JAGGAER_CONFIG,
    html: TEXASTECH,
    parse: parseTxTexasTechJaggaerPage,
    fetch: fetchTxTexasTechJaggaerBids,
    url: TX_TEXASTECH_JAGGAER_URL,
    copy: TX_TEXASTECH_JAGGAER_COPY,
    rows: 4,
    total: null,
  },
  {
    cfg: TX_UTSA_JAGGAER_CONFIG,
    html: UTSA,
    parse: parseTxUtsaJaggaerPage,
    fetch: fetchTxUtsaJaggaerBids,
    url: TX_UTSA_JAGGAER_URL,
    copy: TX_UTSA_JAGGAER_COPY,
    rows: 2,
    total: null,
  },
];

describe("Texas JAGGAER tenants — parse (captured pages)", () => {
  for (const t of TENANTS) {
    test(`${t.cfg.source}: ${t.rows} listed open events, all accepted, nothing silently dropped`, () => {
      const { rows, skipped, skippedRows, events, total } = t.parse(t.html, CAPTURED);
      expect(total).toBe(t.total);
      expect(events.length).toBe(t.rows);
      expect(skipped).toEqual({});
      expect(skippedRows).toEqual([]);
      expect(rows.length).toBe(t.rows);
      expect(new Set(rows.map((r) => r.external_id)).size).toBe(t.rows);
      for (const r of rows) {
        expect(r.external_id).toMatch(new RegExp(`^${t.cfg.idPrefix}-\\d+$`));
        expect(r.location).toBe("Texas");
        expect(r.agency).toBe(t.cfg.buyerName); // the list names no agency per event; the config's buyer is used
        expect(r.title.trim().length).toBeGreaterThan(0);
        expect(Date.parse(r.due_date!)).toBeGreaterThan(CAPTURED);
        expect(r.source_url).toBe(t.url);
        expect(r.source_url).toContain(`CustomerOrg=${t.cfg.customerOrg}&tab=PHX_NAV_SourcingOpenForBid`);
        // The source publishes none of these — nothing is inferred.
        expect(r.set_aside).toBeNull();
        expect(r.naics_code).toBeNull();
        expect(r.psc).toBeNull();
        // `notice_type` is the portal's own "Type" column (the reader's mapping since
        // mt_emacs) — never null-ed and never invented: every event here states a type.
        expect(r.notice_type).toBe(events.find((e) => r.external_id.endsWith(`-${e.id}`))!.type);
        expect(r.notice_type).not.toBeNull();
        expect(r.solicitation_number!.length).toBeGreaterThan(0);
      }
    });
  }

  test("a row reads exactly as the portal lists it — one spot check per tenant", () => {
    const row = (t: Tenant, id: string) => t.parse(t.html, CAPTURED).rows.find((r) => r.external_id === id)!;

    const uh = row(TENANTS[0]!, "txuhjaggaer-1447662");
    expect(uh.title).toBe("University of Houston Fleet Collision Repair Support FY27");
    expect(uh.solicitation_number).toBe("RFP-730-UofH-3154");
    expect(uh.notice_type).toBe("RFP");
    expect(uh.due_date).toBe("2026-10-23T20:00:00.000Z"); // 10/23/2026, 3:00 PM CDT

    const tamu = row(TENANTS[1]!, "txtamujaggaer-1445622");
    expect(tamu.title).toBe("Campus Sponsorship Asset Valuation");
    expect(tamu.solicitation_number).toBe("04-TARLTON-RFP-0024");
    expect(tamu.notice_type).toBe("RFP");
    expect(tamu.due_date).toBe("2026-10-27T19:00:00.000Z"); // 10/27/2026, 2:00 PM CDT

    const tt = row(TENANTS[2]!, "txtexastechjaggaer-1454062");
    expect(tt.title).toBe("RFP 774-214971517 Recruitment Search Firms");
    expect(tt.solicitation_number).toBe("TTUHSCEP-RFP 774-214971517");
    expect(tt.notice_type).toBe("RFP-EP");
    expect(tt.due_date).toBe("2026-12-02T19:00:00.000Z"); // 12/2/2026, 12:00 PM MST

    const utsa = row(TENANTS[3]!, "txutsajaggaer-1452161");
    expect(utsa.title).toBe("Job Order Design Services on an IDIQ Basis");
    expect(utsa.solicitation_number).toBe("743-2027-RFQ-1562");
    expect(utsa.notice_type).toBe("RFQ");
    expect(utsa.due_date).toBe("2026-10-29T19:30:00.000Z"); // 10/29/2026, 2:30 PM CDT
  });

  test("the description states the type, the number and the portal — and never a contact", () => {
    for (const t of TENANTS) {
      for (const r of t.parse(t.html, CAPTURED).rows) {
        expect(r.description).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        expect(r.description).not.toMatch(/phx|div|href/i);
        expect(r.description).toContain(r.solicitation_number!);
        expect(r.description).toContain("(see source link)");
      }
    }
  });
});

describe("JAGGAER page shapes — a numeric total AND no total are both normal", () => {
  test("TAMU prints its own total (a NUMBER, not null) and it matches the rows parsed", () => {
    const { events, total } = readJaggaerEvents(TAMU);
    expect(total).toBe(21);
    expect(typeof total).toBe("number");
    expect(events.length).toBe(total!);
    expect(countJaggaerCloseRows(TAMU)).toBe(events.length);
  });

  test("UH, Texas Tech and UT San Antonio print NO total — and the rows are still cross-checked", () => {
    for (const t of TENANTS.filter((x) => x.total === null)) {
      const { events, total } = readJaggaerEvents(t.html);
      expect(total).toBeNull();
      // The independent count (one labelled Close cell per rendered row) still pins
      // the row count — that is what keeps a truncated page from passing silently.
      expect(countJaggaerCloseRows(t.html)).toBe(events.length);
      expect(events.length).toBe(t.rows);
      expect(t.html).toContain("PHX_NAV_SourcingOpenForBid"); // the tab marker the gate requires
    }
  });

  test("countJaggaerCloseRows counts rendered rows, not parser state", () => {
    expect(countJaggaerCloseRows(UH)).toBe(5);
    expect(countJaggaerCloseRows(TAMU)).toBe(21);
    expect(countJaggaerCloseRows(TEXASTECH)).toBe(4);
    expect(countJaggaerCloseRows(UTSA)).toBe(2);
    expect(countJaggaerCloseRows("<html>no rows here</html>")).toBe(0);
  });
});

describe("JAGGAER fetch gate — both shapes pass, a changed page fails loudly", () => {
  const realFetch = globalThis.fetch;
  const stub = (body: string, status = 200) => {
    globalThis.fetch = (async () => new Response(body, { status })) as unknown as typeof fetch;
  };
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  test("a short page with no printed total is accepted (UH)", async () => {
    stub(UH);
    const r = await fetchJaggaerBids(TX_UH_JAGGAER_CONFIG, CAPTURED);
    expect(r.rows.length).toBe(5);
    expect(r.skipped).toEqual({});
  });

  test("a page that prints a numeric total is accepted (TAMU)", async () => {
    stub(TAMU);
    const r = await fetchJaggaerBids(TX_TAMU_JAGGAER_CONFIG, CAPTURED);
    expect(r.rows.length).toBe(21);
    expect(r.skipped).toEqual({});
  });

  test("every tenant fetches end to end from its own captured bytes", async () => {
    for (const t of TENANTS) {
      stub(t.html);
      const r = await t.fetch(CAPTURED);
      expect(r.rows.length).toBe(t.rows);
    }
  });

  test("a page that is not the Open for Bid listing fails closed", async () => {
    stub(UH.replaceAll("PHX_NAV_SourcingOpenForBid", "PHX_NAV_SomethingElse"));
    await expect(fetchJaggaerBids(TX_UH_JAGGAER_CONFIG, CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });

  test("a page whose rows were cut fails closed — on BOTH shapes", async () => {
    // No printed total (UH): one row's Close cell is gone, so the independent count
    // no longer matches what the parser read.
    stub(UH.replace("SourcingPublicSite_LABEL_CLOSE", "SourcingPublicSite_LABEL_END"));
    await expect(fetchJaggaerBids(TX_UH_JAGGAER_CONFIG, CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
    // Printed total (TAMU): one row is removed, so 20 parsed rows ≠ "of 21 Results".
    stub(TAMU.replace(/<tr>\s*<td[^>]*>\s*<span class="[^"]*status-badge[\s\S]*?<\/tr>/i, ""));
    await expect(fetchJaggaerBids(TX_TAMU_JAGGAER_CONFIG, CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });

  test("a non-200 answer fails closed", async () => {
    stub("<html>nope</html>", 503);
    await expect(fetchJaggaerBids(TX_TEXASTECH_JAGGAER_CONFIG, CAPTURED)).rejects.toBeInstanceOf(SourceUnreachableError);
  });
});

describe("Texas JAGGAER tenants — dates carry the zone the portal prints", () => {
  test("Central and Mountain instants from these pages", () => {
    expect(jaggaerDateToIso("10/23/2026, 3:00 PM CDT")).toBe("2026-10-23T20:00:00.000Z");
    expect(jaggaerDateToIso("10/16/2026, 4:00 PM CDT")).toBe("2026-10-16T21:00:00.000Z");
    expect(jaggaerDateToIso("12/2/2026, 12:00 PM MST")).toBe("2026-12-02T19:00:00.000Z");
    // The rule is the reader's: a zone the page does not print is never guessed.
    expect(jaggaerDateToIso("10/23/2026, 3:00 PM")).toBeNull();
    expect(jaggaerDateToIso("10/23/2026, 3:00 PM XYZ")).toBeNull();
  });

  test("every accepted row's due_date is exactly the instant its page printed", () => {
    for (const t of TENANTS) {
      const parsed = t.parse(t.html, CAPTURED);
      expect(parsed.rows.length).toBe(parsed.events.length); // nothing skipped in these captures
      for (const e of parsed.events) {
        const r = parsed.rows.find((x) => x.external_id.endsWith(`-${e.id}`))!;
        expect(r.due_date).toBe(jaggaerDateToIso(e.close));
      }
    }
  });
});

describe("Texas JAGGAER tenants — the write path pins Texas on every row", () => {
  for (const t of TENANTS) {
    test(`${t.cfg.source}: every row is classified TX, never text-derived from the buyer name`, () => {
      for (const r of t.parse(t.html, CAPTURED).rows) {
        const cols = deriveInsertLocationColumns({
          location: r.location,
          agency: r.agency,
          title: r.title,
          description: r.description,
          sourceName: t.cfg.source,
        });
        expect(cols.source_jurisdiction).toBe("TX");
        expect(cols.normalized_state).toBe("TX");
        expect(cols.raw_location).toBe("Texas");
        expect(cols.location_conflict).toBe(false);
      }
    });
  }
});

describe("JAGGAER readers — one reader, per-tenant identity (no cross-tenant collision)", () => {
  test("the four Texas tenants and mt_emacs are five distinct labels and prefixes", () => {
    const configs = [...TENANTS.map((t) => t.cfg), MT_EMACS_CONFIG];
    expect(new Set(configs.map((c) => c.source)).size).toBe(5);
    expect(new Set(configs.map((c) => c.idPrefix)).size).toBe(5);
  });

  test("the SAME bytes through two tenants stay two rows, two ids, two portals", () => {
    // JAGGAER event ids come from ONE numeric space shared by every tenant, so the
    // same id must never produce the same external_id or the same source_url twice.
    const asUh = parseJaggaerPage(TX_UH_JAGGAER_CONFIG, UH, CAPTURED).rows;
    const asTamu = parseJaggaerPage(TX_TAMU_JAGGAER_CONFIG, UH, CAPTURED).rows; // UH's bytes, TAMU's config
    const asMt = parseJaggaerPage(MT_EMACS_CONFIG, UH, CAPTURED).rows;
    expect(asUh.length).toBe(asTamu.length);
    for (let i = 0; i < asUh.length; i++) {
      const id = asUh[i]!.external_id.split("-").pop();
      expect(asUh[i]!.external_id).toBe(`txuhjaggaer-${id}`);
      expect(asTamu[i]!.external_id).toBe(`txtamujaggaer-${id}`);
      expect(asMt[i]!.external_id).toBe(`mtemacs-${id}`);
      expect(new Set([asUh[i]!.external_id, asTamu[i]!.external_id, asMt[i]!.external_id]).size).toBe(3);
      expect(asUh[i]!.source_url).toContain("CustomerOrg=UH");
      expect(asTamu[i]!.source_url).toContain("CustomerOrg=TAMU");
      expect(asMt[i]!.source_url).toContain("CustomerOrg=StateOfMontana");
      // Same portal host for all of them — the id prefix, not the host, is the key.
      expect(new URL(asUh[i]!.source_url).host).toBe(new URL(asMt[i]!.source_url).host);
    }
    // Today's four Texas captures share no event id (measured, not guaranteed).
    const ids = TENANTS.map((t) => t.parse(t.html, CAPTURED).events.map((e) => e.id));
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++) expect(ids[a]!.filter((id) => ids[b]!.includes(id))).toEqual([]);
  });

  test("every accepted row really carries its own tenant's prefix", () => {
    for (const t of TENANTS) {
      for (const r of t.parse(t.html, CAPTURED).rows) {
        expect(r.external_id.startsWith(`${t.cfg.idPrefix}-`)).toBe(true);
      }
    }
  });

  test("the Montana tenant is untouched by this batch", () => {
    const rows = parseMtEmacsPage(MT_EMACS, CAPTURED).rows;
    expect(rows.every((r) => r.external_id.startsWith("mtemacs-"))).toBe(true);
    expect(rows.every((r) => r.location === "Montana")).toBe(true);
    expect(rows.every((r) => r.source_url === "https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=StateOfMontana&tab=PHX_NAV_SourcingOpenForBid")).toBe(true);
  });
});

describe("Texas JAGGAER tenants — registration (tail sources, TX home jurisdiction, state badge)", () => {
  test("all four are tail sources with their own fetchFn, and no label is duplicated", () => {
    const names = TAIL_SOURCES.map((s) => s.name);
    for (const t of TENANTS) {
      expect(names).toContain(t.cfg.source);
      expect(TAIL_SOURCES.find((s) => s.name === t.cfg.source)!.fetchFn).toBe(t.fetch);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  test("class `state`, scope TX, state-portal scope, non-federal badge (R5/R8)", () => {
    for (const t of TENANTS) {
      expect(SOURCE_CLASSES[t.cfg.source]).toEqual({
        class: "state",
        scopeState: "TX",
        searchScope: "state-portal",
        recordType: "opportunity",
      });
      expect(isStateLocalSource([t.cfg.source])).toBe(true);
      expect(sourceBadgeLabel(t.cfg.source)).toBe("State (TX)");
      expect(SOURCE_HOME_JURISDICTIONS[t.cfg.source]).toBe("TX");
      expect(t.copy.badge).toBe("State (TX)");
    }
  });

  test("the badge is the class's, never the buyer string", () => {
    // A university is STATE because it is a Texas public body's own portal, not
    // because a free-text buyer name says "university".
    for (const t of TENANTS) expect(sourceBadgeLabel(t.cfg.source)).toBe(sourceBadgeLabel("tx_txdot_bonfire"));
  });

  test("the honest copy is exported, and it does not claim coverage", () => {
    for (const t of TENANTS) {
      expect(t.copy.publisherLine).toContain("Open solicitations as published by");
      expect(t.copy.openSetDefinition).toContain("close date that has not passed");
      expect(t.copy.timeZoneNote).toContain("time zone the portal prints");
      expect(t.copy.noClaimsLine).toContain("does not warrant");
      expect(t.copy.noClaimsLine).toContain("official source");
      expect(t.copy.buyerMixNote).toMatch(/verbatim/);
    }
    expect(TX_TAMU_JAGGAER_COPY.publisherLine).toContain("Texas A&M University");
    expect(TX_UH_JAGGAER_COPY.publisherLine).toContain("University of Houston");
    expect(TX_TEXASTECH_JAGGAER_COPY.publisherLine).toContain("Texas Tech");
    expect(TX_UTSA_JAGGAER_COPY.publisherLine).toContain("The University of Texas at San Antonio");
  });
});
