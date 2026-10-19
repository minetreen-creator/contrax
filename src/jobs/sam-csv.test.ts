/**
 * SAM.gov nightly CSV ingest — parser / filter / mapping tests.
 *
 * FIXTURE (repo convention: saved official-source payload, PII-redacted, sha256
 * recorded — WORKFLOW.md §Test determinism): `fixtures/sam-csv-head.csv` is a
 * BYTE-RANGE SAMPLE of the real source, not a hand-written example:
 *
 *   curl -sSL -r 0-40000 'https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv'
 *
 * captured 2026-10-19 (extract dated 2026-10-17), then PII-redacted with
 * Python's csv module (Title/Fullname/Email/Phone/Fax/Awardee set to REDACTED;
 * the byte-range slice's truncated final record dropped).
 *   sha256(src/jobs/fixtures/sam-csv-head.csv) =
 *   be12c7d7cc9261aa446113d9efc605d1851ccdc10077a1b0cc35f05712beb2e5
 *   (12 records + the verbatim header.)
 *
 * The 200 MB file itself is NEVER committed (spec §Tests).
 *
 * ZERO NETWORK: every test below runs off that fixture or off in-memory strings.
 * Live-source validation is a separate, opt-in command documented in the PR
 * (WORKFLOW.md guardrail: the default suite never fetches).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ALL_COUNTER_STATES,
  createCsvRecordStream,
  csvBidChangeTuple,
  csvHeaderIndex,
  csvNoticeToBid,
  csvSetAsideLabel,
  dedupeKeptRowsByNaturalKey,
  describeStateSetChange,
  isAwardOrJustificationType,
  isOpenDeadline,
  parseDeadline,
  parseSamCsvRecord,
  keptRowCounterStats,
  NATURAL_KEY_INDEX,
  NATURAL_KEY_SCOPE_SQL,
  projectStates,
  samCsvExternalId,
  samCsvNaturalKey,
  stateOpenCountDeltas,
  shouldCloseOut,
  stateCodeFromLocation,
} from "./sam-csv";
import { NATURAL_KEY_GUARD_SQL, readSamCsv } from "./sam-csv-ingest";

const FIXTURE = readFileSync(new URL("./fixtures/sam-csv-head.csv", import.meta.url), "utf8");

/** Feed a whole CSV text to the job's own stream reader, chunked like `curl` does. */
async function* chunks(text: string): AsyncIterable<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += 8192) yield bytes.slice(i, i + 8192);
}

/** Parse a whole fixture/string into notices, exactly as the job does. */
function parseAll(text: string) {
  const stream = createCsvRecordStream();
  const records = [...stream.push(text), ...stream.end()];
  let index: Map<string, number> | null = null;
  const notices = [];
  for (const record of records) {
    if (!index) {
      index = csvHeaderIndex(record);
      continue;
    }
    const notice = parseSamCsvRecord(record, index);
    if (notice) notices.push(notice);
  }
  return notices;
}

describe("streaming CSV splitter", () => {
  test("splits records across chunk boundaries and unescapes quotes", () => {
    const stream = createCsvRecordStream();
    const out = [
      ...stream.push('"a","b\n'),
      ...stream.push("c\",\"d\"\"e\"\n"),
      ...stream.push('"f","g"'),
      ...stream.end(),
    ];
    expect(out).toEqual([
      ["a", "b\nc", 'd"e'],
      ["f", "g"],
    ]);
  });

  test("a quoted field may contain CRLF, commas and newlines", () => {
    const stream = createCsvRecordStream();
    const out = [...stream.push('"x,1\r\n2","y"\n'), ...stream.end()];
    expect(out).toEqual([["x,1\r\n2", "y"]]);
  });

  test("the real fixture parses to the header plus 12 data records", () => {
    const stream = createCsvRecordStream();
    const records = [...stream.push(FIXTURE), ...stream.end()];
    expect(records.length).toBe(13);
    expect(records[0]![0]).toBe("NoticeId");
    expect(records[0]!.length).toBe(47);
  });
});

