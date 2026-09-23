/**
 * City of Dayton bid board (`oh_dayton`) — Ohio Phase 3 connector pins.
 *
 * DETERMINISTIC, ZERO NETWORK, NO DATABASE. Every byte read here is a VERBATIM
 * fixture captured from the official City of Dayton board on 2026-09-23 (see
 * fixtures/dayton/README.md for provenance, byte sizes and per-fetch md5s); the
 * connector's `parseDaytonBoard` is a pure function, and the defensive `closed`
 * guard takes an INJECTED reference instant, so no assertion depends on the wall
 * clock. Live-source validation is a separate, explicitly-invoked check
 * (`bun run validate:live-bids-sources`, opt-in via BIDS_RUN_LIVE_SOURCE_TESTS=1).
 *
 * What the pins defend (spec R1–R17):
 *   R1  Status:/Closes: labels vs VALUES (two child divs) — the naive read
 *       returns the label text.
 *   R3  the `Bid No.` span starts at column 0 (no indentation) — anchored on
 *       `<strong>` only.
 *   R4  the `Bid No.` line is optional (row 639 has none) → null, never invented.
 *   R5  the two sentinel strings ("Upon Contract" list / "Open Until Contracted"
 *       detail) both mean NULL — no sentinel lookup table.
 *   R7  the source's truncated "Read on" affordance is stripped, the source's own
 *       "…" is preserved.
 *   R9  group order is not stable → the category comes from the preceding header.
 *   R10 row classes alternate (`bid` / `bid alt`) → matched on the prefix.
 *   R11/R16 a missing item-region anchor (which is EXACTLY what a query-param GET
 *       returns: HTTP 200, no container) → zero rows + a loud reason, never a
 *       partial parse.
 *   R17 the timezone decision (documented in oh-dayton.ts): option (a), the
 *       shared `toIsoDueDate`, so the exact instants are pinned only when the
 *       ambient zone is UTC (CI / production sync) and the DATE is pinned always.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isStateLocalSource, NON_STATE_LOCAL_SOURCES, sourceBadgeLabel } from "~/lib/cert-matching";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { expandTrade } from "~/lib/trade-registry";
import { TAIL_SOURCES } from "../runner";
import {
  DAYTON_AGENCY,
  DAYTON_ENDPOINT,
  DAYTON_LOCATION,
  daytonCategory,
  daytonSetAside,
  fetchOhDaytonBids,
  parseDaytonBoard,
} from "./oh-dayton";

const DIR = new URL("./fixtures/dayton/", import.meta.url);
function fixture(name: string): string {
  return readFileSync(new URL(name, DIR), "utf8");
}

const FETCH_NAMES = [
  "bids-open-2026-09-23-fetch1.html",
  "bids-open-2026-09-23-fetch2.html",
  "bids-open-2026-09-23-fetch3.html",
  "bids-open-2026-09-23-fetch4.html",
];
const F1 = fixture(FETCH_NAMES[0]);
/** The real `?showAllBids=true&Status=all` response: HTTP 200, item container
 *  absent (the "fails quietly" mode this connector must never parse as empty). */
const QUERY_PARAM_EMPTY = fixture("bids-open-query-param-empty-2026-09-23.html");

/** Reference instant inside the capture window — the `closed` guard's `now`. */
const REF_NOW = Date.parse("2026-09-23T03:00:00Z");
/** R17 option (a): `toIsoDueDate` uses the RUNTIME's zone, so the exact instants
 *  are only asserted where the environment is UTC (GH Actions, the sync runner).
 *  The DATE part is asserted in every zone. */
const TZ_IS_UTC = !process.env.TZ || /^utc|^etc\/utc|^zulu$/i.test(process.env.TZ);

