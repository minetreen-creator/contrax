import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bostonDeadline, fetchBostonBids, parseBostonPage } from "../src/jobs/sources/ma-boston";

const fixture = (page: number) => readFileSync(`src/jobs/sources/fixtures/ma-boston/open-page${page}-2026-10-11.html`, "utf8");
const now = Date.parse("2026-10-11T00:00:00Z");
const pages = [fixture(0), fixture(1)];
test("public board traverses both pages, including hauling and delivery", async () => {
  const visited: string[] = [];
  const mockFetch = (async (input: string | URL | Request) => {
    visited.push(String(input));
    return new Response(pages[Number(new URL(String(input)).searchParams.get("page") ?? 0)]);
  }) as typeof fetch;
  const result = await fetchBostonBids(now, mockFetch);
  assert.equal(visited.length, 2);
  assert.equal(result.rows.length, 20);
  assert.equal(new Set(result.rows.map(r => r.external_id)).size, 20);
  assert.ok(result.rows.some(r => /SNOW HAULING/.test(r.title)));
  assert.ok(result.rows.some(r => /TRAILER DELIVERY SERVICE/.test(r.title)));
  for (const row of result.rows) {
    assert.equal(row.location, "Boston, MA");
    assert.equal(row.agency, "City of Boston");
    assert.equal(row.naics_code, null);
    assert.equal(row.set_aside, null);
    assert.match(row.source_url, /^https:\/\/www.boston.gov\/bid-listings\//);
  }
  const landscape = result.rows.find(r => /LANDSCAPE MAINTENANCE/.test(r.title))!;
  assert.equal(landscape.solicitation_number, "EV00018038");
  assert.equal(landscape.due_date, "2026-10-20T18:00:00.000Z");
  assert.match(landscape.description, /Public Works/);
});
test("closing times respect DST, invalid dates and ambiguous times fail closed", () => {
  assert.equal(bostonDeadline("11/04/2026 - 12:00pm"), "2026-11-04T17:00:00.000Z");
  assert.equal(bostonDeadline("10/13/2026 - 12:00am"), "2026-10-13T04:00:00.000Z");
  for (const date of ["02/30/2026 - 2:00pm", "03/08/2026 - 2:30am", "11/01/2026 - 1:30am", "10/13/2026 - 0:00pm", "bad"]) assert.equal(bostonDeadline(date), null);
  assert.equal(parseBostonPage(pages[0], 0, Date.parse("2027-01-01")).rows.length, 0);
  assert.equal(parseBostonPage(pages[0], 0, Date.parse("2027-01-01")).skipped.closed, 10);
});
test("changed markup and missing closing times cannot masquerade as an empty board", () => {
  assert.throws(() => parseBostonPage("login", 0, now));
  assert.throws(() => parseBostonPage(pages[0].replace("Due:", "Published:"), 0, now));
  assert.throws(() => parseBostonPage(pages[1], 0, now));
  assert.throws(() => parseBostonPage("<h1>Bids and RFPs</h1>", 0, now));
  assert.equal(parseBostonPage('<h1>Bids and RFPs</h1><div class="views-empty">No open bids</div>', 0, now).rows.length, 0);
});
test("second-page failure rejects the entire fetch instead of returning partial results", async () => {
  let calls = 0;
  await assert.rejects(fetchBostonBids(now, (async () => ++calls === 1 ? new Response(pages[0]) : new Response("Unavailable", { status: 503 })) as typeof fetch));
  assert.equal(calls, 2);
});
