/**
 * PR-1 RESTRUCTURE — source-provenance class map pins.
 *
 * Owner-APPROVED source-to-jurisdiction policy (plan rev 315; sign-off table
 * `shared/source-jurisdiction-signoff-table-2026-09-23.md`). DETERMINISTIC and
 * network-free by construction: every input is a literal or a registry constant
 * imported from the repo. No DATABASE_URL.
 *
 * What it proves:
 *   1. the class map covers EVERY registry label (the 73 collectors + the label
 *      the national pass emits + the 5 legacy/internal labels = 79) and the
 *      derived federal set is the policy's 66;
 *   2. each owner ruling maps to exactly one class (va_evirginia FEDERAL with a
 *      VA scope flag, pennbid STATE(PA), the 51 doors FEDERAL, cities FEDERAL,
 *      chicago/sf/austin LOCAL + award, nys_socrata retired, INTERNAL no badge);
 *   3. the certification rule-3 defect is FIXED and MEASURED: the pre-PR-1
 *      predicate put a NULL federal set-aside into the Small-Business pool; the
 *      class-driven predicate does not (and a genuine state/local NULL still
 *      does, which is the rule's purpose);
 *   4. the award-exclusion predicate + SQL fragment used by the opportunity
 *      surfaces agree with AWARD_TYPE_SOURCES.
 */
import { describe, expect, test } from "bun:test";
import {
  AWARD_EXCLUSION_SQL,
  AWARD_TYPE_SOURCES,
  FEDERAL_LABELS,
  FEDERAL_TRADE_LABELS,
  INTERNAL_SOURCE_LABELS,
  LOCAL_LABELS,
  RETIRED_SOURCES,
  SOURCE_CLASSES,
  STATE_LABELS,
  isAwardTypeSource,
  isRetiredSource,
  resolveSourceClass,
  sourceBadgeLabel,
  sourceBadgeTone,
} from "~/lib/source-class";
import {
  FEDERAL_SOURCE_LABELS,
  NON_STATE_LOCAL_SOURCES,
  certMatches,
  isStateLocalSource,
} from "~/lib/cert-matching";
import { SAM_TRADE_FILTERS } from "~/jobs/sources/sam-gov-trades";
import { CITY_SOURCES } from "~/lib/city-procurement";
import { TAIL_SOURCES } from "~/jobs/runner";
import { US_STATES } from "~/lib/states";

const DOORS = US_STATES.map((c) => c.toLowerCase());

/** The PRE-PR-1 deny-list: only these 13 labels were kept out of the SB pool. */
const PRE_PR1_FEDERAL = new Set<string>([
  "sam_gov",
  "sam_gov_regional",
  ...SAM_TRADE_FILTERS.map((f) => f.name),
]);
/** The rule-3 predicate exactly as it stood before this PR. */
const prePr1IsStateLocal = (sources: string[]) =>
  sources.some((s) => !PRE_PR1_FEDERAL.has(String(s).toLowerCase().trim()));

describe("SOURCE_CLASSES — the approved class map (policy R8)", () => {
  test("79 entries: 73 registry labels + sam_gov_regional + 5 legacy/internal", () => {
    expect(Object.keys(SOURCE_CLASSES).length).toBe(79);
  });

  test("every registry label is classified (no collector is unclassified)", () => {
    const registry = [
      ...DOORS,
      "sam_gov",
      "cities",
      "pennbid",
      "va_evirginia",
      ...SAM_TRADE_FILTERS.map((f) => f.name),
      ...TAIL_SOURCES.map((s) => s.name),
    ];
    for (const label of registry) {
      expect(`${label}=${label in SOURCE_CLASSES}`).toBe(`${label}=true`);
    }
    // sam_gov_regional has no registry entry of its own — the trap this map must
    // not fall into (sam_gov's fetchFn emits it).
    expect("sam_gov_regional" in SOURCE_CLASSES).toBe(true);
    // the 73 collectors: the tail registry (7) already includes the retired
    // nys_socrata label, which PR-1 removed from TAIL_SOURCES, so the live
    // registry is 72 collectors = 73 labels minus the retired one.
    expect(TAIL_SOURCES.length).toBe(6);
  });

  test("every city registry entry the product fetches is LOCAL with a city name", () => {
    for (const city of CITY_SOURCES) {
      expect(`${city.name}=${resolveSourceClass(city.name)}`).toBe(`${city.name}=local`);
      expect(SOURCE_CLASSES[city.name]!.city!.length).toBeGreaterThan(0);
    }
  });

  test("the 51 state-name doors are FEDERAL with search-scope metadata (R2)", () => {
    expect(DOORS.length).toBe(51);
    for (const door of DOORS) {
      const rec = SOURCE_CLASSES[door]!;
      expect(`${door}=${rec.class}`).toBe(`${door}=federal`);
      expect(rec.searchScope).toBe("state-name-keyword");
      expect(String(rec.scopeState)).toBe(door.toUpperCase());
    }
  });

  test("the 11 trade passes are FEDERAL and the literals match SAM_TRADE_FILTERS", () => {
    expect([...FEDERAL_TRADE_LABELS].sort()).toEqual(
      SAM_TRADE_FILTERS.map((f) => f.name).sort(),
    );
    for (const f of SAM_TRADE_FILTERS) {
      expect(`${f.name}=${resolveSourceClass(f.name)}`).toBe(`${f.name}=federal`);
    }
  });

  test("the derived federal set is the policy's 66 labels", () => {
    expect(FEDERAL_LABELS.size).toBe(66);
    // cert-matching derives FEDERAL_SOURCE_LABELS from FEDERAL_TRADE + FEDERAL
    expect(FEDERAL_SOURCE_LABELS.size).toBe(66);
    for (const label of FEDERAL_LABELS) expect(FEDERAL_SOURCE_LABELS.has(label)).toBe(true);
    // …and the 53 SAM-derived "state" collectors are inside it (owner ruling f)
    for (const label of [...DOORS, "cities", "va_evirginia"]) {
      expect(`${label}=${FEDERAL_SOURCE_LABELS.has(label)}`).toBe(`${label}=true`);
    }
  });
});

