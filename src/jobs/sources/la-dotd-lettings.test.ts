import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { TAIL_SOURCES } from "../runner";
import {
  fetchLaDotdLettingBids,
  LA_DOTD_SOURCE,
  laDotdDeps,
  lettingDueIso,
  noticeLettingDate,
  parishLocation,
  parseLaDotdNotice,
  readLettingNotices,
  readNoticeProposals,
} from "./la-dotd-lettings";

// Owner 2026-11-04: a New Llano, LA visitor found 25 construction bids → "yes" to more LA sources.
const fx = (name: string) => readFileSync(new URL(`./fixtures/la-dotd/${name}-2026-11-04.html`, import.meta.url), "utf8");
const index = fx("index");
const NOW = Date.parse("2026-11-04T20:00:00Z");
const UPCOMING = ["an0320261201", "an6220261119", "anhq20261118", "an5820261117", "an0320261113", "an5820261110"];

describe("LA DOTD construction lettings", () => {
  test("the lettings page lists each Notice to Contractors once, newest first", () => {
    const notices = readLettingNotices(index);
    expect(notices.length).toBeGreaterThan(30);
    expect(new Set(notices.map((n) => n.file)).size).toBe(notices.length);
    expect(notices[0]).toEqual({ file: "an0320261201.aspx", date: "12/01/2026", label: "Lafayette" });
    expect(notices.slice(0, 6).map((n) => n.file.replace(".aspx", ""))).toEqual(UPCOMING);
  });

  test("bids are due at 10:00 a.m. Central on the letting date", () => {
    expect(lettingDueIso("11/10/2026")).toBe("2026-11-10T16:00:00.000Z");
    expect(lettingDueIso("TBD")).toBeNull();
    expect(noticeLettingDate(fx("an5820261110"))).toBe("11/10/2026");
  });

  test("each upcoming notice parses to its proposals", () => {
    const counts = Object.fromEntries(UPCOMING.map((f) => [f, readNoticeProposals(fx(f)).length]));
    expect(counts).toEqual({ an0320261201: 2, an6220261119: 3, anhq20261118: 25, an5820261117: 1, an0320261113: 1, an5820261110: 1 });
  });

  test("a proposal becomes an open construction bid with its parishes, cost range and notice page", () => {
    const { rows, skipped } = parseLaDotdNotice(fx("an5820261110"), "an5820261110.aspx", NOW);
    expect(skipped).toEqual({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      external_id: "ladotd-4400035317-R1",
      title: "D58 CROSS DRAIN REPLACEMENT — Caldwell, Catahoula, Concordia, Franklin Parishes",
      agency: "Louisiana Department of Transportation and Development",
      location: "Caldwell, Catahoula, Concordia, Franklin Parishes, LA",
      category: "Construction",
      due_date: "2026-11-10T16:00:00.000Z",
      estimated_value: "$1,000,000 to $2,500,000",
      solicitation_number: "4400035317-R1",
      notice_type: "Construction letting",
      source_url: "https://wwwapps.dotd.la.gov/engineering/lettings/bidsadvn/an5820261110.aspx",
    });
    expect(rows[0].description).toContain("work: cross drain replacement");
    expect(rows[0].description).toContain("11/10/2026 letting");
  });

  test("the Headquarters letting reads 25 road and bridge jobs", () => {
    const { rows } = parseLaDotdNotice(fx("anhq20261118"), "anhq20261118.aspx", NOW);
    expect(rows).toHaveLength(25);
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(25);
    expect(rows.find((r) => r.external_id === "ladotd-H.014981.6")?.title).toStartWith("HOSSTON RIVER ROAD BRIDGE OVER KELLY BAYOU");
    for (const r of rows) {
      expect(r.location.endsWith(", LA") || r.location === "Louisiana").toBe(true);
      expect(r.estimated_value).not.toBe("");
    }
  });

  test("parish names read naturally; Washington Parish never reads as Washington state", () => {
    expect(parishLocation(["Caldwell"])).toBe("Caldwell Parish, LA");
    expect(parishLocation(["Jackson", "Lincoln"])).toBe("Jackson, Lincoln Parishes, LA");
    expect(parishLocation(["Washington"])).toBe("Louisiana");
    expect(parishLocation([])).toBe("Louisiana");
  });

  test("past lettings are closed", () => {
    const later = parseLaDotdNotice(fx("an5820261110"), "an5820261110.aspx", Date.parse("2026-11-11T00:00:00Z"));
    expect(later.rows).toHaveLength(0);
    expect(later.skipped.closed).toBe(1);
  });

  test("the sync reads only upcoming notices and returns every proposal", async () => {
    const urls: string[] = [];
    const saved = { ...laDotdDeps };
    laDotdDeps.pause = async () => {};
    laDotdDeps.fetch = async (url) => {
      urls.push(url);
      const f = /bidsadvn\/(an[a-z0-9]+)\.aspx$/.exec(url)?.[1];
      return new Response(f ? fx(f) : index, { status: 200 });
    };
    try {
      const res = await fetchLaDotdLettingBids(NOW);
      expect(res.rows).toHaveLength(33);
      expect(new Set(res.rows.map((r) => r.external_id)).size).toBe(33);
      expect(urls).toHaveLength(1 + UPCOMING.length);
    } finally {
      Object.assign(laDotdDeps, saved);
    }
  });

  test("a notice page with no proposals fails loudly instead of ingesting part of the lettings", async () => {
    const saved = { ...laDotdDeps };
    laDotdDeps.pause = async () => {};
    laDotdDeps.fetch = async (url) => new Response(url.includes("bidsadvn") ? "<html>maintenance</html>" : index, { status: 200 });
    try {
      await expect(fetchLaDotdLettingBids(NOW)).rejects.toThrow();
    } finally {
      Object.assign(laDotdDeps, saved);
    }
  });

  test("registered as a Louisiana state source in the sync", () => {
    expect(TAIL_SOURCES.some((s) => s.name === LA_DOTD_SOURCE)).toBe(true);
    expect(SOURCE_CLASSES[LA_DOTD_SOURCE]).toMatchObject({ class: "state", scopeState: "LA" });
    expect(SOURCE_HOME_JURISDICTIONS[LA_DOTD_SOURCE]).toBe("LA");
  });
});
