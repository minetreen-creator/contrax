import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseSanDiegoCountyPages } from "./ca-san-diego-county";
const pages = [1, 2].map(n => readFileSync(new URL(`./fixtures/ca-san-diego-county/open-page-${n}.html`, import.meta.url), "utf8"));
const now = Date.parse("2026-10-12T19:00:00Z");
describe("San Diego County BuyNet", () => {
 test("real public pages merge lots and use authoritative countdown deadlines", () => {
  const r = parseSanDiegoCountyPages(pages, now);
  expect(r.rows.length).toBeGreaterThan(10);
  expect(new Set(r.rows.map(x => x.external_id)).size).toBe(r.rows.length);
  expect(r.skipped.duplicate_lot).toBeGreaterThan(0);
  const water = r.rows.find(x => x.solicitation_number === "BPM013394")!;
  expect(water.agency).toBe("County of San Diego");
  expect(water.due_date!.slice(0, 19)).toBe("2026-10-31T00:00:00");
 });
 test("closed, held and missing-date records never become open opportunities", () => {
  expect(parseSanDiegoCountyPages(pages, Date.parse("2027-01-01")).rows).toHaveLength(0);
  expect(parseSanDiegoCountyPages(pages.map(x => x.replaceAll('>Open</td>', '>On Hold</td>')), now).rows).toHaveLength(0);
  expect(parseSanDiegoCountyPages(pages.map(x => x.replaceAll('rfp-end-date=', 'missing-date=')), now).rows).toHaveLength(0);
 });
});