describe("row filters (mirror the counter's OPEN_BID_SQL + award exclusion)", () => {
  test("only a parsable deadline dated today or later is kept", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    expect(isOpenDeadline("2026-10-22T13:00:00-06:00", now)).toBe(true);
    expect(isOpenDeadline("2026-10-19T23:59:00Z", now)).toBe(true); // same UTC date
    expect(isOpenDeadline("2026-10-18T23:59:00Z", now)).toBe(false); // yesterday
    expect(isOpenDeadline("", now)).toBe(false);
    expect(isOpenDeadline("not a date", now)).toBe(false);
  });

  test("award and justification notices are refused, including the J&A spelling", () => {
    expect(isAwardOrJustificationType("Award Notice")).toBe(true);
    expect(isAwardOrJustificationType("award")).toBe(true);
    expect(isAwardOrJustificationType("Justification")).toBe(true);
    expect(isAwardOrJustificationType("Justification and Approval (J&A)")).toBe(true);
    expect(isAwardOrJustificationType("Justification & Approval (J&A)")).toBe(true);
    expect(isAwardOrJustificationType("Combined Synopsis/Solicitation")).toBe(false);
    expect(isAwardOrJustificationType(null)).toBe(false);
  });

  test("the fixture yields only live opportunities", () => {
    const notices = parseAll(FIXTURE);
    const rows = notices.map((n) => csvNoticeToBid(n, new Date("2026-10-19T12:00:00Z")));
    // every kept row has a future deadline and is not an award notice
    for (const [i, row] of rows.entries()) {
      if (!row) {
        expect(["award_or_justification", "past_deadline", "missing_deadline"]).toContain(
          isAwardOrJustificationType(notices[i]!.noticeType)
            ? "award_or_justification"
            : !notices[i]!.responseDeadline
              ? "missing_deadline"
              : "past_deadline",
        );
        continue;
      }
      expect(parseDeadline(row.due_date)!.getTime()).toBeGreaterThan(
        new Date("2026-10-19T00:00:00Z").getTime(),
      );
      expect(isAwardOrJustificationType(row.notice_type)).toBe(false);
    }
    expect(rows.some((r) => r !== null)).toBe(true);
  });
});

