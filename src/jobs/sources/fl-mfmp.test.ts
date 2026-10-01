/**
 * Florida MFMP (`fl_mfmp`) connector pins. Zero network, no database: fixtures
 * are verbatim MFMP search responses captured 2026-10-01 (see
 * fixtures/fl-mfmp/README.md); `now` is injected.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource, sourceBadgeLabel } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { mfmpDetailUrl, MFMP_BIDDABLE_TYPES, parseMfmpAds, type MfmpAd } from "./fl-mfmp";

const fixture = (name: string): MfmpAd[] =>
  JSON.parse(readFileSync(new URL(`./fixtures/fl-mfmp/${name}`, import.meta.url), "utf8"));
const CAPTURED = Date.parse("2026-10-01T12:00:00Z");
const OPEN = [...fixture("open-page1-2026-10-01.json"), ...fixture("open-page2-2026-10-01.json")];

describe("fl_mfmp — parse (captured fixtures)", () => {
  test("all 163 open ads are accounted for: biddable ones kept, notices skipped", () => {
    const { rows, skipped } = parseMfmpAds(OPEN, CAPTURED);
    const total = rows.length + Object.values(skipped).reduce((a, b) => a + b, 0);
    expect(total).toBe(163);
    expect(rows.length).toBeGreaterThan(100);
    expect(skipped.not_biddable_type).toBeGreaterThan(0); // Agency Decisions, grants, notices
    for (const r of rows) {
      expect(MFMP_BIDDABLE_TYPES.has(String(r.notice_type).toLowerCase())).toBe(true);
      expect(r.location).toBe("Florida");
      expect(r.external_id).toMatch(/^mfmp-\d+$/);
      expect(r.source_url).toMatch(/^https:\/\/vendor\.myfloridamarketplace\.com\/search\/bids\/detail\/\d+$/);
      expect(r.naics_code).toBeNull();
      // the buyer is never repeated in the description (trade matching reads it)
      expect(r.description).not.toContain(r.agency);
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "fl_mfmp" });
      expect(cols.source_jurisdiction).toBe("FL");
      expect(cols.normalized_state).toBe("FL");
    }
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(rows.length);
  });

  test("an Agency Decision (intended award) is never ingested as an opportunity", () => {
    const decision = OPEN.find((a) => a.type === "Agency Decision")!;
    expect(parseMfmpAds([decision], CAPTURED).skipped).toEqual({ not_biddable_type: 1 });
  });

  test("an FDOT solid waste ITB maps field by field", () => {
    const ad = OPEN.find((a) => String(a.title).startsWith("Solid waste management and recycling services"))!;
    const [row] = parseMfmpAds([ad], CAPTURED).rows;
    expect(row.agency).toBe("Florida Department of Transportation (FDOT)");
    expect(row.notice_type).toBe("Invitation to Bid");
    expect(row.solicitation_number).toBe(ad.agencyAdNumber);
    expect(row.due_date).toBe(new Date(ad.closeDate!).toISOString());
    expect(row.source_url).toBe(mfmpDetailUrl(ad.advertisementId!));
  });

  test("closed, past-due and incomplete ads are skipped with a reason", () => {
    const closed = fixture("closed-page1-2026-10-01.json");
    expect(parseMfmpAds(closed, CAPTURED).skipped.not_open).toBe(closed.length);
    const base: MfmpAd = { advertisementId: 1, status: "OPEN", type: "Invitation to Bid", title: "Hauling", closeDate: "2026-09-30T00:00:00.000+00:00", agency: "FDOT" };
    expect(parseMfmpAds([base], CAPTURED).skipped).toEqual({ closed: 1 });
    expect(parseMfmpAds([{ ...base, closeDate: undefined, title: "" }], CAPTURED).skipped).toEqual({ missing_title: 1 });
    const kept = parseMfmpAds([{ ...base, closeDate: undefined }], CAPTURED).rows;
    expect(kept.length).toBe(1);
    expect(kept[0].due_date).toBeNull();
  });
});

describe("fl_mfmp — registration", () => {
  test("registered as a tail sync source, Florida home jurisdiction, state badge", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "fl_mfmp")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["fl_mfmp"]).toBe("FL");
    expect(isStateLocalSource(["fl_mfmp"])).toBe(true);
    expect(sourceBadgeLabel("fl_mfmp")).toBe("State (FL)");
  });
});
