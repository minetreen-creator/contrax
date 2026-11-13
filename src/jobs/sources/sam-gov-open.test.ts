import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fetchOpenSamSolicitations, isStillOpen, samOpenDeps, samOpenSweepDue, samOpenUrl } from "./sam-gov-open";

// Owner 2026-11-13 ("we need thousands"): about 1,900 open SAM.gov solicitations were missing.
const real = { ...samOpenDeps };
afterEach(() => Object.assign(samOpenDeps, real));
const NOW = Date.parse("2026-11-13T16:00:00Z");

test("queries by notice type only (SAM returns 0 when state= is combined), 100 per page", () => {
  const u = samOpenUrl("k", 3, "-modifiedDate");
  expect(u).toContain("notice_type=k");
  expect(u).toContain("size=100");
  expect(u).toContain("page=3");
  expect(u).not.toContain("state=");
});

test("keeps only solicitations whose response date is still ahead", () => {
  expect(isStillOpen({ responseDate: "2026-11-30T14:00:00+00:00" }, NOW)).toBe(true);
  expect(isStillOpen({ responseDate: "2026-03-11T18:00:00+00:00" }, NOW)).toBe(false);
  expect(isStillOpen({ responseDate: null }, NOW)).toBe(false);
});

test("runs once a day, in the 04:00 UTC sync window", () => {
  expect(samOpenSweepDue(Date.parse("2026-11-13T04:10:00Z"), false)).toBe(true);
  expect(samOpenSweepDue(Date.parse("2026-11-13T12:10:00Z"), false)).toBe(false);
  expect(samOpenSweepDue(Date.parse("2026-11-13T12:10:00Z"), true)).toBe(true);
});

test("pages each type, drops closed ones, makes no per-notice detail request, and stops on a refusal", async () => {
  const urls: string[] = [];
  const item = (id: string, due: string) => ({ _id: id, title: `Roof repair ${id}`, responseDate: due, type: { code: "k", value: "Combined Synopsis/Solicitation" }, organizationHierarchy: [{ name: "Department of the Army" }], descriptions: [] });
  Object.assign(samOpenDeps, {
    now: () => NOW,
    sleep: async () => {},
    fetch: async (url: string) => {
      urls.push(url);
      if (!url.includes("sam.gov/api/prod/sgs/v1/search/")) throw new Error("unexpected detail request");
      const results = url.includes("notice_type=o") ? [item("a", "2026-12-01T00:00:00Z"), item("b", "2026-01-01T00:00:00Z")] : [item("c", "2026-12-05T00:00:00Z")];
      return new Response(JSON.stringify({ page: { totalElements: results.length }, _embedded: { results } }), { status: 200 });
    },
  });
  const bids = await fetchOpenSamSolicitations();
  expect(bids.map((b) => b.external_id).sort()).toEqual(["sam-a", "sam-c"]);
  expect(bids.every((b) => b.source_label === "sam_gov")).toBe(true);
  expect(urls.length).toBe(2);

  samOpenDeps.fetch = async () => new Response("", { status: 403 });
  await expect(fetchOpenSamSolicitations()).rejects.toThrow("refused");
});

test("the sam_gov source adds the sweep once a day and keeps its own passes if the sweep fails", () => {
  const runner = readFileSync(new URL("../runner.ts", import.meta.url), "utf8");
  expect(runner).toContain("if (!samOpenSweepDue(Date.now())) return merged;");
  expect(runner).toContain("SAM.gov open sweep skipped");
});
