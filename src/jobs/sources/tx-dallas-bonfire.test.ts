/**
 * City of Dallas Bonfire portal (`tx_dallas_bonfire`) pins. Zero network: the
 * fixture is the tenant's open-opportunity JSON captured 2026-10-12.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveInsertLocationColumns, SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { isStateLocalSource } from "~/lib/cert-matching";
import { TAIL_SOURCES } from "../runner";
import { parseBonfire } from "./bonfire-public";
import { TX_DALLAS_BONFIRE_CONFIG } from "./tx-dallas-bonfire";

const BODY = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/tx-dallas-bonfire/open-2026-10-12.json.gz", import.meta.url))).toString("utf8"));
const CAPTURED = Date.parse("2026-10-12T12:00:00Z");

describe("tx_dallas_bonfire — captured list", () => {
  test("17 open projects, all accepted, City of Dallas, Dallas TX", () => {
    const { rows, skipped } = parseBonfire(TX_DALLAS_BONFIRE_CONFIG, BODY.payload, CAPTURED);
    expect(Object.keys(BODY.payload.projects).length).toBe(17);
    expect(rows.length).toBe(17);
    expect(skipped).toEqual({});
    expect(rows.every((r) => r.agency === "City of Dallas" && r.location === "Dallas, TX")).toBe(true);
    expect(rows.every((r) => r.external_id.startsWith("dallasbonfire-"))).toBe(true);
    expect(rows.some((r) => r.title === "Crawford Memorial Park Phase I Improvements")).toBe(true);
  });

  test("every row lands in Texas", () => {
    for (const r of parseBonfire(TX_DALLAS_BONFIRE_CONFIG, BODY.payload, CAPTURED).rows) {
      const cols = deriveInsertLocationColumns({ location: r.location, agency: r.agency, title: r.title, description: r.description, sourceName: "tx_dallas_bonfire" });
      expect(cols.normalized_state).toBe("TX");
    }
  });

  test("registered as a tail sync source with a Texas home jurisdiction", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "tx_dallas_bonfire")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS["tx_dallas_bonfire"]).toBe("TX");
    expect(isStateLocalSource(["tx_dallas_bonfire"])).toBe(true);
  });
});
