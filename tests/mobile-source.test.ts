import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchMobileBids, mobileDeadline, parseMobileHtml } from "../src/jobs/sources/al-mobile";
const html = readFileSync("src/jobs/sources/fixtures/al-mobile/open-2026-10-11.html", "utf8");
const now = Date.parse("2026-10-11T12:00:00Z");
test("captures all four official notices with stable identities and Central deadlines", () => {
  const result = parseMobileHtml(html, now);
  assert.equal(result.rows.length, 4);
  assert.equal(new Set(result.rows.map(r => r.external_id)).size, 4);
  const tires = result.rows.find(r => r.solicitation_number === "6077")!;
  assert.match(tires.title, /LARGE TRUCK TIRES/);
  assert.equal(tires.due_date, "2026-10-23T17:01:00.000Z");
  assert.equal(tires.source_url, "https://www.cityofmobile.gov/bids/?bid=4257");
  assert.equal(result.rows.find(r => r.solicitation_number === "2020-2060-01")!.due_date, "2026-11-12T20:30:00.000Z");
  for (const row of result.rows) { assert.equal(row.location, "Mobile, AL"); assert.equal(row.naics_code, null); assert.equal(row.set_aside, null); }
});
test("rejects invalid dates and DST gaps/folds; skips closed notices", () => {
  assert.equal(mobileDeadline("Mon, Feb 30, 2026", "2:30pm"), null);
  assert.equal(mobileDeadline("Sun, Mar 08, 2026", "2:30am"), null);
  assert.equal(mobileDeadline("Sun, Nov 01, 2026", "1:30am"), null);
  assert.equal(mobileDeadline("Wed, Oct 21, 2026", "0:30pm"), null);
  assert.equal(parseMobileHtml(html, Date.parse("2027-01-01")).skipped.closed, 4);
});
test("missing or changed board data fails rather than claiming zero bids", () => {
  assert.throws(() => parseMobileHtml("login", now));
  assert.throws(() => parseMobileHtml(html.replace(/\d{1,2}:\d{2}[ap]m/g, "unknown"), now));
  assert.throws(() => parseMobileHtml(html.replace("Date Due", "Date Posted"), now));
  assert.throws(() => parseMobileHtml(html.replace(/<tbody>[\s\S]*?<\/tbody>/, "<tbody></tbody>"), now));
  assert.equal(parseMobileHtml(html.replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody><tr><td colspan="6">No open bids</td></tr></tbody>'), now).rows.length, 0);
});
test("HTTP failure rejects the source; live-fetch seam preserves parsed rows", async () => {
  await assert.rejects(fetchMobileBids(now, (async () => new Response("unavailable", {status: 503})) as typeof fetch));
  assert.equal((await fetchMobileBids(now, (async () => new Response(html)) as typeof fetch)).rows.length, 4);
});
test("hand-typed times: spaced, dotted, upper case, no minutes, noon", () => {
  const due = (t: string) => mobileDeadline("Thu, Nov 12, 2026", t);
  assert.equal(due("2:30pm"), "2026-11-12T20:30:00.000Z");
  for (const t of ["2:30 pm", "2:30 PM", "2:30 p.m.", "2:30P.M."]) assert.equal(due(t), "2026-11-12T20:30:00.000Z", t);
  assert.equal(due("10am"), "2026-11-12T16:00:00.000Z");
  assert.equal(due("10 A.M."), "2026-11-12T16:00:00.000Z");
  for (const t of ["Noon", "12:00 noon", "NOON"]) assert.equal(due(t), "2026-11-12T18:00:00.000Z", t);
  for (const t of ["TBD", "", "2:30", "14:30pm", "2:75pm"]) assert.equal(due(t), null, t);
});
test("one unreadable closing time skips that notice instead of sinking the board", () => {
  const result = parseMobileHtml(html.replace("12:01pm", "TBD"), now);
  assert.equal(result.rows.length, 3);
  assert.equal(result.skipped.bad_date, 1);
  assert.equal(result.skippedRows.find(r => r.reason === "bad_date")!.id, "mobile-4257");
});
test("one row missing its bid number or link is skipped; a board with none complete still fails", () => {
  const result = parseMobileHtml(html.replace(/href="[^"]*\?bid=\d+"/, ""), now);
  assert.equal(result.rows.length, 3);
  assert.equal(result.skipped.missing_fields, 1);
  assert.match(result.skippedRows.find(r => r.reason === "missing_fields")!.id, /^mobile-row-\d+$/);
  assert.throws(() => parseMobileHtml(html.replace(/href="[^"]*\?bid=\d+"/g, ""), now), /identity missing on every row/);
});
