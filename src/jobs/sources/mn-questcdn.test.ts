/**
 * Minnesota Dept of Administration QuestCDN (`mn_questcdn`) connector pins.
 * Zero network, no database: the fixture is the verbatim browse_posting JSON
 * captured 2026-10-05 (gzipped; see fixtures/mn-questcdn/README.md); `now` is
 * injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { parseQuestPostings, questAgencyName, questCell, questCloseMs, type QuestPosting } from "./mn-questcdn";

const BODY = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/mn-questcdn/admin-postings-2026-10-05.json.gz", import.meta.url))).toString("utf8"),
);
const ITEMS: QuestPosting[] = BODY.data;
const CAPTURED = Date.parse("2026-10-05T20:00:00Z");

describe("mn_questcdn — parse (captured response)", () => {
  test("9 open projects, all accepted", () => {
    expect(ITEMS.length).toBe(9);
    expect(BODY.recordsTotal).toBe(9);
    const { rows, skipped } = parseQuestPostings(ITEMS, CAPTURED);
    expect(skipped).toEqual({});
    expect(rows.length).toBe(9);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^mnquest-\d+$/);
      expect(r.agency).toMatch(/^Minnesota /);
      expect(r.location).toBe("Minnesota");
      expect(r.title).not.toContain("...");
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "mn_questcdn" });
      expect(cols.source_jurisdiction).toBe("MN");
      expect(cols.normalized_state).toBe("MN");
    }
  });

  test("a row reads as the posting lists it (full name, not the truncated cell)", () => {
    const r = parseQuestPostings(ITEMS, CAPTURED).rows.find((x) => x.external_id === "mnquest-10356824")!;
    expect(r.title).toBe("Replace Sanitary Piping in Building #19 - MVH Minneapolis");
    expect(r.agency).toBe("Minnesota Department of Administration");
    expect(r.due_date).toBe("2026-10-15T19:00:00.000Z"); // 02:00 PM CDT
    expect(r.solicitation_number).toBe("10356824");
    expect(r.description).toContain("Hennepin County");
  });

  test("a passed closing or another state is never accepted", () => {
    const base = ITEMS[0];
    expect(parseQuestPostings([{ ...base, bid_date_str: "10/01/2026 02:00 PM CDT" }], CAPTURED).skipped).toEqual({ closed: 1 });
    expect(parseQuestPostings([{ ...base, state_code: "WI" }], CAPTURED).skipped).toEqual({ out_of_state: 1 });
    expect(parseQuestPostings([{ ...base, bid_date_str: "TBD" }], CAPTURED).skipped).toEqual({ bad_date: 1 });
  });

  test("helpers and registration", () => {
    expect(questCloseMs("12/01/2026 10:00 AM CST")).toBe(Date.parse("2026-12-01T16:00:00Z"));
    expect(questCloseMs("12/01/2026 12:30 PM CST")).toBe(Date.parse("2026-12-01T18:30:00Z"));
    expect(questCell('<div title="St. Louis River &amp; Mud Lake">St. Louis Ri...</div>')).toBe("St. Louis River & Mud Lake");
    expect(questAgencyName("Department of Administration", "")).toBe("Minnesota Department of Administration");
    expect(questAgencyName("Minnesota Department of Natural Resources", "")).toBe("Minnesota Department of Natural Resources");
    expect(TAIL_SOURCES.some((s) => s.name === "mn_questcdn")).toBe(true);
    expect(SOURCE_CLASSES.mn_questcdn.scopeState).toBe("MN");
  });
});
