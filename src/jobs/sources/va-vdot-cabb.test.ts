import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { expandTrade, isStrongTradeMatch } from "~/lib/trade-registry";
import { TAIL_SOURCES } from "../runner";
import {
  cabbLocation,
  cabbNextTarget,
  cabbPlaces,
  cabbTotal,
  parseVdotCabb,
  fetchVaVdotCabbBids,
  readCabbRows,
  VDOT_CABB_SOURCE,
  vdotCabbDeps,
} from "./va-vdot-cabb";

const pageN = (n: number) => readFileSync(new URL(`./fixtures/va-vdot-cabb/advertisements-2026-11-04-page${n}.html`, import.meta.url), "utf8");
const page1 = pageN(1);
const NOW = Date.parse("2026-11-04T04:00:00Z");

describe("VDOT CABB (owner 2026-11-04: more construction bids in VA)", () => {
  test("page 1 lists 20 of 54 advertised projects and links to the next page", () => {
    const rows = readCabbRows(page1);
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((r) => r.id)).size).toBe(20);
    expect(cabbTotal(page1)).toBe(54);
    expect(cabbNextTarget(page1)).toContain("projectsDatapager");
    expect(rows[0]).toMatchObject({
      id: "12864",
      order: "B38",
      letDate: "12/16/2026",
      places: "MARTINSVILLE",
      value: "$3,427,000.00",
      description: "SMART SCALE - ROADWAY AND PEDESTRIAN IMPROVEMENTS",
    });
  });

  test("a row becomes an open construction bid with its letting date, value and project page", () => {
    const { rows, skipped } = parseVdotCabb(readCabbRows(page1), NOW);
    expect(skipped).toEqual({});
    expect(rows).toHaveLength(20);
    const b38 = rows.find((r) => r.external_id === "vdotcabb-12864")!;
    expect(b38).toMatchObject({
      title: "SMART SCALE - ROADWAY AND PEDESTRIAN IMPROVEMENTS — Martinsville",
      agency: "Virginia Department of Transportation",
      location: "Martinsville, VA",
      category: "Construction",
      due_date: "2026-12-16T05:00:00.000Z",
      estimated_value: "$3,427,000",
      solicitation_number: "0057-120-302, M501",
      notice_type: "Construction letting",
      source_url: "https://cabb.virginiadot.org/AdProjectHistory.aspx?AD_PRJ_ID=12864",
    });
    expect(b38.description).toContain("order B38");
    expect(b38.description).toContain("12/16/2026 letting");
    for (const r of rows) expect(Date.parse(r.due_date!)).toBeGreaterThan(NOW);
  });

  test("places read naturally; Washington County never reads as Washington state", () => {
    expect(cabbPlaces("BEDFORD, FRANKLIN")).toBe("Bedford, Franklin");
    expect(cabbLocation("Bedford, Franklin")).toBe("Bedford, Franklin, VA");
    expect(cabbLocation("Smyth, Washington")).toBe("Virginia");
    expect(cabbLocation("Various")).toBe("Virginia");
  });

  test("past lettings are closed; nothing is invented when fields are missing", () => {
    const later = parseVdotCabb(readCabbRows(page1), Date.parse("2026-12-17T00:00:00Z"));
    expect(later.rows).toHaveLength(0);
    expect(later.skipped.closed).toBe(20);
    const bad = parseVdotCabb([{ ...readCabbRows(page1)[0], letDate: "TBD" }, { ...readCabbRows(page1)[1], description: "" }], NOW);
    expect(bad.skipped).toEqual({ bad_date: 1, missing_fields: 1 });
  });

  test("paving searches find VDOT's mix schedules", () => {
    const construction = expandTrade("paving")!;
    for (const t of ["2027 PLANT MIX - SECONDARY", "2027 LATEX MODIFIED - PRIMARY/SECONDARY", "2027 CAPE SEAL - SECONDARY"]) {
      expect(isStrongTradeMatch(t, "Construction", "", null, construction)).toBe(true);
    }
  });

  test("the sync reads every page through the list's own Next postback", async () => {
    const calls: { method: string; target: string | null; cookie: string | null }[] = [];
    const saved = { ...vdotCabbDeps };
    vdotCabbDeps.pause = async () => {};
    vdotCabbDeps.fetch = async (_url, init) => {
      const body = init.body instanceof URLSearchParams ? init.body : null;
      calls.push({ method: String(init.method), target: body?.get("__EVENTTARGET") ?? null, cookie: (init.headers as any)?.cookie ?? null });
      const n = calls.length;
      return new Response(pageN(n), { status: 200, headers: n === 1 ? { "set-cookie": "ASP.NET_SessionId=abc; path=/; HttpOnly" } : {} });
    };
    try {
      const res = await fetchVaVdotCabbBids(NOW);
      expect(res.rows).toHaveLength(54);
      expect(new Set(res.rows.map((r) => r.external_id)).size).toBe(54);
      expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "POST"]);
      expect(calls[1].target).toContain("projectsDatapager");
      expect(calls[1].cookie).toBe("ASP.NET_SessionId=abc");
      expect(res.rows.find((r) => r.external_id === "vdotcabb-12797")).toMatchObject({ title: "BRIDGE REPLACEMENT — Fauquier", estimated_value: "$44,539,000" });
    } finally {
      Object.assign(vdotCabbDeps, saved);
    }
  });

  test("a short read fails loudly instead of ingesting part of the list", async () => {
    const saved = { ...vdotCabbDeps };
    vdotCabbDeps.pause = async () => {};
    vdotCabbDeps.fetch = async () => new Response(page1, { status: 200 });
    try {
      await expect(fetchVaVdotCabbBids(NOW)).rejects.toThrow();
    } finally {
      Object.assign(vdotCabbDeps, saved);
    }
  });

  test("registered as a Virginia state source in the sync", () => {
    expect(TAIL_SOURCES.some((s) => s.name === VDOT_CABB_SOURCE)).toBe(true);
    expect(SOURCE_CLASSES[VDOT_CABB_SOURCE]).toMatchObject({ class: "state", scopeState: "VA" });
    expect(SOURCE_HOME_JURISDICTIONS[VDOT_CABB_SOURCE]).toBe("VA");
  });
});