describe("notice → bids row", () => {
  const base = {
    noticeId: "6196197ae63848ce93a86870cb18e0cd",
    title: "Janitorial services",
    solicitationNumber: "1240BE27Q0001",
    subTier: "FOREST SERVICE",
    office: "WALLOWA WHITMAN NATIONAL FOREST",
    postedDate: "2026-10-17 13:18:40",
    noticeType: "Combined Synopsis/Solicitation",
    archiveDate: "2026-11-06",
    setAsideCode: "SBA",
    setAsideLabel: "Small Business Set Aside - Total",
    responseDeadline: "2026-10-22T13:00:00-06:00",
    naicsCode: "237310",
    psc: "Z1LB",
    popCity: "Stanford",
    popState: "MT",
    officeState: "OR",
    link: null,
    description: "<p>Work</p>",
  };
  const now = new Date("2026-10-19T12:00:00Z");

  test("identity is SAM's own notice id, in the 4-hourly sync's format", () => {
    const row = csvNoticeToBid(base, now)!;
    expect(row.external_id).toBe("sam-6196197ae63848ce93a86870cb18e0cd");
    expect(samCsvExternalId("6196197AE63848CE93A86870CB18E0CD")).toBe(
      "sam-6196197ae63848ce93a86870cb18e0cd",
    );
    expect(row.source_url).toBe("https://sam.gov/opp/6196197ae63848ce93a86870cb18e0cd/view");
  });

  test("state comes from PopState — the office state is never used", () => {
    const withPop = csvNoticeToBid(base, now)!;
    expect(withPop.location).toBe("Stanford, MT");
    expect(withPop.normalized_state).toBe("MT");
    // Same notice, no place-of-performance state, office State = OR: blank stays blank.
    const noPop = csvNoticeToBid({ ...base, popState: null, popCity: null }, now)!;
    expect(noPop.location).toBe("");
    expect(noPop.normalized_state).toBeNull();
    expect(noPop.raw_location).toBeNull();
    expect(noPop.source_jurisdiction).toBeNull();
    // the OFFICE state ("OR") is nowhere in the stored row's geography
    expect(noPop.location).not.toBe("OR");
    expect(noPop.normalized_state).not.toBe("OR");
  });

  test("a foreign / non-US place of performance is never a state", () => {
    const foreign = csvNoticeToBid({ ...base, popState: "JP-01", popCity: "Tokyo" }, now)!;
    expect(foreign.location).toBe("");
    expect(foreign.normalized_state).toBeNull();
    expect(stateCodeFromLocation(foreign.location)).toBeNull();
    expect(stateCodeFromLocation("Tokyo, JP-01")).toBeNull();
  });

  test("a total small-business set-aside is never reported as 8(a)", () => {
    // The shared normalizer maps the CODE "SBA" to "8(a)"; in SAM's daily
    // extract "SBA" is the Total Small Business Set-Aside code (2,806 rows of the
    // 12,232 measured). The label wins, so no 8(a) claim is fabricated.
    expect(csvSetAsideLabel(base)).toBe("Small Business Set Aside - Total");
    expect(
      csvSetAsideLabel({
        ...base,
        setAsideCode: "SDVOSBC",
        setAsideLabel: "Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside (FAR 19.14)",
      }),
    ).toBe("SDVOSB");
    expect(csvSetAsideLabel({ ...base, setAsideCode: "HZC", setAsideLabel: "Historically Underutilized Business (HUBZone) Set-Aside (FAR 19.13)" })).toBe("HUBZone");
    expect(csvSetAsideLabel({ ...base, setAsideCode: "8A", setAsideLabel: "8(a) Set-Aside (FAR 19.8)" })).toBe("8(a)");
    expect(csvSetAsideLabel({ ...base, setAsideCode: "NONE", setAsideLabel: "No Set aside used" })).toBeNull();
    expect(csvSetAsideLabel({ ...base, setAsideCode: "", setAsideLabel: "" })).toBeNull();
  });

  test("the dates the file publishes are kept in their own columns", () => {
    const row = csvNoticeToBid(base, now)!;
    expect(row.posted_date).toBe("2026-10-17");
    expect(row.archive_date).toBe("2026-11-06");
    expect(row.due_date).toBe("2026-10-22T19:00:00.000Z");
  });
});

describe("change detection", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const notice = {
    noticeId: "a".repeat(32),
    title: "T",
    solicitationNumber: null,
    subTier: null,
    office: "OFFICE",
    postedDate: "2026-10-17 00:00:00",
    noticeType: "Solicitation",
    archiveDate: "2026-11-06",
    setAsideCode: null,
    setAsideLabel: null,
    responseDeadline: "2026-10-22T13:00:00-06:00",
    naicsCode: "561720",
    psc: "S201",
    popCity: "Dayton",
    popState: "OH",
    officeState: null,
    link: null,
    description: "d",
  };

  test("an identical row produces an identical change tuple (the upsert skips it)", () => {
    const a = csvNoticeToBid(notice, now)!;
    const b = csvNoticeToBid({ ...notice }, now)!;
    expect(csvBidChangeTuple(a)).toBe(csvBidChangeTuple(b));
  });

  test("every meaningful field changes the tuple", () => {
    const base = csvNoticeToBid(notice, now)!;
    const baseKey = csvBidChangeTuple(base);
    for (const patch of [
      { title: "T2" },
      { description: "d2" },
      { due_date: "2026-10-23T13:00:00-06:00" },
      { location: "Columbus, OH" },
      { set_aside: "SDVOSB" },
      { naics_code: "561721" },
      { psc: "S202" },
      { notice_type: "Combined Synopsis/Solicitation" },
      { agency: "OTHER" },
      { source_url: "https://sam.gov/opp/x/view" },
      { normalized_state: null },
      { posted_date: "2026-10-18" },
      { archive_date: "2026-11-07" },
    ]) {
      expect(csvBidChangeTuple({ ...base, ...patch })).not.toBe(baseKey);
    }
  });
});

