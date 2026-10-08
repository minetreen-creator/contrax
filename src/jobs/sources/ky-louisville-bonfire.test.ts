import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseLouisvilleBonfire } from "./ky-louisville-bonfire";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { deriveInsertLocationColumns } from "~/lib/location-state";
const payload = JSON.parse(readFileSync(new URL("./fixtures/ky-louisville-bonfire/open-opportunities-2026-10-08.json", import.meta.url), "utf8")).payload;
const now = Date.parse("2026-10-08T13:20:00Z");
describe("Louisville procurement", () => {
  test("nine procurement notices; two RFA notices excluded", () => {
    const result = parseLouisvilleBonfire(payload, now);
    expect(result.rows).toHaveLength(9);
    expect(result.skipped).toEqual({ unsupported_notice_type: 2 });
    expect(new Set(result.rows.map(r => r.external_id)).size).toBe(9);
    for (const row of result.rows) {
      expect(row.agency).toBe("Louisville Metro Government");
      expect(row.source_url).toMatch(/^https:\/\/louisvilleky\.bonfirehub\.com\/opportunities\/\d+$/);
      expect(row.set_aside).toBeNull();
      const location = deriveInsertLocationColumns({ ...row, sourceName: "ky_louisville_bonfire" });
      expect(location.normalized_state).toBe("KY");
    }
    expect(SOURCE_CLASSES.ky_louisville_bonfire.class).toBe("local");
  });
  test("courier notice retains its identity and UTC deadline", () => {
    const row = parseLouisvilleBonfire(payload, now).rows.find(r => r.solicitation_number === "RFP270067")!;
    expect(row.title).toBe("Mail Courier Services");
    expect(row.external_id).toBe("louisvillebonfire-256865");
    expect(row.due_date).toBe("2026-10-26T19:00:00.000Z");
  });
  test("expired notices cannot remain in the feed", () => {
    expect(parseLouisvilleBonfire(payload, Date.parse("2026-12-01T00:00:00Z")).rows).toHaveLength(0);
  });
});