/** The §6-A table: the five open rows, verbatim from the saved bytes. */
const EXPECTED = [
  {
    bidID: "1306",
    bidNo: "IFB 26057Z",
    title: "IFB 26057Z Bomb Squad Equipment and Replacement Parts",
    closes: "10/6/2026 10:00 AM",
    group: "Procurement",
    category: "Supplies & Equipment",
    utcInstant: "2026-10-06T10:00:00.000Z",
  },
  {
    bidID: "1307",
    bidNo: "IFB 26058JF",
    title: "IFB 26058JF Public Safety Bomb Suit Accessories II",
    closes: "10/6/2026 3:00 PM",
    group: "Procurement",
    category: "Other",
    utcInstant: "2026-10-06T15:00:00.000Z",
  },
  {
    bidID: "1309",
    bidNo: "IFB 26060Z",
    title: "IFB 26060Z Custom 5 Cubic Yard Dumpster Liners",
    closes: "10/6/2026 3:00 PM",
    group: "Procurement",
    category: "Other",
    utcInstant: "2026-10-06T15:00:00.000Z",
  },
  {
    bidID: "1308",
    bidNo: "IFB S27001",
    title: "IFB S27001 Evidence of Real Estate Ownership and Title Reporting Services",
    closes: "10/6/2026 3:00 PM",
    group: "Procurement",
    category: "Other",
    utcInstant: "2026-10-06T15:00:00.000Z",
  },
  {
    bidID: "639",
    bidNo: null,
    title: "Engineering & Construction Bid Postings Have Moved!",
    closes: "Upon Contract",
    group: "Engineering & Construction",
    category: "Construction",
    utcInstant: null,
  },
];

const ORDER = ["639", "1306", "1307", "1309", "1308"]; // document order of the saved fetch

/** The doc-order content fingerprint used for the no-churn comparison — the same
 *  tuple method the probe used (never a raw-HTML hash: the bytes legitimately
 *  differ between fetches in the volatile ASP.NET scaffolding). */
function fingerprint(html: string): string[] {
  const r = parseDaytonBoard(html, REF_NOW);
  return r.parsed.map((p) => [p.group, p.bidID, p.bidNo, p.title, p.status, p.closes].join(" | "));
}

