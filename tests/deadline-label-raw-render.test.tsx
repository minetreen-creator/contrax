/**
 * RAW PUBLISHED-DATE RENDERS — owner follow-up to #616 (2026-10-08).
 *
 * #616 stopped DERIVING countdowns from the five zone-unverified Virginia
 * sources. This suite pins the other half: the surfaces that print a bid's
 * close date VERBATIM must not shift it either.
 *
 * The QA finding: `va_eva` (and the four Virginia CivicEngage boards) publish
 * `closedate` as a bare-`Z` instant that is really EASTERN WALL-CLOCK
 * (`2026-10-15T02:00:00Z` ⇒ the true close is the 15th). A US browser's
 * `toLocaleDateString` with no `timeZone` renders that "Oct 14" — a day early,
 * and no longer the value as published. The owner ruled the TRUE close is the
 * published Eastern WALL-CLOCK DATE, so a flagged row's raw-date label must
 * render the UTC date ("Oct 15").
 *
 * DETERMINISTIC, network-free AND database-free by construction: every input is
 * a literal or the repo's own source text, and the components are rendered
 * in-process with `react-dom/server` (the technique of
 * tests/funnel-ux-radar-render.test.tsx). No DATABASE_URL, no clock, no fetch,
 * and deliberately NO `mock.module` (bun's mock registry is process-global and
 * leaks across files in one run — skill contrax-bun-mock-module-leak).
 *
 * ZONE INDEPENDENCE: the "already UTC-safe" pins below assert the UTC calendar
 * day, which holds in EVERY reader zone (a local-midnight Date built from the
 * UTC date parts always formats to that same day). Verified locally under
 * TZ=UTC, TZ=America/New_York and TZ=Asia/Tokyo.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveOpportunity } from "~/lib/live-opportunities";
import { LiveOpportunities } from "~/components/LiveOpportunities";
import { BidCard as SeoBidCard, fmtDue } from "~/lib/seo-landing";
import { dateOnly } from "~/lib/brief-source";
import {
  COUNTDOWN_SUPPRESSED_SOURCES,
  publishedDateOnlyFor,
  publishedDateText,
} from "~/lib/deadline-label";

const ROOT = join(import.meta.dir, "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** The QA finding's exact shape: an Eastern wall-clock close read as UTC. */
const EVA_INSTANT = "2026-10-15T02:00:00Z";
/** What the awards card hands its formatter (`toISODate` → date-only string). */
const EVA_DATE_ONLY = "2026-10-15";
/** The published date, UTC-rendered. The reader's zone must never change it. */
const EVA_UTC_LABEL = "Oct 15, 2026";

describe("the raw-date render gate", () => {
  test("every pinned (zone-unverified) source renders the published UTC date", () => {
    expect(COUNTDOWN_SUPPRESSED_SOURCES.length).toBe(5);
    for (const source of COUNTDOWN_SUPPRESSED_SOURCES) {
      expect(publishedDateOnlyFor(EVA_INSTANT, source)).toBe(EVA_UTC_LABEL);
    }
  });

  test("the three input shapes the six surfaces actually pass all agree", () => {
    // radar / map / seo: the stored instant as a string; awards: date-only;
    // the Neon timestamptz driver: a Date object.
    expect(publishedDateOnlyFor(EVA_INSTANT, "va_eva")).toBe(EVA_UTC_LABEL);
    expect(publishedDateOnlyFor(EVA_DATE_ONLY, "va_eva")).toBe(EVA_UTC_LABEL);
    expect(publishedDateOnlyFor(new Date(EVA_INSTANT), "va_eva")).toBe(EVA_UTC_LABEL);
    // The gate IS `publishedDateText` (one formatter, one answer).
    expect(publishedDateText(EVA_INSTANT)).toBe(EVA_UTC_LABEL);
  });

  test("the UTC day is NOT the day a US browser would shift it to", () => {
    // The bug this gate closes: the same instant rendered in the reader's zone.
    const readerZone = new Date(EVA_DATE_ONLY).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    // In UTC (this sandbox/CI) both spellings agree — so the literal pins above
    // are the proof; this line documents the US-zone divergence the owner ruled
    // on ("Oct 14" under TZ=America/New_York, measured 2026-10-08).
    if (new Date().getTimezoneOffset() < 0) {
      expect(readerZone).toBe("Oct 14, 2026");
    }
    expect(new Date(EVA_DATE_ONLY).getUTCDate()).toBe(15);
  });

  test("unflagged, unknown and NULL sources are untouched (fail-open)", () => {
    for (const source of [
      "sam_gov", "", "VA_EVA", "va_fairfax_bonfire", "va_alexandria_bonfire",
      "oh_dayton", "pennbid", "unknown_source",
    ]) {
      expect(publishedDateOnlyFor(EVA_INSTANT, source)).toBeNull();
    }
    expect(publishedDateOnlyFor(EVA_INSTANT, null)).toBeNull();
    expect(publishedDateOnlyFor(EVA_INSTANT, undefined)).toBeNull();
  });

  test("a flagged source with an unreadable/absent date falls back to the caller", () => {
    expect(publishedDateOnlyFor(null, "va_eva")).toBeNull();
    expect(publishedDateOnlyFor("", "va_eva")).toBeNull();
    expect(publishedDateOnlyFor("not a date", "va_eva")).toBeNull();
  });
});

