import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv, paDate, reviewExport } from "./pa-emarketplace-csv.ts";

test("Pennsylvania deadline respects summer and winter offsets", () => {
  assert.equal(paDate("10/16/2026 1:00:00 PM").iso, "2026-10-16T17:00:00.000Z");
  assert.equal(paDate("12/16/2026 1:00:00 PM").iso, "2026-12-16T18:00:00.000Z");
  assert.equal(paDate("2/30/2026 1:00:00 PM").reason, "invalid_date");
  assert.equal(paDate("12/31/9999").reason, "placeholder_date");
  assert.equal(paDate("10/16/2026").reason, "date_only_deadline");
});
test("official export accounts for every row and excludes non-bids", () => {
  const csv = readFileSync(new URL("./fixtures/pa-emarketplace/solicitations-2026-09-29.csv", import.meta.url), "utf8");
  const r = reviewExport(csv, new Date("2026-09-29T20:19:00Z"));
  assert.equal(r.fetched, 184);
  assert.equal(r.accepted.length + r.skippedRows.length, 184);
  assert.ok(r.accepted.some(x => x["Bid No"] === "275878"));
  assert.ok(!r.accepted.some(x => x["Bid No"] === "COSTARS 5 Rebid"));
  assert.ok(r.accepted.every(x => new Date(x.due_iso) > new Date("2026-09-29T20:19:00Z")));
  const base = parseCsv(csv).find(x => x["Bid No"] === "275878")!;
  const fields = Object.keys(base);
  const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
  const line = fields.map(k => quote(base[k])).join(",");
  const duplicated = reviewExport(fields.join(",") + "\n" + line + "\n" + line, new Date("2026-09-29T20:19:00Z"));
  assert.equal(duplicated.accepted.length, 1);
  assert.equal(duplicated.skipped.duplicate_export_identity, 1);
});
