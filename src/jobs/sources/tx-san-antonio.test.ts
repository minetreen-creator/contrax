import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  fetchTxSanAntonioBids,
  parseSanAntonio,
  readSanAntonioRows,
  sanAntonioDeadline,
  sanAntonioDeps,
  sanAntonioPages,
  splitSanAntonioName,
} from "./tx-san-antonio";
import { expandTrade, isStrongTradeMatch } from "~/lib/trade-registry";

// Captured 2026-11-03 (owner: "we need more construction bids in TX", then "3":
// the city's own list instead of CivCast's $1,000/month API).
const page = (n: number) =>
  readFileSync(new URL(`./fixtures/tx-san-antonio/list-2026-11-03-page${n}.html`, import.meta.url), "utf8");
const now = Date.parse("2026-11-03T16:00:00Z");
const all = () => [...readSanAntonioRows(page(1)), ...readSanAntonioRows(page(2))];

describe("City of San Antonio bid list", () => {
  test("both pages read: 20 + 17 rows, page 1 offers page 2", () => {
    expect(readSanAntonioRows(page(1))).toHaveLength(20);
    expect(readSanAntonioRows(page(2))).toHaveLength(17);
    expect(sanAntonioPages(page(1))).toEqual([2]);
  });

  test("every open row is well formed", () => {
    const { rows, skipped } = parseSanAntonio(all(), now);
    expect(rows).toHaveLength(37);
    expect(skipped).toEqual({});
    for (const r of rows) {
      expect(r.external_id).toMatch(/^sanantonio-\d+$/);
      expect(r.source_url).toStartWith("https://webapp1.sanantonio.gov/BidContractOpps/Content.aspx?id=");
      expect(r.agency).toBe("City of San Antonio");
      expect(r.location).toBe("San Antonio, TX");
      expect(Date.parse(r.due_date!)).toBeGreaterThan(now);
    }
    expect(parseSanAntonio(all(), Date.parse("2027-06-01T00:00:00Z")).rows).toHaveLength(0);
  });

  test("names, numbers and deadlines read like the city wrote them", () => {
    expect(splitSanAntonioName("23-03923 Vance Jackson (Loop 410 to Adrian Drive) (2022 Bond)")).toEqual({ number: "23-03923", title: "Vance Jackson (Loop 410 to Adrian Drive) (2022 Bond)" });
    expect(splitSanAntonioName("23-03921A Texas A&M University Area Streets")).toEqual({ number: "23-03921A", title: "Texas A&M University Area Streets" });
    expect(splitSanAntonioName("RFQ 2026-101 On-Call MEP")).toEqual({ number: "RFQ 2026-101", title: "On-Call MEP" });
    // 11:59 PM Central; the "Extended to" date wins.
    expect(sanAntonioDeadline("11/03/2026")).toBe("2026-11-04T05:59:00.000Z");
    expect(sanAntonioDeadline("10/30/2026 Extended to 11/04/2026")).toBe("2026-11-05T05:59:00.000Z");
    expect(sanAntonioDeadline("07/15/2026")).toBe("2026-07-16T04:59:00.000Z");
    expect(sanAntonioDeadline("N/A")).toBeNull();
  });

  test("not-a-bid types and closed rows are skipped", () => {
    const base = { id: "1", name: "1 Thing", type: "Request for Information", department: "Parks", released: "10/01/2026", deadline: "12/01/2026" };
    expect(parseSanAntonio([base], now).skipped).toEqual({ not_a_bid: 1 });
    expect(parseSanAntonio([{ ...base, type: "Invitation for Bids", deadline: "10/01/2026" }], now).skipped).toEqual({ closed: 1 });
  });

  test("the city's street and bond jobs are construction matches; goods buys are not", () => {
    const c = expandTrade("construction");
    const byTitle = new Map(parseSanAntonio(all(), now).rows.map((r) => [r.title, r]));
    for (const t of [
      "Vance Jackson (Loop 410 to Adrian Drive) (2022 Bond)",
      "Toepperwein Rd (Nacogdoches to Wenzel Rd) - 2022 Bond",
      "George Road Low Water Crossing (Hunters Bow to NW Military Highway)",
      "2027 Street Rehabilitation Package 5 - Overlay",
      "Main Plaza Renovations",
    ]) {
      expect({ t, m: isStrongTradeMatch(t, null, null, null, c) }).toEqual({ t, m: true });
      expect(byTitle.get(t)?.category).toBe("Construction");
    }
    for (const t of ["Ready Mix Concrete", "Carbon Steel Pipe and Accessories", "Animal Pharmaceuticals", "Bond Counsel Services", "Road Salt (Delivered to County Yard)"]) {
      expect({ t, m: isStrongTradeMatch(t, null, null, null, c) }).toEqual({ t, m: false });
    }
  });

  test("the fetch reads page 1, then posts the grid's own Page$2", async () => {
    const calls: { method: string; body: string }[] = [];
    const saved = { ...sanAntonioDeps };
    sanAntonioDeps.pause = async () => {};
    sanAntonioDeps.fetch = async (_url, init) => {
      calls.push({ method: String(init.method), body: String(init.body ?? "") });
      return new Response(calls.length === 1 ? page(1) : page(2), { status: 200 });
    };
    try {
      const res = await fetchTxSanAntonioBids(now);
      expect(res.rows).toHaveLength(37);
      expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
      expect(calls[1].body).toContain("__EVENTARGUMENT=Page%242");
      expect(calls[1].body).toContain("__VIEWSTATE=");
    } finally {
      Object.assign(sanAntonioDeps, saved);
    }
  });
});
