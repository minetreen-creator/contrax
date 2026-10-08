/**
 * Alaska DOT&PF construction bid calendar (`ak_dotpf`) connector pins. Zero
 * network, no database: the fixture is the calendar's JSON captured 2026-10-08
 * (gzipped; see fixtures/ak-dotpf/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { AKDOTPF_PAGE_URL, akLettingToIso, akLocation, parseAkDotpf, type AkDotpfItem } from "./ak-dotpf";

const ITEMS: AkDotpfItem[] = JSON.parse(
  gunzipSync(readFileSync(new URL("./fixtures/ak-dotpf/bids-2026-10-08.json.gz", import.meta.url))).toString("utf8"),
).value;
const CAPTURED = Date.parse("2026-10-08T18:00:00Z"); // every letting still ahead
const AFTER_OCT_22 = Date.parse("2026-10-23T00:00:00Z");

describe("ak_dotpf — captured calendar", () => {
  test("8 proposals listed, 8 accepted, no skips", () => {
    const { rows, skipped } = parseAkDotpf(ITEMS, CAPTURED);
    expect(ITEMS.length).toBe(8);
    expect(rows.length).toBe(8);
    expect(skipped).toEqual({});
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(8);
  });

  test("the first proposal maps field by field", () => {
    const row = parseAkDotpf(ITEMS, CAPTURED).rows.find((r) => r.external_id === "akdotpf-CDRER01536")!;
    expect(row.title).toBe("Talkeetna Spur MP 13.5 Emergency Erosion Protection — Alaska DOT&PF contract CDRER01536, Talkeetna");
    expect(row.agency).toBe("Alaska Department of Transportation & Public Facilities");
    expect(row.location).toBe("Talkeetna, Alaska");
    expect(row.due_date).toBe("2026-10-09T22:00:00.000Z"); // 2:00 PM AKDT
    expect(row.estimated_value).toBe("Between $2,500,000 and $5,000,000");
    expect(row.source_url).toBe(AKDOTPF_PAGE_URL);
    expect(row.solicitation_number).toBe("CDRER01536");
    expect(row.notice_type).toBe("Construction letting");
    expect(row.description).toContain("Central Region");
    expect(row.description).toContain("erosion protection");
    expect(row.naics_code).toBeNull();
    expect(row.set_aside).toBeNull();
  });

  test("titles keep DOT&PF's wording; every letting is Construction; a statewide one is located in Alaska", () => {
    const rows = parseAkDotpf(ITEMS, CAPTURED).rows;
    expect(rows.some((r) => r.title.startsWith("JNU GLACIER HWY N. & OLD DAIRY CULVERT REPLACEMENTS"))).toBe(true);
    expect(rows.every((r) => r.category === "Construction")).toBe(true);
    expect(rows.find((r) => r.title.startsWith("Noatak Airport Relocation"))!.category).toBe("Construction");
    const ferry = rows.find((r) => r.title.includes("TAZLINA"))!;
    expect(ferry.location).toBe("Alaska");
    expect(ferry.title).toContain(", Statewide");
  });

  test("proposals whose letting has passed are closed", () => {
    const { rows, skipped } = parseAkDotpf(ITEMS, AFTER_OCT_22);
    expect(skipped.closed).toBe(5);
    expect(rows.length).toBe(3);
  });

  test("every row lands in Alaska", () => {
    for (const row of parseAkDotpf(ITEMS, CAPTURED).rows) {
      const cols = deriveInsertLocationColumns({
        location: row.location,
        agency: row.agency,
        title: row.title,
        description: row.description,
        sourceName: "ak_dotpf",
      });
      expect(cols.normalized_state).toBe("AK");
    }
  });
});

describe("ak_dotpf — helpers", () => {
  test("Alaska time: AKDT in summer, AKST in winter; garbage is null", () => {
    expect(akLettingToIso("2026-10-09T00:00:00-08:00", "2:00 PM")).toBe("2026-10-09T22:00:00.000Z");
    expect(akLettingToIso("2026-12-03T00:00:00-09:00", "2:00 PM")).toBe("2026-12-03T23:00:00.000Z");
    expect(akLettingToIso("2026-10-09T00:00:00-08:00", "10:30 a.m.")).toBe("2026-10-09T18:30:00.000Z");
    expect(akLettingToIso("2026-10-09T00:00:00-08:00", "")).toBe("2026-10-09T22:00:00.000Z"); // the stated 2:00 PM default
    expect(akLettingToIso("2026-10-09T00:00:00-08:00", "TBA")).toBeNull();
    expect(akLettingToIso("", "2:00 PM")).toBeNull();
  });

  test("location", () => {
    expect(akLocation("Juneau")).toBe("Juneau, Alaska");
    expect(akLocation("Statewide")).toBe("Alaska");
    expect(akLocation("")).toBe("Alaska");
  });

  test("a proposal without a contract number or letting is skipped, not invented", () => {
    const { rows, skipped } = parseAkDotpf(
      [{ Description: "No number" }, { Name: "X1", Description: "No letting" }],
      CAPTURED,
    );
    expect(rows.length).toBe(0);
    expect(skipped).toEqual({ missing_id: 1, missing_letting: 1 });
  });
});

describe("ak_dotpf — registration", () => {
  test("registered as a tail sync source, Alaska home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "ak_dotpf")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["ak_dotpf"]).toBe("AK");
    expect(isStateLocalSource(["ak_dotpf"])).toBe(true);
    expect(sourceBadgeLabel("ak_dotpf")).toBe("State (AK)");
  });
});
