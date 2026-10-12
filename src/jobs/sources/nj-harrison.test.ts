/**
 * Town of Harrison, NJ (`nj_harrison`) pins. Zero network: the board was
 * captured 2026-10-12 with 2 open postings.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { TAIL_SOURCES } from "../runner";
import { parseNjHarrisonBoard } from "./nj-harrison";

const BOARD = gunzipSync(readFileSync(new URL("./fixtures/nj-harrison/bids-2026-10-12.html.gz", import.meta.url))).toString("utf8");
const CAPTURED = Date.parse("2026-10-12T20:00:00Z");

describe("nj_harrison — captured board", () => {
  test("both open postings parse with their close times and official links", () => {
    const r = parseNjHarrisonBoard(BOARD, CAPTURED);
    expect(r.rows.map((x) => x.external_id)).toEqual(["harrisonnj-189", "harrisonnj-190"]);
    expect(r.rows[1]!.title).toBe("Notice to Bidders - Furnishing and Delivering of Rock Salt");
    expect(r.rows[1]!.source_url).toBe("https://townofharrison.com/bids.aspx?bidID=190");
    expect(r.rows.every((x) => x.agency === "Town of Harrison" && x.location === "Harrison, NJ")).toBe(true);
    expect(r.rows.every((x) => x.due_date && Date.parse(x.due_date) > CAPTURED)).toBe(true);
  });

  test("after both close, nothing is listed", () => {
    expect(parseNjHarrisonBoard(BOARD, Date.parse("2026-10-21T00:00:00Z")).rows.length).toBe(0);
  });
});

describe("nj_harrison — registration", () => {
  test("is a tail sync source with a New Jersey home jurisdiction", () => {
    expect(TAIL_SOURCES.some((s) => s.name === "nj_harrison")).toBe(true);
    expect(SOURCE_HOME_JURISDICTIONS.nj_harrison).toBe("NJ");
  });
});
