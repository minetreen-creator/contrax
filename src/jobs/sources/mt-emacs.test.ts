/**
 * Montana eMACS (`mt_emacs`) and the shared JAGGAER public-site reader. Zero
 * network, no database: the fixture is Montana's Open for Bid page captured
 * 2026-10-02 (see fixtures/mt-emacs/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { jaggaerDateToIso, readJaggaerEvents } from "./jaggaer-public";
import { MT_EMACS_URL, parseMtEmacsPage } from "./mt-emacs";

const HTML = gunzipSync(readFileSync(new URL("./fixtures/mt-emacs/open-for-bid-2026-10-02.html.gz", import.meta.url))).toString("utf8");
const CAPTURED = Date.parse("2026-10-02T03:40:00Z");

describe("jaggaer-public — page reading", () => {
  test("every listed event is parsed (including the first row, whose cell has no class)", () => {
    const { events, total } = readJaggaerEvents(HTML);
    expect(total).toBe(30);
    expect(events.length).toBe(30);
    expect(events[0]!.title).toBe("MSU E-Commerce Platform");
  });

  test("dates carry their printed zone", () => {
    expect(jaggaerDateToIso("10/30/2026, 5:00 PM MDT")).toBe("2026-10-30T23:00:00.000Z");
    expect(jaggaerDateToIso("11/5/2026, 2:00 PM MST")).toBe("2026-11-05T21:00:00.000Z");
    expect(jaggaerDateToIso("11/5/2026, 2:00 PM EST")).toBe("2026-11-05T19:00:00.000Z");
    expect(jaggaerDateToIso("11/5/2026, 2:00 PM XYZ")).toBeNull();
  });
});

describe("mt_emacs — parse (captured page)", () => {
  test("30 events: 3 sole source notices skipped, 27 Montana bids", () => {
    const { rows, skipped } = parseMtEmacsPage(HTML, CAPTURED);
    expect(skipped).toEqual({ not_biddable_type: 3 });
    expect(rows.length).toBe(27);
    for (const r of rows) {
      expect(r.external_id).toMatch(/^mtemacs-\d+$/);
      expect(r.agency).toBe("State of Montana");
      expect(r.location).toBe("Montana");
      expect(r.source_url).toBe(MT_EMACS_URL);
      expect(r.description).not.toMatch(/\w@\w/);
      expect(r.title).not.toMatch(/sole source/i);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "mt_emacs" });
      expect(cols.source_jurisdiction).toBe("MT");
      expect(cols.normalized_state).toBe("MT");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("the weed spraying event maps field by field", () => {
    const row = parseMtEmacsPage(HTML, CAPTURED).rows.find((r) => r.external_id === "mtemacs-1451401")!;
    expect(row.title).toBe("Toston Wetland Weed Spraying");
    expect(row.solicitation_number).toBe("DNRC-LIMTSOL-2027-1256BG");
    expect(row.notice_type).toBe("LimtSol");
    expect(row.due_date).toBe("2026-10-30T23:00:00.000Z"); // 5:00 PM MDT
    expect(row.description).toContain("Weed spraying services at the Toston Wetland");
  });

  test("events past their close time are closed", () => {
    const later = parseMtEmacsPage(HTML, Date.parse("2026-10-20T00:00:00Z"));
    expect(later.skipped.closed).toBeGreaterThan(0);
    expect(later.rows.length + later.skipped.closed! + later.skipped.not_biddable_type!).toBe(30);
  });
});

describe("mt_emacs — registration", () => {
  test("registered as a tail sync source, Montana home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "mt_emacs")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["mt_emacs"]).toBe("MT");
    expect(isStateLocalSource(["mt_emacs"])).toBe(true);
    expect(sourceBadgeLabel("mt_emacs")).toBe("State (MT)");
  });
});
