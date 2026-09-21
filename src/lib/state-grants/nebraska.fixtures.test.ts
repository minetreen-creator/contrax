/**
 * NEBRASKA FIXTURE TESTS — deterministic, ZERO network (owner guardrail
 * 2026-09-19: ordinary CI never touches a live website). Every payload here is
 * built from the real trimmed captures in `./fixtures/` (one per fetched page) and
 * joined with the shared multi-page delimiters, exactly as `fetch()` joins them.
 *
 * The live half is `nebraska.source-validation.test.ts` (opt-in).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  STATE_GRANT_STATUSES,
  parseGrantOpportunities,
  type SourceGrantRecord,
} from "~/lib/state-grants/connector";
import { joinSourcePages } from "~/lib/state-grants/connectors/multi-page";
import { stripTags } from "~/lib/state-grants/connectors/source-support";
import {
  NEBRASKA_CHILD_PAGES,
  NEBRASKA_INDEX_MARKER,
  NEBRASKA_PROGRAMME_PATHS,
  NEBRASKA_SOURCE_URL,
  nebraskaConnector,
} from "~/lib/state-grants/connectors/nebraska";
/** One fixed clock for every classification below (2026-09-19, US Eastern). */
const NOW = new Date("2026-09-19T12:00:00Z");
function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}
/** The fixture file for one pinned programme path (the generator's own rule). */
function fileFor(path: string): string {
  return `nebraska-${path.replace(/\/$/, "").replace(/\//g, "-")}.html`;
}
const INDEX_FILE = "nebraska-programs-index.html";
const PAYLOAD = () =>
  joinSourcePages(
    NEBRASKA_SOURCE_URL,
    fixture(INDEX_FILE),
    NEBRASKA_PROGRAMME_PATHS.map((path, i) => ({
      url: NEBRASKA_CHILD_PAGES[i]!,
      html: fixture(fileFor(path)),
    })),
  );
