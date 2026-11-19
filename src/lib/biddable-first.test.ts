import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { biddableFirst } from "./biddable-first";

const now = new Date("2026-11-19T15:00:00Z");
const row = (id: number, due: string | null) => ({ id, due_date: due });

describe("biddableFirst", () => {
  test("bids with a week or more left lead, then closing-soon, then undated", () => {
    const out = biddableFirst([row(1, "2026-11-19T22:00:00Z"), row(2, "2026-11-20"), row(3, null), row(4, "2026-11-27"), row(5, "2026-12-15")], now);
    expect(out.map((r) => r.id)).toEqual([4, 5, 1, 2, 3]);
  });

  test("keeps every row and the order inside each group", () => {
    const rows = [row(1, "2026-12-01"), row(2, "2026-11-21"), row(3, "2026-12-02"), row(4, "2026-11-22"), row(5, "not a date")];
    const out = biddableFirst(rows, now);
    expect(out.length).toBe(rows.length);
    expect(out.map((r) => r.id)).toEqual([1, 3, 2, 4, 5]);
  });

  test("a list with nothing a week out is left as it was", () => {
    const rows = [row(1, "2026-11-20"), row(2, "2026-11-21")];
    expect(biddableFirst(rows, now)).toEqual(rows);
  });

  test("the state and trade page uses it before cutting the list to 25", () => {
    const src = readFileSync(new URL("./seo-landing.tsx", import.meta.url), "utf8");
    expect(src).toContain("bids: biddableFirst(bids).slice(0, 25)");
  });

  test("the awards list never leads with a start date in the future", () => {
    const src = readFileSync(new URL("./federal-awards.server.ts", import.meta.url), "utf8");
    expect(src).toContain("start_date <= CURRENT_DATE");
  });

  test("the directory route under /suppliers does not override the supplier page title", () => {
    const src = readFileSync(new URL("../routes/suppliers/index.tsx", import.meta.url), "utf8");
    expect(src).not.toContain("Small Business Subcontractor Directory");
  });

  test("the Terms describe the one-time pass", () => {
    const src = readFileSync(new URL("../routes/terms/index.tsx", import.meta.url), "utf8");
    expect(src).toContain("does not renew");
  });
});