describe("oh_dayton — parsed rows from the saved verbatim board", () => {
  test("the saved bytes yield the 5 open rows the CSV/extractor recorded", () => {
    const res = parseDaytonBoard(F1, REF_NOW);
    expect(res.skipped).toEqual({});
    expect(res.parsed.map((p) => p.bidID)).toEqual(ORDER);
    expect(res.rows.length).toBe(5);

    for (const exp of EXPECTED) {
      const row = res.parsed.find((p) => p.bidID === exp.bidID)!;
      expect(row).toBeTruthy();
      expect(row.title).toBe(exp.title);
      expect(row.closes).toBe(exp.closes);
      expect(row.status).toBe("Open"); // R1: the VALUE, never the "Status:" label
      expect(row.group).toBe(exp.group); // R9: from the preceding header
      expect(row.sourceUrl).toBe(`${DAYTON_ENDPOINT}?bidID=${exp.bidID}`);
      // R3/R4: the Bid No. line (present at column 0, or absent) is trimmed exactly.
      expect(row.bidNo).toBe(exp.bidNo);

      const raw = res.rows.find((b) => b.external_id === `dayton-${exp.bidID}`)!;
      expect(raw).toBeTruthy();
      expect(raw.external_id).toBe(`dayton-${exp.bidID}`);
      expect(raw.title).toBe(exp.title);
      expect(raw.location).toBe(DAYTON_LOCATION);
      expect(raw.agency).toBe(DAYTON_AGENCY);
      expect(raw.estimated_value).toBe("Not specified");
      expect(raw.category).toBe(exp.category);
      // Nothing is inferred for a source that supplies none of these.
      expect(raw.naics_code).toBeNull();
      expect(raw.psc).toBeNull();
      expect(raw.notice_type).toBeNull();
      expect(raw.solicitation_number).toBeNull();
      expect(raw.set_aside).toBeNull();
      expect(raw.source_label).toBeUndefined(); // the runner stamps source.name
      // R17: the DATE is zone-independent …
      if (exp.utcInstant) {
        expect(raw.due_date).not.toBeNull();
        expect(String(raw.due_date).slice(0, 10)).toBe("2026-10-06");
      }
      // … and the exact instant is pinned where the sync environment is UTC.
      if (TZ_IS_UTC) expect(raw.due_date).toBe(exp.utcInstant);
      else expect(raw.due_date).toBe(new Date(exp.closes).toISOString());
    }
  });

  test("R1 — the Status:/Closes: LABELS are in the row while the parsed values are the VALUES", () => {
    // The two-child-div trap, documented against the saved bytes: both labels are
    // present, and the values live in the sibling div.
    expect(F1).toContain('<span id="BidStatus130619">Status:</span>');
    expect(F1).toContain('<span id="BidCloses130619">Closes:</span>');
    expect(F1).toMatch(/<div>\s*<span>Open<\/span>/);
    const res = parseDaytonBoard(F1, REF_NOW);
    for (const p of res.parsed) {
      expect(p.status).not.toBe("Status:");
      expect(p.closes).not.toBe("Closes:");
    }
  });

  test("R4/R7 — the Bid-No.-less row keeps its trimmed description without the 'Read on' artifact", () => {
    const res = parseDaytonBoard(F1, REF_NOW);
    const row = res.parsed.find((p) => p.bidID === "639")!;
    expect(row.bidNo).toBeNull(); // never synthesized from the title
    expect(row.description).not.toMatch(/Read\s*on/i);
    expect(row.description).not.toContain("visuallyHidden");
    expect(row.description).not.toMatch(/\[\s*\]/);
    // The source's OWN truncation marker is preserved verbatim (we do not
    // "complete" the sentence it cut off).
    expect(row.description).toContain("Engineering and Construction...");
    // And an ordinary row keeps its source text byte-for-byte.
    const r1306 = res.parsed.find((p) => p.bidID === "1306")!;
    expect(r1306.description).toBe(
      "Electronic bids are due by October 6, 2026 no later than 10:00 AM (Dayton Local Time).",
    );
  });

  test("R3 — the column-0 'Bid No.' span parses, and extra whitespace never leaks into the value", () => {
    const res = parseDaytonBoard(F1, REF_NOW);
    for (const p of res.parsed) {
      if (p.bidNo == null) continue;
      expect(p.bidNo).toBe(p.bidNo.trim());
      expect(p.bidNo).toMatch(/^IFB /);
    }
    // Same page with tab/newline padding around the value (what an indentation
    // shift would produce): still the trimmed value, never "\n  IFB 26057Z\t ".
    const padded = F1.replace(
      "<strong>Bid No.</strong> IFB 26057Z</span>",
      "<strong>Bid No.</strong>\n\t\t   IFB 26057Z\t </span>",
    );
    expect(padded).not.toBe(F1);
    const r = parseDaytonBoard(padded, REF_NOW).rows.find((b) => b.external_id === "dayton-1306")!;
    expect(r).toBeTruthy();
    expect(F1).not.toContain("<strong>Bid No.</strong>\n"); // the raw fixture keeps column-0 shape
    expect(parseDaytonBoard(padded, REF_NOW).parsed.find((p) => p.bidID === "1306")!.bidNo).toBe(
      "IFB 26057Z",
    );
  });

  test("every source_url is ABSOLUTE, carries the bidID, and every external_id is dayton-<bidID>", () => {
    const res = parseDaytonBoard(F1, REF_NOW);
    for (const b of res.rows) {
      expect(b.source_url).toBe(
        `https://www.daytonohio.gov/bids.aspx?bidID=${b.external_id.replace("dayton-", "")}`,
      );
      expect(b.source_url.startsWith("https://www.daytonohio.gov/")).toBe(true);
    }
  });

  test("NO pagination: one item container, every row block parsed, nothing held back for a 'next page'", () => {
    expect(F1.match(/<div class="bidItems listItems">/g)!.length).toBe(1);
    expect(F1.match(/<div class="listItemsRow\s+bid/g)!.length).toBe(5);
    expect(F1.match(/listItemsRow\s+bid\s+alt/g)!.length).toBe(2); // R10 zebra classes
    const res = parseDaytonBoard(F1, REF_NOW);
    expect(res.rows.length).toBe(5); // all 5 emitted: no pager, no partial window
    expect(res.parsed.length).toBe(5);
  });

  test("all four saved fetches give the SAME parsed fingerprint (content stability, no churn)", () => {
    const prints = FETCH_NAMES.map((n) => fingerprint(fixture(n)));
    const sizes = FETCH_NAMES.map((n) => fixture(n).length);
    // Byte LENGTH is identical across fetches; the bytes are not (volatile
    // VIEWSTATE / session / per-request BidStatus id) — so the pin is the parse.
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBeGreaterThan(50_000);
    for (const p of prints) expect(p).toEqual(prints[0]);
    expect(prints[0].length).toBe(5);
  });

  test("R11 — the real query-param response (HTTP 200, no item container) parses as ZERO rows + a loud reason", () => {
    expect(QUERY_PARAM_EMPTY.length).toBeGreaterThan(50_000);
    expect(QUERY_PARAM_EMPTY).not.toContain('<div class="bidItems listItems">');
    const res = parseDaytonBoard(QUERY_PARAM_EMPTY, REF_NOW);
    expect(res.rows).toEqual([]);
    expect(res.parsed).toEqual([]);
    expect(res.skipped).toEqual({ shape_change: 1 }); // silent to a user, loud in the run log
  });
});

describe("oh_dayton — group/category integrity (R9, §2.5 id cross-check)", () => {
  test("row 639 is categorized from its own preceding header, and the no-Bid-No row survives", () => {
    const res = parseDaytonBoard(F1, REF_NOW);
    const first = res.parsed[0];
    expect(first.bidID).toBe("639"); // group order flips between days — never assumed
    expect(first.group).toBe("Engineering & Construction");
    expect(first.groupCountText).toBe("1 Bid");
    expect(res.rows.find((b) => b.external_id === "dayton-639")!.category).toBe("Construction");
    for (const p of res.parsed.filter((p) => p.bidID !== "639")) {
      expect(p.group).toBe("Procurement");
      expect(p.groupCountText).toBe("4 Bids");
    }
  });

  test("the BidStatus<bidID><CatID> id cross-check holds on the saved bytes", () => {
    // 639 + CatID 18 (Engineering & Construction); 1306 + CatID 19 (Procurement).
    expect(F1).toContain('<span id="BidStatus63918">Status:</span>');
    expect(F1).toContain('<span id="BidStatus130619">Status:</span>');
    expect(F1).toContain('<option value="18">Engineering & Construction</option>');
    expect(F1).toContain('<option value="19">Procurement</option>');
    expect(parseDaytonBoard(F1, REF_NOW).skipped).toEqual({});
  });

  test("a mismatched id fails LOUDLY (row dropped, reason coded) instead of mis-grouping silently", () => {
    const mutated = F1.replace('id="BidStatus63918"', 'id="BidStatus63919"');
    expect(mutated).not.toBe(F1);
    const res = parseDaytonBoard(mutated, REF_NOW);
    expect(res.skipped).toEqual({ id_catid_mismatch: 1 });
    expect(res.skippedRows).toEqual([{ id: "dayton-639", reason: "id_catid_mismatch" }]);
    expect(res.rows.some((b) => b.external_id === "dayton-639")).toBe(false);
    expect(res.rows.length).toBe(4); // the other four rows are untouched
  });
});

describe("oh_dayton — price/date guards are honest (R5/R6, no invented dates)", () => {
  test("a NULL due_date row is EMITTED, not dropped", () => {
    const res = parseDaytonBoard(F1, REF_NOW);
    const open = res.rows.find((b) => b.external_id === "dayton-639")!;
    expect(open.due_date).toBeNull();
    expect(String(open.description).length).toBeGreaterThan(0);
  });

  test("BOTH open-ended sentinels (list + detail wording) → due_date null, row still emitted", () => {
    for (const sentinel of ["Upon Contract", "Open Until Contracted"]) {
      const html = F1.replace("Upon Contract", sentinel);
      expect(html).toContain(sentinel);
      const res = parseDaytonBoard(html, REF_NOW);
      const row = res.rows.find((b) => b.external_id === "dayton-639")!;
      expect(row.due_date).toBeNull();
      expect(res.rows.length).toBe(5);
      expect(res.skipped).toEqual({});
    }
  });

  test("any NON-DATE closes value → null (never a fabricated instant)", () => {
    for (const garbage of ["TBD", "See solicitation", "N/A", "12/31/2999-ish"]) {
      const res = parseDaytonBoard(F1.replace("Upon Contract", garbage), REF_NOW);
      expect(res.rows.find((b) => b.external_id === "dayton-639")!.due_date).toBeNull();
      expect(res.rows.length).toBe(5);
    }
  });

  test("a genuinely past-due row is dropped with reason 'closed' (defensive, deterministic)", () => {
    const res = parseDaytonBoard(F1.replace("Upon Contract", "1/2/2020 10:00 AM"), REF_NOW);
    expect(res.skipped).toEqual({ closed: 1 });
    expect(res.skippedRows).toEqual([{ id: "dayton-639", reason: "closed" }]);
    expect(res.rows.length).toBe(4);
    // …and the same row is KEPT when the reference instant precedes it.
    const before = parseDaytonBoard(
      F1.replace("Upon Contract", "10/6/2026 10:00 AM"),
      Date.parse("2026-10-06T09:00:00Z"),
    );
    expect(before.rows.length).toBe(5);
  });
});

describe("oh_dayton — shape/status guards fail safe (R11/R16)", () => {
  test("empty or anchor-less HTML → ZERO rows, reason coded, no throw", () => {
    for (const html of ["", "<html></html>", "<html><body><p>maintenance</p></body></html>"]) {
      const res = parseDaytonBoard(html, REF_NOW);
      expect(res.rows).toEqual([]);
      expect(res.parsed).toEqual([]);
      expect(res.skipped).toEqual({ shape_change: 1 });
    }
  });

  test("the item region without its closing script anchor also fails safe (never a partial parse)", () => {
    const truncated = F1.slice(0, F1.indexOf("function submitBidForm"));
    const res = parseDaytonBoard(truncated, REF_NOW);
    expect(res.rows).toEqual([]);
    expect(res.skipped).toEqual({ shape_change: 1 });
  });

  test("a row whose Status is not 'Open' is skipped (defensive against the page default changing)", () => {
    const html = F1.replace("<span>Open</span>", "<span>Closed</span>");
    expect(html).not.toBe(F1);
    const res = parseDaytonBoard(html, REF_NOW);
    expect(res.skipped).toEqual({ not_open: 1 });
    expect(res.rows.length).toBe(4);
    // The row was still READ (parsed) — the guard, not the parser, dropped it.
    expect(res.parsed.length).toBe(5);
  });
});

describe("oh_dayton — trade classification goes through the SHARED classifier", () => {
  test("the owner's cleaning-services phrase resolves through the connector, not a local regex", () => {
    // AD26016 is a real Dayton title captured by the 09-21 probe (it has since
    // closed and is NOT in the saved board) — used here as a classifier fixture only.
    expect(daytonCategory("IFB AD26016 Industrial Electrical Cleaning Services", "")).toBe(
      "Janitorial",
    );
    // The already-curated synonyms stay curated (no re-adding, no duplicates).
    expect(expandTrade("cleaning services").naicsCodes).toContain("561720");
    expect(expandTrade("sanitation").naicsCodes).toContain("561720");
    expect(expandTrade("cleaning").naicsCodes).toEqual([]); // bare "cleaning" stays BLOCKED
  });

  test("a product purchase never becomes a service trade (the product veto still applies)", () => {
    // 1309 is a dumpster-LINER purchase: a waste-container consumable, NOT a
    // solid-waste service. It must not land in Janitorial or Transportation.
    expect(daytonCategory("IFB 26060Z Custom 5 Cubic Yard Dumpster Liners", "")).toBe("Other");
    for (const b of parseDaytonBoard(F1, REF_NOW).rows) {
      expect(["Janitorial", "Transportation"]).not.toContain(b.category);
    }
  });

  test("set_aside is set ONLY when the source text literally states a program", () => {
    expect(daytonSetAside("IFB 26057Z Bomb Squad Equipment and Replacement Parts")).toBeNull();
    expect(daytonSetAside("A municipal bid from the City of Dayton")).toBeNull(); // never inferred
    expect(daytonSetAside("Small Business set-aside")).toBe("Small Business set-aside");
    expect(daytonSetAside("(SDVOSB) preferred")).toBe("SDVOSB");
    expect(daytonSetAside("8(a) sole source")).toBe("8(a)");
    // Today's board states none at all.
    for (const b of parseDaytonBoard(F1, REF_NOW).rows) expect(b.set_aside).toBeNull();
  });
});

describe("oh_dayton — registration (runner tail source + jurisdiction + non-federal badge)", () => {
  test("TAIL_SOURCES carries oh_dayton as its 7th… of 7 (6 → 7 with this connector)", () => {
    expect(TAIL_SOURCES.length).toBe(6) // PR-1: nys_socrata retired;
    expect(TAIL_SOURCES.map((s) => s.name)).toContain("oh_dayton");
    expect(TAIL_SOURCES.find((s) => s.name === "oh_dayton")!.fetchFn).toBe(fetchOhDaytonBids);
    expect(new Set(TAIL_SOURCES.map((s) => s.name)).size).toBe(TAIL_SOURCES.length);
  });

  test("the curated home jurisdiction is OH by construction (not text-derived)", () => {
    expect(SOURCE_HOME_JURISDICTIONS.oh_dayton).toBe("OH");
    expect(SOURCE_HOME_JURISDICTIONS.pennbid).toBe("PA");
    expect(SOURCE_HOME_JURISDICTIONS.va_evirginia).toBe("VA");
    // The write path consumes the map: source_jurisdiction is curated, while
    // normalized_state would be OH anyway (belt and braces, spec §3.7).
    const cols = deriveInsertLocationColumns({
      location: DAYTON_LOCATION,
      agency: DAYTON_AGENCY,
      title: "IFB 26057Z Bomb Squad Equipment and Replacement Parts",
      description: "Electronic bids are due by October 6, 2026 no later than 10:00 AM.",
      sourceName: "oh_dayton",
    });
    expect(cols.source_jurisdiction).toBe("OH");
    expect(cols.normalized_state).toBe("OH");
    expect(cols.raw_location).toBe("Dayton, OH");
    expect(cols.location_conflict).toBe(false);
  });

  test("a NEW state/local source needs no cert-matching change — and is NOT relabelled Federal", () => {
    expect(NON_STATE_LOCAL_SOURCES.has("oh_dayton")).toBe(false); // deny-list: absent = state/local
    expect(isStateLocalSource(["oh_dayton"])).toBe(true); // rule 3: NULL set-aside is pursuable
    expect(sourceBadgeLabel("oh_dayton")).toBe("Dayton"); // PR-1: a LOCAL row is badged with its city
  });
});