describe("the owner's per-item rulings (exceptions a–e)", () => {
  test("va_evirginia is FEDERAL with a VA search-origin scope, never state/local", () => {
    const rec = SOURCE_CLASSES["va_evirginia"]!;
    expect(rec.class).toBe("federal");
    expect(rec.searchScope).toBe("state-pop");
    expect(rec.scopeState).toBe("VA");
    expect(sourceBadgeLabel("va_evirginia")).toBe("Federal");
    expect(isStateLocalSource(["va_evirginia"])).toBe(false);
  });

  test("pennbid is STATE (PA), badged as a state — not a city", () => {
    expect(resolveSourceClass("pennbid")).toBe("state");
    expect(SOURCE_CLASSES["pennbid"]!.scopeState).toBe("PA");
    expect(sourceBadgeLabel("pennbid")).toBe("State (PA)");
    expect(sourceBadgeTone("pennbid")).toBe("state");
    expect(isStateLocalSource(["pennbid"])).toBe(true);
  });

  test("the cities keyword pass is FEDERAL despite its name (R3/C1)", () => {
    expect(resolveSourceClass("cities")).toBe("federal");
    expect(SOURCE_CLASSES["cities"]!.searchScope).toBe("city-keyword");
  });

  test("chicago/sf/austin are LOCAL + award (ruling d); nyc/la are LOCAL + opportunity", () => {
    expect([...AWARD_TYPE_SOURCES].sort()).toEqual([
      "austin_open_data",
      "chicago_open_data",
      "sf_open_data",
    ]);
    for (const s of AWARD_TYPE_SOURCES) {
      expect(`${s}=${resolveSourceClass(s)}`).toBe(`${s}=local`);
      expect(SOURCE_CLASSES[s]!.recordType).toBe("award");
      expect(isAwardTypeSource(s)).toBe(true);
    }
    for (const s of ["nyc_open_data", "la_open_data"]) {
      expect(SOURCE_CLASSES[s]!.recordType).toBe("opportunity");
      expect(isAwardTypeSource(s)).toBe(false);
    }
    expect(isAwardTypeSource("oh_dayton")).toBe(false);
    expect(SOURCE_CLASSES["oh_dayton"]!.recordType).toBe("opportunity");
  });

  test("nys_socrata is RETIRED (ruling c) — class retained, never displayed as merely empty", () => {
    expect(isRetiredSource("nys_socrata")).toBe(true);
    expect(SOURCE_CLASSES["nys_socrata"]!.class).toBe("state");
    expect([...RETIRED_SOURCES].sort()).toEqual(["nyc_socrata", "nys_socrata"]);
  });

  test("the doors keep their 2-letter names — the class is recorded separately (ruling e)", () => {
    expect(SOURCE_CLASSES["oh"]!.class).toBe("federal");
    expect(SOURCE_CLASSES["oh"]!.city).toBe(undefined);
    expect(SOURCE_CLASSES["oh_dayton"]!.city).toBe("Dayton");
  });
});

