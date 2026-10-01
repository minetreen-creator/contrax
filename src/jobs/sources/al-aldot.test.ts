/**
 * Alabama DOT lettings (`al_aldot`) connector pins. Zero network, no database:
 * the fixtures are ALDOT's letting index and two Project Letting List pages
 * captured 2026-10-01 (gzipped; see fixtures/al-aldot/README.md); `now` is
 * injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import {
  aldotLettingToIso,
  aldotLocation,
  aldotWork,
  parseAldotLettingList,
  readAldotIndex,
  readAldotLettingList,
} from "./al-aldot";

const fixture = (name: string) =>
  gunzipSync(readFileSync(new URL(`./fixtures/al-aldot/${name}`, import.meta.url))).toString("utf8");
const INDEX = fixture("index-2026-10-01.html.gz");
const SEPT = fixture("letting-list-2026-09-25.html.gz");
const AUG = fixture("letting-list-2026-08-28.html.gz");
const BEFORE = Date.parse("2026-08-01T00:00:00Z"); // both lettings still upcoming
const CAPTURED = Date.parse("2026-10-01T16:00:00Z"); // both lettings opened

describe("al_aldot — index", () => {
  test("reads both lettings with their opening time and list page on alletting.aldot.gov", () => {
    expect(readAldotIndex(INDEX)).toEqual([
      {
        label: "September 25, 2026",
        opensAt: "2026-09-25T15:00:00.000Z", // 10:00 AM CDT
        listUrl: "https://alletting.aldot.gov/DW_Pages/NTC/2026/NTC_September_25_2026.html",
      },
      {
        label: "August 28, 2026",
        opensAt: "2026-08-28T15:00:00.000Z",
        listUrl: "https://alletting.aldot.gov/DW_Pages/NTC/2026/NTC_August_28_2026.html",
      },
    ]);
  });

  test("Central time: CDT in summer, CST in winter; garbage is null", () => {
    expect(aldotLettingToIso("September 25, 2026 10:00 AM CDT")).toBe("2026-09-25T15:00:00.000Z");
    expect(aldotLettingToIso("January 22, 2027 10:00 AM CST")).toBe("2027-01-22T16:00:00.000Z");
    expect(aldotLettingToIso("December 4, 2026 1:30 PM CT")).toBe("2026-12-04T19:30:00.000Z");
    expect(aldotLettingToIso("Smarch 1, 2026 10:00 AM")).toBeNull();
    expect(aldotLettingToIso("TBA")).toBeNull();
  });
});

describe("al_aldot — letting lists (captured pages)", () => {
  const [sept, aug] = readAldotIndex(INDEX) as [any, any];

  test("September 25: 17 proposals, all Alabama bids before the opening", () => {
    const { rows, calls, skipped } = parseAldotLettingList(sept, SEPT, BEFORE);
    expect(calls.length).toBe(17);
    expect(rows.length).toBe(17);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^aldot-20260925-\d{3}$/);
      expect(r.agency).toBe("Alabama Department of Transportation");
      expect(r.description).not.toContain(r.agency);
      expect(r.due_date).toBe("2026-09-25T15:00:00.000Z");
      expect(r.source_url.startsWith(`${sept.listUrl}#CALL`)).toBe(true);
      expect(r.location.endsWith("Alabama")).toBe(true);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "al_aldot" });
      expect(cols.source_jurisdiction).toBe("AL");
      expect(cols.normalized_state).toBe("AL");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("call 1 maps field by field", () => {
    const row = parseAldotLettingList(sept, SEPT, BEFORE).rows.find((r) => r.external_id === "aldot-20260925-001")!;
    expect(row.title).toBe("Bridge Culvert Replacement — ALDOT project BR-0077(522), Chambers County");
    expect(row.location).toBe("Chambers County, Alabama");
    expect(row.solicitation_number).toBe("BR-0077(522)");
    expect(row.estimated_value).toBe("$2,540,642 to $3,105,229");
    expect(row.notice_type).toBe("Construction letting");
    expect(row.source_url).toBe("https://alletting.aldot.gov/DW_Pages/NTC/2026/NTC_September_25_2026.html#CALL001");
    expect(row.description).toContain("Contract time: 140 Working Days.");
    expect(row.description).toContain("not a bidding guide");
  });

  test("a two-project call keeps both numbers; a completion-date contract keeps its date", () => {
    const calls = readAldotLettingList(SEPT);
    expect(calls.find((c) => c.call === 7)!.project).toBe("DEMO-A213(950) & ATRP2-49-2026-164");
    expect(calls.find((c) => c.call === 9)!.contractTime).toBe("December 31, 2029 Completion Date");
    expect(calls.find((c) => c.call === 35)!.county).toBe("St. Clair");
  });

  test("August 28: the two proposals ALDOT withdrew are skipped; a mandatory pre-bid is flagged", () => {
    const { rows, calls, skipped } = parseAldotLettingList(aug, AUG, BEFORE);
    expect(calls.length).toBe(15);
    expect(skipped).toEqual({ withdrawn: 2 });
    expect(rows.length).toBe(13);
    expect(rows.map((r) => r.solicitation_number)).not.toContain("IM-IMGR-I065(571)");
    expect(calls.find((c) => c.call === 1)!.project).toBe("DEMOF-RPF-NHF-PRF-A210(943)");
    expect(calls.find((c) => c.call === 1)!.mandatoryPrebid).toBe(true);
  });

  test("once a letting opens, its proposals are closed", () => {
    const { rows, skipped } = parseAldotLettingList(sept, SEPT, CAPTURED);
    expect(rows.length).toBe(0);
    expect(skipped.closed).toBe(17);
  });

  test("work and location helpers", () => {
    expect(aldotWork("for constructing the Resurfacing and Traffic Stripe on CR-24 from …")).toBe("Resurfacing and Traffic Stripe");
    expect(aldotWork("")).toBe("Highway construction");
    expect(aldotLocation("Washington")).toBe("Alabama"); // would resolve to the state of Washington
    expect(aldotLocation("")).toBe("Alabama");
  });
});

describe("al_aldot — registration", () => {
  test("registered as a tail sync source, Alabama home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "al_aldot")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["al_aldot"]).toBe("AL");
    expect(isStateLocalSource(["al_aldot"])).toBe(true);
    expect(sourceBadgeLabel("al_aldot")).toBe("State (AL)");
  });
});