// ── SEO landing BidCard — `Closes {due}` ─────────────────────────────────────
const seoBid = (source: string | null, due: string | null = EVA_INSTANT) => ({
  id: 1, title: "Janitorial services, Richmond VA", agency: "Commonwealth of Virginia",
  description: null, due_date: due, estimated_value: null, naics_code: null,
  location: "Richmond, VA", set_aside: "SDVOSB", source_url: "https://eva.example/1",
  source, head_start_until: null,
});
const renderSeoCard = (source: string | null, due: string | null = EVA_INSTANT): string =>
  renderToStaticMarkup(SeoBidCard({ b: seoBid(source, due) } as any) as any);
const dueSpanOf = (html: string): string => html.match(/Closes [^<]*/)?.[0] ?? "";

describe("SEO landing BidCard — 'Closes …'", () => {
  test("a flagged source closes on the published UTC date", () => {
    expect(dueSpanOf(renderSeoCard("va_eva"))).toBe("Closes Oct 15, 2026");
    expect(dueSpanOf(renderSeoCard("va_charlottesville"))).toBe("Closes Oct 15, 2026");
  });

  test("an unflagged source keeps the pre-change render, byte for byte", () => {
    const unflagged = dueSpanOf(renderSeoCard("sam_gov"));
    expect(unflagged).toBe(`Closes ${fmtDue(EVA_INSTANT)}`);
    // …and the same for a NULL source (fail-open).
    expect(dueSpanOf(renderSeoCard(null))).toBe(unflagged);
    // The card still carries its real link + agency: only the date label moved.
    expect(renderSeoCard("va_eva")).toContain("https://eva.example/1");
  });

  test("an unreadable date on a flagged source still renders the old wording", () => {
    expect(renderSeoCard("va_eva", "Not specified")).not.toContain("Closes Oct 15, 2026");
  });
});

// ── Homepage live-opportunities strip — ALREADY UTC-SAFE (no change) ─────────
const stripBid = (): LiveOpportunity => ({
  id: 7, title: "Janitorial services", agency: "Commonwealth of Virginia",
  location: "Richmond, VA", category: null, set_aside: "SDVOSB",
  due_date: EVA_INSTANT,
});
const renderStrip = (due: string | null): string =>
  renderToStaticMarkup(LiveOpportunities({ bids: [{ ...stripBid(), due_date: due }] }) as any);

