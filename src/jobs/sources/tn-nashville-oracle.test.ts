import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  adfLoopbackUrl,
  adfLoopId,
  fetchTnNashvilleBids,
  NASHVILLE_ABSTRACTS_URL,
  nashvilleDeps,
  nashvilleTime,
  parseNashvilleAbstracts,
} from "./tn-nashville-oracle";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { LOCAL_AGENCIES } from "~/lib/local-agencies";

// Owner 2026-11-06: a Nashville paving customer signed up; Contrax had no Metro Nashville source.
const fx = (f: string) => readFileSync(new URL(`./fixtures/tn-nashville-oracle/${f}`, import.meta.url), "utf8");
const now = Date.parse("2026-11-06T21:30:00Z");

describe("Metro Nashville on Oracle iSupplier", () => {
  test("the captured list parses to its Active negotiations, one per base number", () => {
    const { rows, skipped } = parseNashvilleAbstracts(fx("open-2026-11-06.html"), now);
    expect(rows.map((r) => r.solicitation_number)).toEqual(["GG000123", "GG000106-2", "GG000118", "GG000092", "GG000113", "GG000115"]);
    expect(skipped).toEqual({ not_active: 15 });
    const tourism = rows[0];
    expect(tourism.external_id).toBe("nashville-GG000123");
    expect(tourism.title).toBe("Tourism and Convention Sales & Marketing Services");
    expect(tourism.agency).toBe("Metro Nashville");
    expect(tourism.location).toBe("Nashville, TN");
    expect(tourism.notice_type).toBe("RFQ");
    expect(tourism.due_date).toBe("2026-12-04T20:00:00.000Z"); // 2:00 PM CST
    expect(tourism.source_url).toBe(NASHVILLE_ABSTRACTS_URL);
    expect(rows.find((r) => r.solicitation_number === "GG000115")!.title).toBe("Concrete and Brick Sands");
    expect(parseNashvilleAbstracts(fx("open-2026-11-06.html"), Date.parse("2027-01-01T00:00:00Z")).rows).toHaveLength(0);
  });

  test("Nashville local time converts with daylight saving", () => {
    expect(nashvilleTime("12/4/2026 2:00 PM")).toBe("2026-12-04T20:00:00.000Z");
    expect(nashvilleTime("7/1/2026 9:30 AM")).toBe("2026-07-01T14:30:00.000Z");
    expect(nashvilleTime("13/1/2026 9:30 AM")).toBeNull();
    expect(nashvilleTime("")).toBeNull();
  });

  test("the loopback step uses the id ADF's first page asks for", () => {
    const loop = adfLoopId(fx("loopback-2026-11-06.html"));
    expect(loop).toMatch(/^\d{10,}$/);
    expect(adfLoopbackUrl(NASHVILLE_ABSTRACTS_URL, loop!)).toContain(`&_afrLoop=${loop}&_afrWindowMode=0`);
    expect(() => parseNashvilleAbstracts(fx("loopback-2026-11-06.html"), now)).toThrow();
  });

  test("the reader makes the two requests and fails loudly when the page changes", async () => {
    const saved = { ...nashvilleDeps };
    const calls: string[] = [];
    try {
      nashvilleDeps.fetch = async (url) => {
        calls.push(url);
        return new Response(calls.length === 1 ? fx("loopback-2026-11-06.html") : fx("open-2026-11-06.html"), { status: 200 });
      };
      expect((await fetchTnNashvilleBids(now)).rows).toHaveLength(6);
      expect(calls).toHaveLength(2);
      expect(calls[1]).toContain("_afrLoop=");
      nashvilleDeps.fetch = async () => new Response("<html>nothing</html>", { status: 200 });
      await expect(fetchTnNashvilleBids(now)).rejects.toThrow();
    } finally {
      Object.assign(nashvilleDeps, saved);
    }
  });

  test("scheduled, classified local, placed in Tennessee, with an agency page", () => {
    expect(TAIL_SOURCES.some((t) => t.name === "tn_nashville")).toBe(true);
    expect(SOURCE_CLASSES.tn_nashville?.class).toBe("local");
    expect(SOURCE_HOME_JURISDICTIONS.tn_nashville).toBe("TN");
    expect(LOCAL_AGENCIES.some((a) => a.source === "tn_nashville")).toBe(true);
  });
});
