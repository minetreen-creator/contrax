import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS, deriveInsertLocationColumns } from "~/lib/location-state";
import { AZ_MARICOPA_BIDNET_AGENCY, azMaricopaBidnetStatedOpenCount, parseAzMaricopaBidnet, parseAzMaricopaBidnetRows } from "./az-maricopa-bidnet";

const html = readFileSync(new URL("./fixtures/az-maricopa-bidnet/open-bids-2026-10-29.html", import.meta.url), "utf8");
const now = Date.parse("2026-10-29T16:00:00Z");

describe("Maricopa County's BidNet page", () => {
  test("list: the 6 open solicitations the heading states", () => {
    expect(azMaricopaBidnetStatedOpenCount(html)).toBe(6);
    const rows = parseAzMaricopaBidnetRows(html);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.id)).toContain("0000440035");
    // Member-agency postings, not the statewide abstracts az_bidnet reads.
    expect(rows.every((r) => /origin=2/.test(r.url))).toBe(true);
  });

  test("rows: county named as the buyer, placed in Maricopa County", () => {
    const { rows, skipped } = parseAzMaricopaBidnet(parseAzMaricopaBidnetRows(html), now);
    expect(rows).toHaveLength(6);
    expect(skipped).toEqual({});
    const road = rows.find((r) => r.external_id === "azmaricopabidnet-0000440035")!;
    expect(road.title).toBe("Northern Parkway 103rd Ave to 91st Ave-Phase 1");
    expect(road.agency).toBe(AZ_MARICOPA_BIDNET_AGENCY);
    expect(road.location).toBe("Maricopa County, AZ");
    expect(road.description).toContain("BidNet Direct");
    expect(deriveInsertLocationColumns({ ...road, sourceName: "az_maricopa_bidnet" }).normalized_state).toBe("AZ");
  });

  test("scheduled, classified as a Maricopa County board", () => {
    expect(TAIL_SOURCES.some((t) => t.name === "az_maricopa_bidnet")).toBe(true);
    expect(SOURCE_CLASSES["az_maricopa_bidnet"]).toEqual({ class: "local", city: "Maricopa County", scopeState: "AZ", searchScope: "city-open-data", recordType: "opportunity" });
    expect(SOURCE_HOME_JURISDICTIONS["az_maricopa_bidnet"]).toBe("AZ");
  });
});
