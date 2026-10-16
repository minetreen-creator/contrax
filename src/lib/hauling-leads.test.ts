/**
 * Hauling leads — the pure ladder, pinned to a committed capture. DETERMINISTIC and
 * network-free by construction: every byte read is the verbatim USAspending slice in
 * src/lib/fixtures/hauling-leads/lexicon-slice.json (see that directory's README for
 * the capture date and the sha256 of the rows array), and no DATABASE_URL, clock or
 * fetch is involved.
 *
 * The suite pins the whole owner-endorsed definition R (proposal sections 4-5) rung by
 * rung — 1,775 keyword rows -> 99 at R on the full 12-month capture — and every
 * precomputed field the sync job writes (scope_kind, prime_kind, the USAspending URL
 * and the stored description snippet).
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  HAULING_KEYWORDS,
  HAULING_LEAD_FIELDS,
  HAULING_LEAD_MIN_AMOUNT,
  HAULING_LEAD_WINDOW_DAYS,
  HAULING_SCOPE_KINDS,
  buildHaulingSearchBody,
  classifyPrimeKind,
  classifyScopeKind,
  descriptionHasHaulingScope,
  haulsScopePipeline,
  naicsCode,
  normalizeDescription,
  toHaulingLead,
  windowStartFor,
  type HaulingLead,
} from "~/lib/hauling-leads";

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/hauling-leads/lexicon-slice.json", import.meta.url), "utf8"),
) as { captured_at: string; rows: Record<string, unknown>[] };

/** The window the capture was measured against (the proposal's 12-month window). */
const WINDOW_START = "2025-10-16";

const pipeline = haulsScopePipeline(FIXTURE.rows, { windowStart: WINDOW_START });
const keptKeys = pipeline.kept.map((l) => l.award_key);