describe("the owner's totalStates OBSERVATION — logged and alerted, never blocked", () => {
  // OWNER AMENDMENT 2026-10-19: the counter's state count FOLLOWS THE REAL DATA.
  // The old block-gate (refuse to write, exit non-zero, whenever the set moved
  // off a {n:50, includesME:false} constant) is gone. What is tested here is the
  // replacement: a change is DETECTED in both directions, REPORTED with the
  // exact sets and per-state deltas, and the import carries on either way.
  test("a run whose state set does not move is a quiet success (changed=false)", () => {
    const change = describeStateSetChange(["MD", "VA"], ["MD", "VA"]);
    expect(change.changed).toBe(false);
    expect(change.added).toEqual([]);
    expect(change.removed).toEqual([]);
    expect(change.before).toEqual(["MD", "VA"]);
    expect(change.after).toEqual(["MD", "VA"]);
  });
  test("an ADDED state is detected (the measured live case: ME with 10 notices)", () => {
    const change = describeStateSetChange(["CT", "MD"], ["CT", "MD", "ME"]);
    expect(change.changed).toBe(true);
    expect(change.added).toEqual(["ME"]);
    expect(change.removed).toEqual([]);
    expect(change.after.length).toBe(3);
  });
  test("a REMOVED state is detected too — the count may move BOTH ways", () => {
    const change = describeStateSetChange(["MD", "ME", "VA"], ["MD", "VA"]);
    expect(change.changed).toBe(true);
    expect(change.removed).toEqual(["ME"]);
    expect(change.added).toEqual([]);
  });
  test("for a 50 -> 51 move that is only ME, the delta set names ME alone", () => {
    const before = ALL_COUNTER_STATES.filter((c) => c !== "ME");
    const after = [...before, "ME"];
    expect(before.length).toBe(50); // 50 states + DC, minus ME
    const change = describeStateSetChange(before, after);
    expect(change.changed).toBe(true);
    expect(change.added).toEqual(["ME"]);
    expect(change.removed).toEqual([]);
    expect(change.after.length).toBe(before.length + 1);
  });
  test("per-state open-count deltas cover additions AND removals, with numbers", () => {
    const deltas = stateOpenCountDeltas({ VA: 215, MD: 31 }, { VA: 215, MD: 31, ME: 10 });
    expect(deltas).toEqual([{ state: "ME", before: 0, after: 10, delta: 10, added: true, removed: false }]);
    const lost = stateOpenCountDeltas({ VA: 215, ME: 10 }, { VA: 215 });
    expect(lost).toEqual([{ state: "ME", before: 10, after: 0, delta: -10, added: false, removed: true }]);
    // counts that move inside an existing state are reported too
    const moved = stateOpenCountDeltas({ VA: 215 }, { VA: 304 });
    expect(moved).toEqual([{ state: "VA", before: 215, after: 304, delta: 89, added: false, removed: false }]);
    // an unchanged state is not a delta at all
    expect(stateOpenCountDeltas({ VA: 1, MD: 2 }, { VA: 1, MD: 2 })).toEqual([]);
  });
  test("the projection's state rule matches the map's deriveStateCode shape", () => {
    expect(stateCodeFromLocation("Stanford, MT")).toBe("MT");
    expect(stateCodeFromLocation("MT")).toBe("MT");
    expect(stateCodeFromLocation("Kansas City, MO")).toBe("MO");
    expect(stateCodeFromLocation("")).toBeNull();
    expect(stateCodeFromLocation(null)).toBeNull();
    expect(stateCodeFromLocation("Tokyo, JP-01")).toBeNull();
  });
  test("the row stats use the counter's OWN low-content rule, not all kept rows", () => {
    const rows = [
      // real location + long title → the counter counts it
      { title: "Window washing services for the Kittery annex", location: "Kittery, ME", set_aside: null, normalized_state: "ME", due_date: "2026-11-01T00:00:00Z" },
      // short title + placeholder location + no set-aside → the counter refuses it
      { title: "Tubas", location: "Unknown", set_aside: null, normalized_state: null, due_date: "2026-11-01T00:00:00Z" },
    ] as any[];
    const s = keptRowCounterStats(rows, new Date("2026-10-19T04:30:00Z"));
    expect(s.counted).toBe(1);
    expect(s.refusedLowContent).toBe(1);
    expect(s.withPopState).toBe(1);
    expect(s.withoutPopState).toBe(1);
  });
  test("a state carried ONLY by a low-content row can never enter the counter", () => {
    const rows = [
      { title: "Tubas", location: "Unknown", set_aside: null, normalized_state: "ME", due_date: "2026-11-01T00:00:00Z" },
    ] as any[];
    const s = keptRowCounterStats(rows, new Date("2026-10-19T04:30:00Z"));
    expect(s.counted).toBe(0); // refused by the counter's own low-content rule
    expect(s.refusedLowContent).toBe(1);
    // …so the state SET cannot move on the strength of that row alone
    expect(describeStateSetChange(["VA"], ["VA"]).changed).toBe(false);
  });
});
/**
 * ── THE NATURAL-KEY REGRESSION SUITE (post-merge fix, 2026-10-19) ───────────
 *
 * The first real run was aborted by
 * `duplicate key value violates unique constraint "idx_bids_natural_key_unique"`
 * and wrote ZERO rows: the extract holds DISTINCT NoticeIds whose FIVE-column
 * tuple (title, agency, notice_type, due_date, psc) is IDENTICAL, and the old
 * (title, agency) pre-filter could not see a sibling row inside its OWN 500-row
 * VALUES list. These tests pin the fix at the layer where it is decidable
 * without a database:
 *   (a) two distinct NoticeIds with the SAME five-column tuple in one stream →
 *       ONE kept row, the duplicate counted (never an error);
 *   (a2) the same tuple with a DIFFERENT due_date is NOT a duplicate → BOTH kept
 *       (the five-column semantics, which the old title+agency filter got wrong);
 *   (b) the key itself: identical tuples collapse, and EVERY one of the five
 *       index columns changes it;
 *   (c) the SQL guard names the index's five columns and its frozen predicate,
 *       and the predicate literal is pinned against migration 048's own file so
 *       the two can never drift apart silently.
 */
