/**
 * Sacramento Public Library Bonfire tenant (`ca_sacramento_library_bonfire`,
 * owner 2026-10-09). Registration and config only — the shared Bonfire reader is
 * covered against real captured payloads in tx-bonfire.test.ts. No fixture is
 * pinned here because the tenant could not be reached from the dev sandbox.
 */
import { describe, expect, test } from "bun:test";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { TAIL_SOURCES } from "../runner";
import { bonfireDataUrl } from "./bonfire-public";
import { CA_SACRAMENTO_LIBRARY_BONFIRE_CONFIG as CFG } from "./ca-sacramento-library-bonfire";

describe("ca_sacramento_library_bonfire", () => {
  test("reads only the Sacramento Public Library tenant", () => {
    expect(bonfireDataUrl(CFG)).toBe("https://saclibrary.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData");
    expect(CFG.idPrefix).toBe("saclibrarybonfire");
    expect(CFG.agencyName(null)).toBe("Sacramento Public Library Authority");
    expect(CFG.locationName).toBe("Sacramento, CA");
  });

  test("registered as a Sacramento, California local source; rows land in California", () => {
    expect(TAIL_SOURCES.some((s) => s.name === CFG.source)).toBe(true);
    expect(SOURCE_CLASSES[CFG.source]).toMatchObject({ class: "local", city: "Sacramento", scopeState: "CA", recordType: "opportunity" });
    expect(SOURCE_HOME_JURISDICTIONS[CFG.source]).toBe("CA");
    const cols = deriveInsertLocationColumns({
      location: "Sacramento, CA",
      agency: "Sacramento Public Library Authority",
      title: "Janitorial services",
      description: "",
      sourceName: CFG.source,
    });
    expect(cols.normalized_state).toBe("CA");
  });
});
