import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CHATTANOOGA_ORACLE,
  fetchTnChattanoogaBids,
  fetchTnNashvilleBids,
  NASHVILLE_ORACLE,
  ORACLE_PAGE_ROWS,
  oracleDeps,
  oracleLocalTime,
  oracleNoticeType,
  parseOracleAbstracts,
  type OracleAbstractsPayload,
} from "./oracle-abstracts";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";

// Owner 2026-11-06: "we need an oracle scraper to find more of her trade" (a Nashville paving
// customer). The plain Oracle page shows only the 21 newest rows of every status, so the
// collector applies the page's own Active filter in headless Chrome.
const fx = (f: string): OracleAbstractsPayload =>
  JSON.parse(readFileSync(new URL(`./fixtures/oracle-abstracts/${f}`, import.meta.url), "utf8"));
const nash = fx("nashville-active-2026-11-06.json");
const chatt = fx("chattanooga-active-2026-11-06.json");
const at = (p: OracleAbstractsPayload) => Date.parse(p.capturedAt) + 60_000;

describe("public Oracle abstracts reader", () => {
  test("Metro Nashville: its Active negotiations, one per base number", () => {
    const { rows, skipped } = parseOracleAbstracts(NASHVILLE_ORACLE, nash, at(nash));
    expect(rows.map((r) => r.solicitation_number)).toEqual(["GG000123", "GG000106-2", "GG000118", "GG000092", "GG000113", "GG000115"]);
    expect(skipped).toEqual({});
    const tourism = rows[0];
    expect(tourism.external_id).toBe("nashville-GG000123");
    expect(tourism.agency).toBe("Metro Nashville");
    expect(tourism.location).toBe("Nashville, TN");
    expect(tourism.notice_type).toBe("RFQ");
    expect(tourism.due_date).toBe("2026-12-04T20:00:00.000Z"); // 2:00 PM CST
    expect(tourism.source_url).toBe(NASHVILLE_ORACLE.endpoint);
  });

  test("City of Chattanooga: 12 open, construction bids typed as ITB, Eastern time", () => {
    const { rows } = parseOracleAbstracts(CHATTANOOGA_ORACLE, chatt, at(chatt));
    expect(rows).toHaveLength(12);
    const sewer = rows.find((r) => r.solicitation_number === "201011")!;
    expect(sewer.title).toBe("Sanitary Sewer Installation and Repair");
    expect(sewer.external_id).toBe("chattanooga-201011");
    expect(sewer.agency).toBe("City of Chattanooga");
    expect(sewer.location).toBe("Chattanooga, TN");
    expect(sewer.notice_type).toBe("ITB");
    expect(sewer.due_date).toBe("2026-11-12T19:00:00.000Z"); // 11/12/26 2:00 PM EST
    expect(rows.find((r) => r.solicitation_number === "201016-2")).toBeDefined(); // a reissue stays its own bid
  });

  test("closed bids drop out by their own close date", () => {
    const later = Date.parse("2026-11-20T00:00:00Z");
    const p = { ...chatt, capturedAt: new Date(later - 60_000).toISOString() };
    const { rows, skipped } = parseOracleAbstracts(CHATTANOOGA_ORACLE, p, later);
    expect(rows.map((r) => r.solicitation_number).sort()).toEqual(["201004", "201013", "201026", "201030"]);
    expect(skipped.closed).toBe(8);
  });

  test("refuses anything it cannot vouch for", () => {
    const now = at(chatt);
    const bad = (p: Partial<OracleAbstractsPayload>) => () => parseOracleAbstracts(CHATTANOOGA_ORACLE, { ...chatt, ...p }, now);
    expect(bad({ endpoint: NASHVILLE_ORACLE.endpoint })).toThrow();
    expect(bad({ filter: "" })).toThrow();
    expect(bad({ timeZone: "US Central Time" })).toThrow();
    expect(bad({ capturedAt: new Date(now - 2 * 3_600_000).toISOString() })).toThrow();
    expect(bad({ rows: [[...chatt.rows[0].slice(0, 3), "Closed", ...chatt.rows[0].slice(4)]] })).toThrow();
    expect(bad({ rows: Array.from({ length: ORACLE_PAGE_ROWS }, () => chatt.rows[0]) })).toThrow(/cut the list short/);
    expect(bad({ rows: [["x"]] })).toThrow();
  });

  test("local time: both year styles, daylight saving, bad input", () => {
    expect(oracleLocalTime("12/4/2026 2:00 PM", "America/Chicago")).toBe("2026-12-04T20:00:00.000Z");
    expect(oracleLocalTime("7/1/2026 9:30 AM", "America/Chicago")).toBe("2026-07-01T14:30:00.000Z");
    expect(oracleLocalTime("12/3/26 2:00 PM", "America/New_York")).toBe("2026-12-03T19:00:00.000Z");
    expect(oracleLocalTime("7/1/26 9:30 AM", "America/New_York")).toBe("2026-07-01T13:30:00.000Z");
    expect(oracleLocalTime("13/1/2026 9:30 AM", "America/New_York")).toBeNull();
    expect(oracleLocalTime("", "America/New_York")).toBeNull();
  });

  test("notice types", () => {
    expect(oracleNoticeType("Construction Bid")).toBe("ITB");
    expect(oracleNoticeType("Invitation for Bid")).toBe("ITB");
    expect(oracleNoticeType("Request for Proposal")).toBe("RFP");
    expect(oracleNoticeType("Request for Quotation")).toBe("RFQ");
    expect(oracleNoticeType("RFQ")).toBe("RFQ");
    expect(oracleNoticeType("Request for Qualifications")).toBe("Request for Qualifications");
  });

  test("each source runs the collector on its own page and fails loudly", async () => {
    const saved = { ...oracleDeps };
    const asked: string[] = [];
    try {
      oracleDeps.collect = async (endpoint) => { asked.push(endpoint); return endpoint === NASHVILLE_ORACLE.endpoint ? nash : chatt; };
      expect((await fetchTnNashvilleBids(at(nash))).rows).toHaveLength(6);
      expect((await fetchTnChattanoogaBids(at(chatt))).rows).toHaveLength(12);
      expect(asked).toEqual([NASHVILLE_ORACLE.endpoint, CHATTANOOGA_ORACLE.endpoint]);
      oracleDeps.collect = async () => { throw new Error("collector exited 1"); };
      await expect(fetchTnChattanoogaBids()).rejects.toThrow();
    } finally {
      Object.assign(oracleDeps, saved);
    }
  });

  test("both are scheduled, local, in Tennessee, with agency pages, and the sync ships the collector", () => {
    for (const s of ["tn_nashville", "tn_chattanooga"]) {
      expect(TAIL_SOURCES.some((t) => t.name === s)).toBe(true);
      expect(SOURCE_CLASSES[s]?.class).toBe("local");
      expect(SOURCE_HOME_JURISDICTIONS[s]).toBe("TN");
      expect(LOCAL_AGENCIES.some((a) => a.source === s)).toBe(true);
    }
    const wf = readFileSync(".github/workflows/sync-bids.yml", "utf8");
    expect(wf).toContain(".github/scripts/oracle-abstracts-fetch.mjs");
    expect(wf).toContain("ORACLE_ABSTRACTS_FETCH_SCRIPT:");
  });
});