describe("natural-key dedupe (the migration-048 UNIQUE index's own tuple)", () => {
  const now = new Date("2026-10-19T12:00:00Z");

  /** A kept row with a controllable five-column tuple. */
  function keptRow(over: Partial<Record<string, unknown>> = {}) {
    const notice = {
      noticeId: "a".repeat(32),
      title: "Assorted Hardware",
      solicitationNumber: null,
      subTier: "DEFENSE LOGISTICS AGENCY",
      office: "DLA MARITIME PORTSMOUTH",
      postedDate: "2026-10-17 00:00:00",
      noticeType: "Combined Synopsis/Solicitation",
      archiveDate: "2026-11-06",
      setAsideCode: null,
      setAsideLabel: null,
      responseDeadline: "2026-10-20T19:00:00-04:00",
      naicsCode: "339999",
      psc: "5340",
      popCity: "Kittery",
      popState: "ME",
      officeState: "ME",
      link: null,
      description: "d",
      ...over,
    };
    return csvNoticeToBid(notice as any, now)!;
  }

  test("the key collapses the three measured Kittery 'Assorted Hardware' NoticeIds", () => {
    // The live case: three distinct NoticeIds, ONE deadline, one office, one
    // title, one PSC — three rows, one natural key.
    const a = keptRow({ noticeId: "67712fa924984c3ab258022508290082" });
    const b = keptRow({ noticeId: "20c966d8831844479c8b235c4dd2171a" });
    const c = keptRow({ noticeId: "af42504763914b868c633f42ac4635e9" });
    expect(samCsvNaturalKey(a)).toBe(samCsvNaturalKey(b));
    expect(samCsvNaturalKey(b)).toBe(samCsvNaturalKey(c));
    expect(samCsvNaturalKey(a)).toBe(
      [
        "assorted hardware",
        "dla maritime portsmouth",
        "Combined Synopsis/Solicitation",
        "2026-10-20T23:00:00.000Z",
        "5340",
      ].join("\u0001"),
    );
  });

  test("each of the five index columns changes the key", () => {
    const base = keptRow();
    const baseKey = samCsvNaturalKey(base);
    // title + agency are compared lower(btrim(…)) — case and padding are noise.
    expect(samCsvNaturalKey({ ...base, title: "  ASSORTED   HARDWARE " })).not.toBe(baseKey);
    expect(samCsvNaturalKey({ ...base, title: " assorted hardware" })).toBe(baseKey);
    expect(samCsvNaturalKey({ ...base, agency: "DLA MARITIME PORTSMOUTH " })).toBe(baseKey);
    expect(samCsvNaturalKey({ ...base, notice_type: "Solicitation" })).not.toBe(baseKey);
    expect(samCsvNaturalKey({ ...base, due_date: "2026-10-21T23:00:00.000Z" })).not.toBe(baseKey);
    expect(samCsvNaturalKey({ ...base, psc: "5341" })).not.toBe(baseKey);
    // NULL notice_type / psc fold to '' exactly as COALESCE(x,'') does in SQL.
    expect(samCsvNaturalKey({ ...base, notice_type: null, psc: null })).toBe(
      ["assorted hardware", "dla maritime portsmouth", "", "2026-10-20T23:00:00.000Z", ""].join("\u0001"),
    );
  });

  test("(a) two NoticeIds sharing one tuple → ONE row kept, the duplicate counted", () => {
    const rows = [
      keptRow({ noticeId: "b".repeat(32) }),
      keptRow({ noticeId: "1".repeat(32) }),
      keptRow({ noticeId: "f".repeat(32) }),
    ];
    const dedupe = dedupeKeptRowsByNaturalKey(rows);
    expect(dedupe.rows.length).toBe(1);
    expect(dedupe.dropped.length).toBe(2);
    expect(dedupe.groups).toBe(1);
    // TIEBREAK: the lowest NoticeId wins — `111…1`, not the stream's first row.
    expect(dedupe.rows[0]!.external_id).toBe(`sam-${"1".repeat(32)}`);
    // …and the input is never mutated.
    expect(rows.length).toBe(3);
  });

  test("(a2) the same tuple with a DIFFERENT due_date is NOT a duplicate → both kept", () => {
    // This is the case the old (title, agency) pre-filter wrongly refused: on the
    // index's five columns these are two different notices.
    const rows = [
      keptRow({ noticeId: "a".repeat(32), responseDeadline: "2026-10-20T19:00:00-04:00" }),
      keptRow({ noticeId: "b".repeat(32), responseDeadline: "2026-11-20T19:00:00-04:00" }),
    ];
    const dedupe = dedupeKeptRowsByNaturalKey(rows);
    expect(dedupe.rows.length).toBe(2);
    expect(dedupe.dropped.length).toBe(0);
    expect(dedupe.rows.map((r) => r.external_id)).toEqual([
      `sam-${"a".repeat(32)}`,
      `sam-${"b".repeat(32)}`,
    ]);
  });

  test("(c) the SQL guard is the index's five columns, scoped to its frozen predicate", () => {
    const guard = NATURAL_KEY_GUARD_SQL.replace(/\s+/g, " ");
    for (const column of [
      "lower(btrim(b.title)) = lower(btrim(v.title))",
      "lower(btrim(b.agency)) = lower(btrim(v.agency))",
      "COALESCE(b.notice_type, '') = COALESCE(v.notice_type, '')",
      "b.due_date IS NOT DISTINCT FROM v.due_date",
      "COALESCE(b.psc, '') = COALESCE(v.psc, '')",
    ]) {
      expect(guard).toContain(column);
    }
    // The index's own scope — a pre-cutover duplicate must NOT refuse an insert
    // the partial index would have allowed.
    expect(guard).toContain(`b.created_at >= ${NATURAL_KEY_SCOPE_SQL}`);
    // …and the self-exclusion that keeps a re-fetch refreshing in place.
    expect(guard).toContain("NOT (b.source = v.source AND b.external_id = v.external_id)");
    // THE DRIFT PIN: the scope literal is the one migration 048 froze.
    expect(NATURAL_KEY_INDEX).toBe("idx_bids_natural_key_unique");
    const migration = readFileSync(
      new URL("../../db/migrations/048_bids_natural_key_unique.sql", import.meta.url),
      "utf8",
    );
    for (const column of [
      "lower(btrim(title))",
      "lower(btrim(agency))",
      "COALESCE(notice_type, '')",
      "due_date",
      "COALESCE(psc, '')",
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain("NULLS NOT DISTINCT");
    // The predicate literal itself, pinned verbatim.
    const scopeLiteral = /'([^']+)'/.exec(NATURAL_KEY_SCOPE_SQL)?.[1]!;
    expect(scopeLiteral).toBe("2026-09-22 00:00:00+00");
    expect(migration).toContain(`TIMESTAMPTZ '${scopeLiteral}'`);
  });
});