const NE = () => parseGrantOpportunities(nebraskaConnector, PAYLOAD(), NOW).opportunities;
const byStatus = (status: string) => NE().filter((o) => o.status === status);
const parsed = (raw: string): SourceGrantRecord[] => nebraskaConnector.parse(raw);
describe("Nebraska DED programme windows (fixtures)", () => {
  test("reads one record per published window, from every pinned page", () => {
    const records = NE();
    expect(records.length).toBe(67);
    expect(byStatus("closed").length).toBe(43);
    expect(byStatus("open").length).toBe(9);
    expect(byStatus("rolling").length).toBe(6);
    expect(byStatus("unverified").length).toBe(9);
    // Every pinned page contributes at least one record (no page is dead weight).
    const urls = new Set(records.map((o) => o.url));
    expect(urls.size).toBe(NEBRASKA_CHILD_PAGES.length);
  });
  test("the owner's five statuses only — `forecast` is gone", () => {
    for (const o of NE()) {
      expect(STATE_GRANT_STATUSES).toContain(o.status);
      expect(o.status as string).not.toBe("forecast");
      expect(o.closeDate === null || o.estimatedCloseDate === null).toBe(true);
    }
  });
  test("every record points at a pinned DED page, never the portal or the listing", () => {
    for (const o of NE()) {
      expect(NEBRASKA_CHILD_PAGES).toContain(o.url);
      expect(o.url.startsWith(NEBRASKA_SOURCE_URL)).toBe(true);
      expect(o.sourceUrl).toBe(NEBRASKA_SOURCE_URL);
      expect(o.url).not.toContain("amplifund.com");
    }
  });
  test("the two index links that 404 are never fetched", () => {
    for (const slug of ["accredited-job-training-act", "customized-job-training"]) {
      expect(NEBRASKA_CHILD_PAGES.some((u) => u.endsWith(`/${slug}/`))).toBe(false);
    }
  });
  test("the index itself contributes no record and no date", () => {
    const indexOnly = parseGrantOpportunities(
      nebraskaConnector,
      joinSourcePages(NEBRASKA_SOURCE_URL, fixture(INDEX_FILE), []),
      NOW,
    ).opportunities;
    expect(indexOnly.length).toBe(0);
    expect(stripTags(fixture(INDEX_FILE))).toContain(NEBRASKA_INDEX_MARKER);
  });
  test("`rolling` comes only from the source's own open-ended wording", () => {
    const rolling = byStatus("rolling");
    expect(rolling.length).toBeGreaterThan(0);
    for (const o of rolling) {
      expect(o.raw.rollingDeclaredBySource).toBe(true);
      expect(o.raw.rollingSentence).toMatch(/open cycle|rolling|ongoing/i);
      expect(o.closeDate).toBeNull();
    }
  });
  test("a programme the source says is not taking applications is `closed`", () => {
    const shovel = NE().find((o) => o.url.endsWith("/business/shovel-ready-grants/"))!;
    expect(shovel.status).toBe("closed");
    expect(shovel.closeDate).toBeNull();
    expect(String(shovel.raw.closedSentence)).toContain("funds have been awarded");
    const renew = NE().find((o) => o.url.endsWith("/incentives/renewable-chemical-production/"))!;
    expect(renew.status).toBe("closed");
    expect(renew.closeDate).toBeNull();
    expect(renew.raw.sourceClosedDeclaredBySource).toBe(true);
  });
  test("the Film Office close date is read through the source's invisible marks", () => {
    const film = NE().find((o) => o.url.endsWith("/incentives/film-office-grant/"))!;
    expect(film.closeDate).toBe("2025-06-08");
    expect(film.status).toBe("closed");
  });
  test("a year-less deadline never invents a year", () => {
    const cdbg = NE().filter((o) => o.url.endsWith("/community/cdbg/"));
    expect(cdbg.length).toBe(6);
    const yearless = cdbg.filter((o) => String(o.raw.windowText).includes("Sept. 15"));
    expect(yearless.length).toBe(4);
    for (const o of yearless) {
      expect(o.closeDate).toBeNull();
      expect(o.postedDate).toBeNull();
      expect(o.status).toBe("unverified");
      expect(o.statusReason).toContain("no usable dates");
    }
    expect(NE().some((o) => o.closeDate === "2026-09-15")).toBe(false);
  });
  test("a REFUSED label's date never becomes a record's date", () => {
    const internships = NE().find((o) => o.url.endsWith("/recovery/internships-and-crime-prevention/"))!;
    // The page publishes `Letter of Intent: October 31, 2022` and an anticipated
    // award date; only the labelled window is read.
    expect(internships.closeDate).toBe("2022-11-14");
    expect(internships.postedDate).toBe("2022-11-03");
    const refusedDays = ["2022-10-31", "2022-11-01", "2022-12-01"];
    for (const o of NE()) {
      expect(refusedDays).not.toContain(o.closeDate);
      expect(o.raw.refusedDatesNeverCloseDates).toBe(true);
    }
    const qct = NE().find((o) => o.url.endsWith("/recovery/qct-recovery-grant-program/") && o.raw.refusedDates);
    expect(String(qct!.raw.refusedDates)).toContain("Letter of Intent Deadline");
  });
  test("a multi-period block is refused, not averaged", () => {
    const rural = NE().find((o) => o.url.endsWith("/community/rural-projects/"))!;
    expect(rural.status).toBe("unverified");
    expect(rural.closeDate).toBeNull();
    expect(rural.postedDate).toBeNull();
    expect(rural.raw.multiPeriodBlockRefused).toBe(true);
    expect(String(rural.raw.windowText)).toContain("Sept. 3, 2025");
  });
  test("every title is the source's own module heading, verbatim on its page", () => {
    for (const o of NE()) {
      const path = NEBRASKA_PROGRAMME_PATHS.find((_, i) => NEBRASKA_CHILD_PAGES[i] === o.url)!;
      const pageText = stripTags(fixture(fileFor(path)));
      const key = o.title.replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
      expect(pageText).toContain(key);
    }
  });
  test("no stored `raw` field carries the private block-boundary marker", () => {
    // FOUND ON THE LIVE PRODUCTION SYNC (2026-09-21): `raw.windowText` kept the
    // connector's own block delimiter — a literal NUL — and Postgres `jsonb`
    // REFUSES `\u0000` ("unsupported Unicode escape sequence"), so Nebraska's whole
    // per-state transaction rolled back: 0 of 67 rows written. The marker is an
    // in-code splitting device; it must never reach a stored string. Before the
    // fix this fixture corpus carried 852 of them (windowText 795, rollingSentence
    // 56, closedSentence 1) — asserted here so the class cannot regress.
    const withNul: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "string") {
        if (value.includes("\u0000")) withNul.push(path);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          walk(v, `${path}.${k}`);
        }
      }
    };
    const records = NE();
    expect(records.length).toBe(67);
    for (const o of records) walk(o.raw, `${o.externalId}.raw`);
    expect(withNul).toEqual([]);
    // The same bytes reaching Postgres must survive the round trip it refused.
    for (const o of records) {
      expect(JSON.stringify(o.raw)).not.toContain("\\u0000");
    }
  });
  test("a payload that is not this source fails the gate loudly", () => {
    let thrown: unknown = null;
    try {
      parsed("<html><body>nope</body></html>");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect((thrown as { stage?: string }).stage).toBe("parse");
  });
});
