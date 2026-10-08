import { describe, expect, test } from "bun:test";
import { parseVirginiaBeach, virginiaBeachDeadline, VB_ENDPOINT, type VirginiaBeachPayload } from "./va-virginia-beach-oracle";
const now = Date.parse("2026-10-08T13:00:00Z");
const payload = (): VirginiaBeachPayload => ({ capturedAt: new Date(now).toISOString(), timeZone: "US Eastern Time", rowCount: 2, startRow: 0, rows: [
  ["COVB-27-101717,1", "Operations and Fleet Management for Micro-transit Services", "Request for Proposal", "Active", "10/28/2026 3:00 PM", ""],
  ["COVB-26-101639-2", "Central Resort District Drainage Improvements Phase 1 Design Build Project RFP", "Request for Proposal", "Active", "11/5/2026 3:00 PM", ""],
] });
describe("Virginia Beach official Oracle abstracts", () => {
  test("Eastern deadlines cross daylight saving without guessing", () => {
    expect(virginiaBeachDeadline("10/28/2026 3:00 PM")).toBe("2026-10-28T19:00:00.000Z");
    expect(virginiaBeachDeadline("11/5/2026 3:00 PM")).toBe("2026-11-05T20:00:00.000Z");
    for (const bad of ["2/30/2026 3:00 PM", "11/1/2026 1:30 AM", "3/8/2026 2:30 AM", "10/28/2026", "10/28/2026 13:00 PM"]) expect(virginiaBeachDeadline(bad)).toBeNull();
  });
  test("amendments update identity, hyphenated reissues remain distinct", () => {
    const p = payload(); const r = parseVirginiaBeach(p, now);
    expect(r.rows[0].external_id).toBe("virginiabeach-COVB-27-101717");
    expect(r.rows[1].solicitation_number).toBe("COVB-26-101639-2");
    p.rows[0][0] = "COVB-27-101717,2";
    expect(parseVirginiaBeach(p, now).rows[0].external_id).toBe(r.rows[0].external_id);
    for (const row of r.rows) {
      expect(row.source_url).toBe(VB_ENDPOINT);
      expect(row.location).toBe("Virginia Beach, VA");
      expect(row.set_aside).toBeNull();
      expect(row.naics_code).toBeNull();
      expect(row.notice_type).toBeNull();
    }
  });
  test("closed, past due and unsupported notices are accounted for", () => {
    const p = payload(); p.rows[0][3] = "Closed";
    expect(parseVirginiaBeach(p, now).skipped.not_active).toBe(1);
    p.rows[0][3] = "Active"; p.rows[0][4] = "10/7/2026 3:00 PM";
    expect(parseVirginiaBeach(p, now).skipped.past_due).toBe(1);
    p.rows[0][2] = "Auction";
    expect(parseVirginiaBeach(p, now).skipped.unsupported_notice_type).toBe(1);
  });
  test("partial, stale, malformed, duplicate or unknown-zone reads fail closed", () => {
    for (const change of [
      (p: VirginiaBeachPayload) => { p.rowCount = 3; },
      (p: VirginiaBeachPayload) => { p.startRow = 1; },
      (p: VirginiaBeachPayload) => { p.timeZone = null; },
      (p: VirginiaBeachPayload) => { p.capturedAt = "2026-10-07T13:00:00Z"; },
      (p: VirginiaBeachPayload) => { p.rows[0][4] = "TBD"; },
      (p: VirginiaBeachPayload) => { p.rows[1][0] = p.rows[0][0]; },
      (p: VirginiaBeachPayload) => { p.rows[0].pop(); },
    ]) { const p = payload(); change(p); expect(() => parseVirginiaBeach(p, now)).toThrow(); }
  });
});