describe("homepage live-opportunities strip — already UTC-safe, unchanged", () => {
  test("the bare-Z instant renders the UTC calendar day, in every reader zone", () => {
    // A local-midnight Date built from the UTC date parts always formats to the
    // same calendar day, so this literal holds for any TZ (verified under
    // TZ=UTC / America/New_York / Asia/Tokyo).
    const utcDayLabel = new Date(2026, 9, 15).toLocaleDateString("en-US", {
      month: "short", day: "numeric",
    });
    expect(utcDayLabel).toBe("Oct 15");
    expect(renderStrip(EVA_INSTANT)).toContain(`Due ${utcDayLabel}`);
  });

  test("the proof is in the formatter: UTC date parts ⇒ local midnight", () => {
    const src = read("src/components/LiveOpportunities.tsx");
    expect(src).toContain("const iso = d.toISOString().slice(0, 10);");
    expect(src).toContain("const date = new Date(parts[0], parts[1] - 1, parts[2]);");
  });

  test("this PR deliberately did NOT touch the strip's payload or render", () => {
    // No `source` column added, no gate added: the render is already correct, so
    // a gate would be dead code (see the PR description's per-surface table).
    expect(read("src/lib/live-opportunities.ts")).not.toContain("publishedDateOnlyFor");
    expect(read("src/components/LiveOpportunities.tsx")).not.toContain("publishedDateOnlyFor");
    expect(read("src/lib/live-opportunities.ts")).toContain(
      "SELECT id, title, agency, location, category, set_aside, due_date",
    );
  });
});

// ── My Pipeline — ALREADY UTC-SAFE (no change) ───────────────────────────────
describe("My Pipeline — already UTC-safe, unchanged", () => {
  test("the payload pre-slices to a UTC date-only string", () => {
    expect(dateOnly(EVA_INSTANT)).toBe(EVA_DATE_ONLY);
    expect(read("src/routes/api/my-pipeline.ts")).toContain("due_date: dateOnly(r.due_date),");
  });

  test("its fmtDate renders date-only strings in UTC (the precedent)", () => {
    expect(read("src/routes/pipeline.tsx")).toContain(
      'timeZone: /^\\d{4}-\\d{2}-\\d{2}$/.test(d) ? "UTC" : undefined,',
    );
    // The two halves composed: date-only payload + UTC label = the published day.
    expect(
      new Date(EVA_DATE_ONLY).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
      }),
    ).toBe(EVA_UTC_LABEL);
    expect(read("src/routes/pipeline.tsx")).toContain("Due {fmtDate(item.due_date)}");
    expect(read("src/routes/pipeline.tsx")).not.toContain("publishedDateOnlyFor");
  });
});

// ── Wiring: every GATED raw-date render reads the row's `source` ─────────────
describe("wiring — the four gated surfaces carry source to the render", () => {
  const cases: Array<{ file: string; needles: string[] }> = [
    {
      file: "src/routes/awards.tsx",
      needles: [
        "publishedDateOnlyFor(bid.due_date, bid.source) ?? fmtDate(bid.due_date)",
        "source: b.source ? String(b.source) : null,",
        "due_date, estimated_value, category, source FROM bids",
        "source: string | null;",
      ],
    },
    {
      file: "src/routes/map.tsx",
      needles: [
        "publishedDateOnlyFor(bid.due_date, bid.source) ?? fmtDate(bid.due_date)",
        "source: r.source ? String(r.source) : null,",
        "due_date, source_url, source",
      ],
    },
    {
      file: "src/components/SavedRadarMatches.tsx",
      needles: [
        "publishedDateOnlyFor(m.due_date, m.source) ?? fmtDate(m.due_date)",
        "source?: string | null;",
      ],
    },
    {
      file: "src/routes/api/saved-radar-matches.ts",
      needles: ["source: m.source ?? null,"],
    },
    {
      file: "src/lib/seo-landing.tsx",
      needles: [
        "publishedDateOnlyFor(b.due_date, b.source) ?? fmtDue(b.due_date)",
        "source: r.source ? String(r.source) : null,",
      ],
    },
  ];
  for (const { file, needles } of cases) {
    test(`${file} — gate + payload`, () => {
      const src = read(file);
      for (const needle of needles) expect(src).toContain(needle);
    });
  }

  test("the Radar scan payload carries `source`; scoring is untouched", () => {
    const radar = read("src/routes/radar.tsx");
    expect(radar.split("source: bid.source,").length - 1).toBe(3); // match + 2 related
    expect(radar).toContain("  source: string | null;");
    // #616's label suppression stays the only countdown rule, and the
    // closing-soon SCORE still reads the real deadline (never the gate): the
    // computeMatch call sites are unchanged.
    expect(radar.split("days_remaining: suppressedDays(bid)").length - 1).toBe(3);
    expect(radar.split("computeMatch(bid, {").length - 1).toBe(2);
  });
});