describe("stream-level natural-key dedupe (readSamCsv, no database)", () => {
  const RECORDS = (() => {
    const stream = createCsvRecordStream();
    return [...stream.push(FIXTURE), ...stream.end()];
  })();
  const COLUMNS = RECORDS[0]!;
  const HEADER = COLUMNS.join(",");

  /** One 47-column record, defaulted to a live 2099 notice. */
  function record(over: Record<string, string>): string {
    const values = new Map<string, string>([
      ["NoticeId", "0".repeat(32)],
      ["Title", "Assorted Hardware"],
      ["Department/Ind.Agency", "DEPT OF DEFENSE"],
      ["Sub-Tier", "DEFENSE LOGISTICS AGENCY"],
      ["Office", "DLA MARITIME PORTSMOUTH"],
      ["PostedDate", "2026-10-17 00:00:00"],
      ["Type", "Combined Synopsis/Solicitation"],
      ["ArchiveDate", "2099-11-06"],
      ["ResponseDeadLine", "2099-10-20T19:00:00-04:00"],
      ["NaicsCode", "339999"],
      ["ClassificationCode", "S201"],
      ["PopCity", "Kittery"],
      ["PopState", "ME"],
      ["State", "ME"],
      ["Description", "hardware"],
    ]);
    for (const [k, v] of Object.entries(over)) values.set(k, v);
    return COLUMNS.map((c) => `"${values.get(c) ?? ""}"`).join(",");
  }

  test("(a) the run keeps ONE row for three NoticeIds sharing the index's tuple", async () => {
    const csv = [
      HEADER,
      record({ NoticeId: "67712fa924984c3ab258022508290082" }),
      record({ NoticeId: "20c966d8831844479c8b235c4dd2171a" }),
      record({ NoticeId: "af42504763914b868c633f42ac4635e9" }),
    ].join("\n");
    const parsed = await readSamCsv(chunks(csv));
    expect(parsed.rows.length).toBe(1);
    expect(parsed.naturalKeyDuplicates).toBe(2);
    expect(parsed.naturalKeyGroups).toBe(1);
    expect(parsed.skipped.natural_key_duplicate).toBe(2);
    expect(parsed.rows[0]!.external_id).toBe("sam-20c966d8831844479c8b235c4dd2171a");
  });

  test("(b) the same title+agency with a DIFFERENT deadline (and a different PSC) is kept too", async () => {
    const csv = [
      HEADER,
      // a + b: one tuple (same deadline) → one row.
      record({ NoticeId: "a".repeat(32), ResponseDeadLine: "2099-10-20T19:00:00-04:00" }),
      record({ NoticeId: "b".repeat(32), ResponseDeadLine: "2099-10-20T19:00:00-04:00" }),
      // c: the SAME title/agency, a different deadline → a DIFFERENT tuple.
      record({ NoticeId: "c".repeat(32), ResponseDeadLine: "2099-12-01T19:00:00-04:00" }),
      // d: same as c but a different PSC → also a different tuple.
      record({
        NoticeId: "d".repeat(32),
        ResponseDeadLine: "2099-12-01T19:00:00-04:00",
        ClassificationCode: "S202",
      }),
    ].join("\n");
    const parsed = await readSamCsv(chunks(csv));
    // The old (title, agency) filter would have kept ONE of these four; the index
    // says three of them are distinct rows.
    expect(parsed.rows.length).toBe(3);
    expect(parsed.naturalKeyDuplicates).toBe(1);
    expect(parsed.naturalKeyGroups).toBe(1);
    expect(parsed.rows.map((r) => r.external_id)).toEqual([
      `sam-${"a".repeat(32)}`,
      `sam-${"c".repeat(32)}`,
      `sam-${"d".repeat(32)}`,
    ]);
    expect(parsed.skipped).toEqual({ natural_key_duplicate: 1 }); // nothing dropped for any OTHER reason
  });

  test("a distinct tuple is untouched — no dedupe where the index would allow both", async () => {
    const csv = [
      HEADER,
      record({ NoticeId: "a".repeat(32) }),
      record({ NoticeId: "b".repeat(32), Title: "Vacuum Recovery Unit" }),
    ].join("\n");
    const parsed = await readSamCsv(chunks(csv));
    expect(parsed.rows.length).toBe(2);
    expect(parsed.naturalKeyDuplicates).toBe(0);
    expect(parsed.skipped).toEqual({});
  });
});

