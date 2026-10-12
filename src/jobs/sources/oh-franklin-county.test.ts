import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  franklinRow,
  readFranklinListings,
  readFranklinOpening,
} from "./oh-franklin-county";

const dir = `${import.meta.dir}/fixtures/oh-franklin-county`;
const list = readFileSync(`${dir}/bids-list-2026-10-12.html`, "utf8");
const detail = readFileSync(`${dir}/bid-9053-2026-10-12.html`, "utf8");
const NOW = Date.parse("2026-10-12T16:00:00Z");

describe("Franklin County, OH bid table", () => {
  test("reads every row with its id, reference, title and opening date", () => {
    const rows = readFranklinListings(list);
    expect(rows.length).toBe(6);
    expect(rows[0]).toEqual({
      id: "9053",
      reference: "RFP# 2026-11-16",
      title: "Durable Medical Equipment (DME)",
      date: { year: 2026, month: 10, day: 28 },
    });
    expect(rows.map((r) => r.id)).toEqual(["9053", "9051", "9034", "9028", "9031", "9052"]);
  });

  test("reads the opening time from the detail page", () => {
    expect(readFranklinOpening(detail)).toEqual({ date: { year: 2026, month: 10, day: 28 }, hour: 14, minute: 0 });
    expect(readFranklinOpening("<p>No date here</p>")).toBeNull();
  });

  test("an open row uses the stated time in Eastern (EDT)", () => {
    const listing = readFranklinListings(list)[0]!;
    const r = franklinRow(listing, detail, NOW);
    if (!("row" in r)) throw new Error("expected a row");
    expect(r.row.due_date).toBe("2026-10-28T18:00:00.000Z");
    expect(r.row.external_id).toBe("franklin-county-oh-9053");
    expect(r.row.source_url).toBe("https://bids.franklincountyohio.gov/bids.cfm?id=9053");
    expect(r.row.notice_type).toBe("RFP");
    expect(r.row.solicitation_number).toBe("RFP# 2026-11-16");
    expect(r.row.agency).toBe("Franklin County, Ohio");
    expect(r.row.location).toBe("Franklin County, OH");
    expect(r.row.description).not.toContain("No opening time");
  });

  test("without a readable detail page, the table date is used at 11:59 PM Eastern and says so", () => {
    const listing = readFranklinListings(list)[0]!;
    const r = franklinRow(listing, null, NOW);
    if (!("row" in r)) throw new Error("expected a row");
    expect(r.row.due_date).toBe("2026-10-29T03:59:00.000Z");
    expect(r.row.description).toContain("No opening time is stated");
  });

  test("past openings are skipped as closed; only the one open bid survives", () => {
    const results = readFranklinListings(list).map((l) => franklinRow(l, l.id === "9053" ? detail : null, NOW));
    expect(results.filter((r) => "row" in r).length).toBe(1);
    expect(results.filter((r) => "skip" in r && r.skip === "closed").length).toBe(5);
  });

  test("a row with no date is skipped, never invented", () => {
    expect(franklinRow({ id: "1", reference: "X", title: "T", date: null }, null, NOW)).toEqual({ skip: "no_deadline" });
  });
});