function countBy<T extends string>(values: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

describe("the captured slice is the one the tests were written against", () => {
  test("119 rows, and the rows hash is the recorded one", () => {
    expect(FIXTURE.rows.length).toBe(119);
    expect(createHash("sha256").update(JSON.stringify(FIXTURE.rows)).digest("hex")).toBe(
      "9effb603c46e70129eac0b879fe1553469856dad846e3a34523273bdcab61e13",
    );
    expect(FIXTURE.captured_at).toBe("2026-10-16");
  });

  test("every row carries the USAspending identity the ladder keys on", () => {
    for (const row of FIXTURE.rows) {
      expect(typeof row["generated_internal_id"]).toBe("string");
      expect(typeof row["Award ID"]).toBe("string");
      expect(typeof row["Recipient Name"]).toBe("string");
    }
  });
});

describe("definition R over the captured slice", () => {
  test("the ladder keeps exactly the 99 measured R rows, and drops the rest per rung", () => {
    expect(pipeline.offered).toBe(119);
    expect(pipeline.kept.length).toBe(99);
    expect(pipeline.dropped).toEqual({
      missing_identity: 0,
      below_min_amount: 3,
      bad_or_missing_date: 0,
      outside_window: 3,
      carrier_naics: 4,
      non_service_naics: 4,
      no_scope_wording: 3,
      winner_name_is_hauling_firm: 3,
    });
  });

  test("nothing is counted twice: 99 distinct award keys", () => {
    expect(new Set(keptKeys).size).toBe(99);
  });

  test("every kept row is a new award of at least $25,000", () => {
    for (const lead of pipeline.kept) {
      expect(lead.award_date! >= WINDOW_START).toBe(true);
      expect(lead.amount).toBeGreaterThanOrEqual(HAULING_LEAD_MIN_AMOUNT);
    }
  });

  test("no kept row is a freight/courier/postal or vehicle/equipment award", () => {
    for (const lead of pipeline.kept) {
      expect(/^(4841|4842|4921|4922|4911|4884|4885)/.test(lead.naics_code ?? "")).toBe(false);
      expect(
        /^(3331|3361|3362|3363|3364|3365|3366|3369|5321|5324|4231|4238|4239|4411|4412|4413)/.test(
          lead.naics_code ?? "",
        ),
      ).toBe(false);
    }
  });

  test("every kept row's stored snippet really carries the hauling scope wording", () => {
    for (const lead of pipeline.kept) {
      expect(descriptionHasHaulingScope(lead.description_snippet)).toBe(true);
    }
  });

  test("every kept row's winner name is not one of the K5 bare-word hauling firms", () => {
    for (const lead of pipeline.kept) {
      expect(/\b(truck|haul|freight|transport|logistic|drayage|cartage|disposal|waste|recycl|towing)\b/i.test(lead.prime_name)).toBe(
        false,
      );
    }
  });

  test("the measured mix is pinned: scope_kind and prime_kind", () => {
    expect(countBy(pipeline.kept.map((l) => l.scope_kind))).toEqual({
      "debris/emergency": 44,
      "waste/refuse": 42,
      "road/aggregate": 9,
      "other/hauling": 4,
    });
    expect(countBy(pipeline.kept.map((l) => l.prime_kind))).toEqual({
      "work prime": 84,
      "carrier/waste firm": 15,
    });
  });

  test("the measured geography is pinned: 36 states/territories, 18 rows stating none", () => {
    const states = pipeline.kept.map((l) => l.pop_state);
    expect(states.filter((s) => s === null).length).toBe(18);
    expect(new Set(states.filter((s): s is string => !!s)).size).toBe(36);
    expect(countBy(states.filter((s): s is string => !!s)).CA).toBe(9);
    expect(countBy(states.filter((s): s is string => !!s)).OR).toBe(7);
  });

  test("every value written into a scope field is inside its documented domain", () => {
    for (const lead of pipeline.kept as HaulingLead[]) {
      expect(HAULING_SCOPE_KINDS).toContain(lead.scope_kind);
      expect(["work prime", "carrier/waste firm"]).toContain(lead.prime_kind);
      expect(lead.hauling_scope).toBe(true);
    }
  });

  test("every kept row carries a source link, an id and a stored snippet", () => {
    for (const lead of pipeline.kept) {
      expect(lead.usa_spending_url).toBe(
        `https://www.usaspending.gov/award/${encodeURIComponent(lead.award_key)}`,
      );
      expect(lead.award_id.length).toBeGreaterThan(0);
      expect(lead.description_snippet.length).toBeGreaterThan(0);
      expect(lead.description_snippet.length).toBeLessThanOrEqual(500);
      expect(/\s{2,}/.test(lead.description_snippet)).toBe(false);
    }
  });
});

describe("the ladder's negative controls (each a real captured row)", () => {
  test("a below-floor award, an old award, a carrier, an equipment buy, no scope wording, a hauling winner", () => {
    const droppedAwardKeys = new Set(
      FIXTURE.rows.map((r) => String(r["generated_internal_id"])).filter((k) => !keptKeys.includes(k)),
    );
    expect(droppedAwardKeys.size).toBe(20);
    // A $12,400 award cannot be a lead even with perfect wording.
    expect(
      toHaulingLead(
        { ...FIXTURE.rows[0]!, "Award Amount": 12_400 },
        { windowStart: WINDOW_START },
      ),
    ).toBeNull();
    // An award made before the window is a modification, not a new lead.
    expect(
      toHaulingLead({ ...FIXTURE.rows[0]!, "Base Obligation Date": "2025-01-05" }, { windowStart: WINDOW_START }),
    ).toBeNull();
  });

  test("identity-less and unreadable-date rows are dropped, never stored with placeholders", () => {
    const base = FIXTURE.rows[0]!;
    const { "generated_internal_id": _drop, ...noKey } = base;
    expect(toHaulingLead(noKey, { windowStart: WINDOW_START })).toBeNull();
    const { "Award ID": _drop2, ...noId } = base;
    expect(toHaulingLead(noId, { windowStart: WINDOW_START })).toBeNull();
    const { "Recipient Name": _drop3, ...noName } = base;
    expect(toHaulingLead(noName, { windowStart: WINDOW_START })).toBeNull();
    expect(
      toHaulingLead({ ...base, "Base Obligation Date": "not a date" }, { windowStart: WINDOW_START }),
    ).toBeNull();
    const synth = haulsScopePipeline(
      [
        { ...base, "generated_internal_id": "" },
        { ...base, "Base Obligation Date": "" },
        { ...base, "Base Obligation Date": "not a date" },
      ],
      { windowStart: WINDOW_START },
    );
    expect(synth.dropped.missing_identity).toBe(1);
    expect(synth.dropped.bad_or_missing_date).toBe(2);
    expect(synth.kept.length).toBe(0);
  });
});

describe("the pure pieces the precomputed fields rest on", () => {
  test("classifyScopeKind applies a documented precedence and never invents a family", () => {
    expect(classifyScopeKind("SOLID WASTE HAULING AND ROAD GRAVEL")).toBe("waste/refuse");
    expect(classifyScopeKind("EMERGENCY DEBRIS REMOVAL ON COUNTY ROADS")).toBe("debris/emergency");
    expect(classifyScopeKind("AGGREGATE SURFACING AND DUMP TRUCK HAUL")).toBe("road/aggregate");
    // Wording that names no family stays honest instead of guessing one.
    expect(classifyScopeKind("DOUBLE D HAULING LLC ORMHF000688 E548")).toBe("other/hauling");
    expect(classifyScopeKind("")).toBe("other/hauling");
  });

  test("classifyPrimeKind reads the winner's NAME only, and its suffixed forms", () => {
    expect(classifyPrimeKind("SOUTHERN OREGON SANITATION LLC")).toBe("carrier/waste firm");
    expect(classifyPrimeKind("SCOTTS HAULING & EXCAVATING INC")).toBe("carrier/waste firm");
    expect(classifyPrimeKind("HUNT'S TRUCKING LLC")).toBe("carrier/waste firm");
    expect(classifyPrimeKind("ECC CONSTRUCTORS LLC")).toBe("work prime");
    expect(classifyPrimeKind("DRC EMERGENCY SERVICES LLC")).toBe("work prime");
  });

  test("naicsCode reads the object form and the bare form; missing codes never match", () => {
    expect(naicsCode({ code: "562111", description: "SOLID WASTE COLLECTION" })).toBe("562111");
    expect(naicsCode("237110")).toBe("237110");
    expect(naicsCode(null)).toBeNull();
    expect(naicsCode(undefined)).toBeNull();
    const { NAICS: _drop, ...noNaics } = FIXTURE.rows.find(
      (r) => String((r.NAICS as { code?: string })?.code ?? "").startsWith("5621"),
    )!;
    expect(toHaulingLead(noNaics, { windowStart: WINDOW_START })).toBeNull();
  });

  test("normalizeDescription collapses and caps, so a snippet is one line", () => {
    expect(normalizeDescription("  DEBRIS\n  REMOVAL\tAT LONG BEACH ")).toBe("DEBRIS REMOVAL AT LONG BEACH");
    expect(normalizeDescription("x".repeat(600)).length).toBe(500);
    expect(normalizeDescription(null)).toBe("");
  });

  test("windowStartFor is a rolling window, and the window is 30 days by design", () => {
    expect(HAULING_LEAD_WINDOW_DAYS).toBe(30);
    expect(windowStartFor(new Date("2026-10-16T03:00:00Z"))).toBe("2026-09-16");
    expect(windowStartFor(new Date("2026-11-01T03:00:00Z"))).toBe("2026-10-02");
  });
});

describe("the request the job sends (pinned so the arm cannot drift silently)", () => {
  test("new awards only, the 10-term lexicon, the $25k floor, and the fields we store", () => {
    const body = buildHaulingSearchBody({ startDate: "2026-09-16", endDate: "2026-10-16" }) as {
      filters: Record<string, unknown>;
    };
    expect(body.filters.award_type_codes).toEqual(["A", "B", "C", "D"]);
    expect(body.filters.time_period).toEqual([
      { start_date: "2026-09-16", end_date: "2026-10-16", date_type: "new_awards_only" },
    ]);
    expect(body.filters.keywords).toEqual([...HAULING_KEYWORDS]);
    expect(body.filters.keywords).toHaveLength(10);
    expect(body.filters.award_amounts).toEqual([{ lower_bound: HAULING_LEAD_MIN_AMOUNT }]);
    expect(HAULING_LEAD_MIN_AMOUNT).toBe(25_000);
    expect(body.fields).toEqual([...HAULING_LEAD_FIELDS]);
    expect(body.limit).toBe(100);
    expect(body.subawards).toBe(false);
  });

  test("the fields requested are exactly the ones the mapper reads", () => {
    for (const field of [
      "Award ID",
      "Recipient Name",
      "Award Amount",
      "Base Obligation Date",
      "Description",
      "Place of Performance State Code",
      "Place of Performance City Name",
      "NAICS",
      "generated_internal_id",
    ]) {
      expect([...HAULING_LEAD_FIELDS]).toContain(field);
    }
  });
});