describe("close-out rule", () => {
  const extractTime = new Date("2026-10-19T03:30:00Z");
  const now = new Date("2026-10-20T04:30:00Z");
  const tonight = new Set(["sam-" + "a".repeat(32)]);

  test("a notice still in tonight's file with a future deadline is left alone", () => {
    expect(
      shouldCloseOut({
        dueDate: "2026-11-01T00:00:00Z",
        externalId: "sam-" + "a".repeat(32),
        tonightIds: tonight,
        createdAt: "2026-10-01T00:00:00Z",
        extractTime,
        now,
      }),
    ).toBe(false);
  });

  test("a notice that vanished from the file is closed out", () => {
    expect(
      shouldCloseOut({
        dueDate: "2026-11-01T00:00:00Z",
        externalId: "sam-" + "b".repeat(32),
        tonightIds: tonight,
        createdAt: "2026-10-01T00:00:00Z",
        extractTime,
        now,
      }),
    ).toBe(true);
  });

  test("a notice stored AFTER the extract was generated is never closed (same-day 4h bid)", () => {
    expect(
      shouldCloseOut({
        dueDate: "2026-11-01T00:00:00Z",
        externalId: "sam-" + "b".repeat(32),
        tonightIds: tonight,
        createdAt: "2026-10-19T09:00:00Z",
        extractTime,
        now,
      }),
    ).toBe(false);
  });

  test("a passed deadline closes out; a deadline-less row is never called closed", () => {
    expect(
      shouldCloseOut({
        dueDate: "2026-10-18T00:00:00Z",
        externalId: "sam-" + "a".repeat(32),
        tonightIds: tonight,
        createdAt: "2026-10-01T00:00:00Z",
        extractTime,
        now,
      }),
    ).toBe(true);
    expect(
      shouldCloseOut({
        dueDate: null,
        externalId: "sam-" + "b".repeat(32),
        tonightIds: tonight,
        createdAt: "2026-10-01T00:00:00Z",
        extractTime,
        now,
      }),
    ).toBe(false);
  });
});