describe("INTERNAL labels and unclassified labels (R6 / C7)", () => {
  test("md_dc, the demo/seed/fixture feeds and the dead NYC export are INTERNAL", () => {
    for (const label of ["md_dc", "contrax-demo", "seed", "fixture_test", "nyc_socrata"]) {
      expect(`${label}=${resolveSourceClass(label)}`).toBe(`${label}=internal`);
      expect(sourceBadgeLabel(label)).toBe(""); // ruling 1: no badge at all
      expect(sourceBadgeTone(label)).toBe("internal");
      expect(isStateLocalSource([label])).toBe(false);
    }
    expect(INTERNAL_SOURCE_LABELS.has("md_dc")).toBe(true);
    expect(LOCAL_LABELS.has("md_dc")).toBe(false);
    expect(STATE_LABELS.has("md_dc")).toBe(false);
  });

  test("an UNCLASSIFIED label is INTERNAL, never state/local by default (C7)", () => {
    expect(resolveSourceClass("some_future_portal")).toBe("internal");
    expect(sourceBadgeLabel("some_future_portal")).toBe("");
    expect(isStateLocalSource(["some_future_portal"])).toBe(false);
    expect(isStateLocalSource([""])).toBe(false);
    expect(isStateLocalSource(["  PA  "])).toBe(false);
    expect(sourceBadgeLabel("  SAM_GOV  ")).toBe("Federal"); // btrim + lowercase
    expect(SOURCE_CLASSES["MD_DC".toLowerCase()]!.class).toBe("internal");
  });

  test("the SQL award exclusion matches AWARD_TYPE_SOURCES", () => {
    expect(AWARD_EXCLUSION_SQL).toContain("NOT IN");
    for (const s of AWARD_TYPE_SOURCES) expect(AWARD_EXCLUSION_SQL).toContain(`'${s}'`);
    expect(AWARD_EXCLUSION_SQL).not.toContain("nyc_open_data");
  });
});

describe("the certificate rule-3 defect — BEFORE and AFTER (owner ruling f)", () => {
  test("BEFORE: a NULL set-aside from a SAM-derived label entered the SMB pool", () => {
    // The pre-PR-1 deny-list held only 13 labels, so every one of the 53
    // SAM-derived labels below was read as a pursuable state/local posting.
    for (const label of ["oh", "al", "wy", "cities", "va_evirginia", "md_dc"]) {
      expect(`${label}=${prePr1IsStateLocal([label])}`).toBe(`${label}=true`);
    }
  });

  test("AFTER: a federal NULL set-aside is never a state/local opportunity", () => {
    for (const label of ["sam_gov", "sam_gov_regional", "oh", "al", "wy", "cities", "va_evirginia"]) {
      expect(`${label}=${certMatches(null, [label], "sb")}`).toBe(`${label}=null`);
    }
    // …including the 11 trade passes and the retired federal-sync label
    for (const f of SAM_TRADE_FILTERS) {
      expect(`${f.name}=${certMatches(null, [f.name], "sb")}`).toBe(`${f.name}=null`);
    }
    expect(certMatches(null, ["md_dc"], "sb")).toBe(null);
  });

  test("AFTER: a genuine state/local NULL set-aside is still pursuable (rule 3 kept)", () => {
    expect(certMatches(null, ["pennbid"], "sb")).toBe("include");
    expect(certMatches(null, ["oh_dayton"], "sb")).toBe("include");
    expect(certMatches(null, ["chicago_open_data"], "sb")).toBe("include");
    expect(certMatches(null, ["nyc_open_data"], "sb")).toBe("include");
    expect(certMatches(null, [], "sb")).toBe(null);
  });

  test("the sb SQL window still excludes every known non-state-local label", () => {
    // SUPERSET contract: the window's deny-list must cover the 66 federal + the
    // 5 internal labels, so the JS rule (authoritative) never sees a federal
    // NULL row it would have to drop one by one.
    expect(NON_STATE_LOCAL_SOURCES.size).toBe(71);
    for (const label of FEDERAL_SOURCE_LABELS) expect(NON_STATE_LOCAL_SOURCES.has(label)).toBe(true);
    for (const label of INTERNAL_SOURCE_LABELS) expect(NON_STATE_LOCAL_SOURCES.has(label)).toBe(true);
    expect(NON_STATE_LOCAL_SOURCES.has("pennbid")).toBe(false);
    expect(NON_STATE_LOCAL_SOURCES.has("oh_dayton")).toBe(false);
  });

  test("the badge is class-driven for every corpus label shape", () => {
    expect(sourceBadgeLabel("sam_gov")).toBe("Federal");
    expect(sourceBadgeLabel("sam_naics_561720")).toBe("Federal");
    expect(sourceBadgeLabel("nyc_open_data")).toBe("New York City");
    expect(sourceBadgeLabel("chicago_open_data")).toBe("Chicago");
    expect(sourceBadgeLabel("la_open_data")).toBe("Los Angeles");
    expect(sourceBadgeLabel("sf_open_data")).toBe("San Francisco");
    expect(sourceBadgeLabel("austin_open_data")).toBe("Austin");
    expect(sourceBadgeLabel("oh_dayton")).toBe("Dayton");
    expect(sourceBadgeLabel(null)).toBe("");
    expect(sourceBadgeLabel(undefined)).toBe("");
  });
});
