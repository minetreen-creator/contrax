/**
 * SOURCE PROVENANCE CLASSES — PR-1 restructure.
 *
 * Policy: the SOURCE-TO-JURISDICTION POLICY the owner APPROVED on 2026-09-23
 * (plan rev 315; sign-off table `shared/source-jurisdiction-signoff-table-2026-09-23.md`,
 * rules R1–R8 + exceptions a–e + conflict behavior C1–C8). The short version:
 *
 *   R1/R2/R3  anything that queries the FEDERAL SAM.gov API is FEDERAL — the
 *             51 state-name keyword "doors" and the `cities` keyword pass
 *             included. A state name or "City of" is a SEARCH TERM, not a
 *             jurisdiction (C1: origin wins over the label).
 *   R4        a collector that fetches one city's OWN board / open-data dataset
 *             is LOCAL.
 *   R5        a state portal / state open-data system is STATE (its buyers being
 *             municipalities does not downgrade it).
 *   R6        internal / demo / seed / retired labels are INTERNAL — never a
 *             jurisdiction, never counted in coverage.
 *   R7        a US-state stamp comes only from the row's own place of
 *             performance (or a genuine state-body buyer) — never from the
 *             source name or the search term. (Unchanged here: that rule lives
 *             in `location-state.ts`; this module only records CLASS.)
 *   R8        the class is recorded as a PROPERTY of each source. No source is
 *             renamed, no dedupe key changes, no row is relabelled.
 *
 * The owner's per-item rulings that shape this table:
 *   a. `va_evirginia` → FEDERAL with a separate Virginia search-origin flag. It
 *      must NEVER receive a VA state/local badge because Virginia was used as a
 *      federal search term.
 *   b. `pennbid` → STATE (PA) — a statewide platform is not one city's board.
 *      "unless individual records carry authoritative local-agency jurisdiction"
 *      is NOT implementable today: RawBid has no jurisdiction field and the
 *      buyer is free text in `agency`. Per-record local jurisdiction is future
 *      metadata work (do NOT conflate it with SOURCE_HOME_JURISDICTIONS, which
 *      is a write-path geography pin, not a jurisdiction badge).
 *   c. `nys_socrata` → RETIRED (dead 404 collector, 0 rows). Retired, NOT
 *      displayed as merely empty.
 *   d. Chicago/SF/Austin Open Data ingest AWARDED CONTRACTS, not open
 *      opportunities: keep the rows as award/incumbent intelligence, but keep
 *      them out of every opportunity surface (see AWARD_TYPE_SOURCES).
 *   e. the 51 doors KEEP their existing 2-letter names (a rename would churn
 *      18,831 legacy rows' attribution and dedupe keys for no user gain) — the
 *      class is recorded separately instead.
 *   f. the 53 SAM-derived "state" collectors are reclassified as FEDERAL feeds
 *      with search-scope metadata: a MISSING federal set-aside must never be
 *      read as a state/local small-business opportunity (see the rule-3 fix in
 *      `cert-matching.ts`).
 *
 * PURE MODULE (same contract as `cert-matching.ts`): no `~/db`, no server fns,
 * no `node:*`, no `process.env` at import time. It is reachable from CLIENT
 * code (`routes/alerts.tsx` renders the badge), so it must stay a plain data
 * table + pure functions.
 *
 * COVERAGE BASIS (measured against production on 2026-09-23, SELECT-only):
 * `SELECT source, count(*) FROM bids GROUP BY 1` returns 73 distinct labels and
 * all 73 are classified here; production also carries the legacy/internal
 * labels `md_dc` (226 rows), `contrax-demo` (13) and `seed` (10). The map has 79
 * entries: the 73 registry labels + `sam_gov_regional` (a label the national
 * pass emits but that has no registry entry of its own) + the 5 legacy/internal
 * labels.
 *
 * CONVENTION SUPERSEDED: `cert-matching.ts` used to document "adding a NEW STATE
 * SOURCE requires NO code change" (a deny-list: anything not on the federal
 * list was assumed state/local). The approved policy reverses that default
 * (C7): an UNCLASSIFIED label is INTERNAL/unknown and is NEVER treated as
 * state/local until it is independently validated and added to this table.
 */
import { US_STATES } from "./states";

/** The four provenance classes (R8). */
export type SourceClass = "federal" | "state" | "local" | "internal";

/**
 * Opportunity vs award. `undefined` means OPPORTUNITY — the default for a
 * collector that ingests open solicitations.
 */
export type SourceRecordType = "opportunity" | "award";

/**
 * `searchScope` records HOW a federal feed reached SAM.gov. It is metadata for
 * provenance display and future scope-aware surfaces — never a jurisdiction.
 */
export type SourceSearchScope =
  /** the national SAM.gov pass */
  | "national"
  /** the additive regional pass (states=[...US_STATES]) inside the national pass */
  | "regional"
  /** one SAM.gov free-text `q=<StateName>` query per state (the 51 doors) */
  | "state-name-keyword"
  /** the SAM.gov "City of"/"County of"/"Metropolitan" keyword query */
  | "city-keyword"
  /** a federal SAM.gov pass gated on a real state place-of-performance filter */
  | "state-pop"
  /** one SAM.gov structured NAICS/PSC filter (the trade passes) */
  | "structured-trade-filter"
  /** a state's own portal / open-data system */
  | "state-portal"
  /** a single city's own board / open-data dataset */
  | "city-open-data";

export interface SourceClassRecord {
  class: SourceClass;
  searchScope?: SourceSearchScope;
  /** The state the source's own system belongs to / the door was cut for. */
  scopeState?: string;
  /** Display name of the city for a LOCAL source (the badge text). */
  city?: string;
  recordType?: SourceRecordType;
  /** True only for a collector that has been retired and no longer runs. */
  retired?: boolean;
}

/**
 * The 11 structured-filter trade passes (janitorial + trucking, owner PRIORITY
 * 09-21). They are FEDERAL: every one asks SAM.gov for notices carrying a
 * federal NAICS/PSC code.
 *
 * These 11 literal labels are the SINGLE SOURCE OF TRUTH for the trade passes;
 * `cert-matching.ts` re-exports them as `FEDERAL_TRADE_SOURCE_LABELS` for its
 * existing consumers (`sam-gov-trades.ts` validates `SAM_TRADE_FILTERS[].name`
 * against that list AT MODULE LOAD). They are NOT imported from
 * `sam-gov-trades.ts` here on purpose: that module imports `cert-matching.ts`,
 * which imports this module, so importing it back would create a module cycle
 * whose TDZ failure would fire at load time rather than in a test.
 */
export const FEDERAL_TRADE_LABELS: readonly string[] = [
  "sam_naics_561720",
  "sam_psc_s201",
  "sam_naics_484110",
  "sam_naics_484121",
  "sam_naics_484122",
  "sam_naics_484210",
  "sam_naics_484220",
  "sam_naics_484230",
  "sam_naics_492110",
  "sam_psc_v112",
  "sam_psc_r602",
];

/**
 * The 51 state-name keyword "doors" — one per US_STATES entry (50 + DC),
 * generated from the same constant the runner builds the registry from, so the
 * two cannot drift. Each is FEDERAL (R2) with the door's state recorded as
 * search-origin scope, NOT as a jurisdiction.
 */
function stateNameKeywordDoors(): Record<string, SourceClassRecord> {
  const doors: Record<string, SourceClassRecord> = {};
  for (const code of US_STATES) {
    doors[code.toLowerCase()] = {
      class: "federal",
      searchScope: "state-name-keyword",
      scopeState: code,
    };
  }
  return doors;
}

/**
 * Every `bids.source` label the product knows, with its approved class.
 * 79 entries: 73 registry labels + `sam_gov_regional` + 5 legacy/internal.
 */
export const SOURCE_CLASSES: Record<string, SourceClassRecord> = {
  // ── The federal SAM.gov feeds (R1/R2/R3) ────────────────────────────────
  // The national pass. Its fetchFn ALSO emits the additive regional pass's
  // rows under the label `sam_gov_regional` (sam-gov.ts), which is therefore a
  // real corpus label even though it has no registry entry of its own.
  sam_gov: { class: "federal", searchScope: "national", recordType: "opportunity" },
  sam_gov_regional: { class: "federal", searchScope: "regional", recordType: "opportunity" },
  // The SAM.gov municipal keyword pass. It is FEDERAL despite its name: it
  // queries SAM.gov for "City of"/"County of"/"Metropolitan" and never contacts
  // a municipality (R3, C1).
  cities: { class: "federal", searchScope: "city-keyword", recordType: "opportunity" },
  // A federal SAM.gov pass gated on a real Virginia place-of-performance filter.
  // FEDERAL, with the VA scope recorded so it is never read as a VA state/local
  // source (owner ruling a).
  va_evirginia: {
    class: "federal",
    searchScope: "state-pop",
    scopeState: "VA",
    recordType: "opportunity",
  },
  ...Object.fromEntries(
    FEDERAL_TRADE_LABELS.map((name) => [
      name,
      {
        class: "federal",
        searchScope: "structured-trade-filter",
        recordType: "opportunity",
      } satisfies SourceClassRecord,
    ]),
  ),
  ...stateNameKeywordDoors(),

  // ── State systems (R5) ──────────────────────────────────────────────────
  // Pennsylvania's statewide portal (owner ruling b). A statewide platform is
  // not one city's board, so its municipal/school-district buyers do not make it
  // LOCAL.
  pennbid: { class: "state", scopeState: "PA", searchScope: "state-portal", recordType: "opportunity" },
  // RETIRED (owner ruling c): the collector was removed from the registry
  // (both data.ny.gov datasets answer 404 and the "fallback" id was actually
  // LA's dataset), so it can produce no row. The class is retained for the
  // legacy label so a historical row is still described honestly; health and
  // coverage surfaces must filter RETIRED_SOURCES instead of showing it as
  // merely empty.
  nys_socrata: {
    class: "state",
    scopeState: "NY",
    searchScope: "state-portal",
    retired: true,
  },

  // ── City systems (R4). recordType per the lead ruling: all five recorded,
  //    nyc/la are OPEN OPPORTUNITIES, chicago/sf/austin are AWARDS (ruling d).
  nyc_open_data: {
    class: "local",
    city: "New York City",
    scopeState: "NY",
    searchScope: "city-open-data",
    recordType: "opportunity",
  },
  chicago_open_data: {
    class: "local",
    city: "Chicago",
    scopeState: "IL",
    searchScope: "city-open-data",
    recordType: "award",
  },
  la_open_data: {
    class: "local",
    city: "Los Angeles",
    scopeState: "CA",
    searchScope: "city-open-data",
    recordType: "opportunity",
  },
  sf_open_data: {
    class: "local",
    city: "San Francisco",
    scopeState: "CA",
    searchScope: "city-open-data",
    recordType: "award",
  },
  austin_open_data: {
    class: "local",
    city: "Austin",
    scopeState: "TX",
    searchScope: "city-open-data",
    recordType: "award",
  },
  // The City of Dayton's own CivicEngage bid board (Ohio Phase 3) — a real
  // municipal board with real due dates.
  oh_dayton: {
    class: "local",
    city: "Dayton",
    scopeState: "OH",
    searchScope: "city-open-data",
    recordType: "opportunity",
  },

  // ── INTERNAL (R6) — no live procurement source, no jurisdiction claim ───
  // Retired federal-sync label with 226 legacy rows: never a state/local portal.
  md_dc: { class: "internal" },
  // Demo/seed/fixture feeds (the cert-matching deny-list labels) + the dead
  // NYC Socrata export that `socrata.ts` used to register.
  "contrax-demo": { class: "internal" },
  seed: { class: "internal" },
  fixture_test: { class: "internal" },
  nyc_socrata: { class: "internal", retired: true },
};

/**
 * The three award-type city feeds (owner ruling d / C6). They stay in the
 * corpus as award-and-incumbent intelligence but are EXCLUDED from every
 * opportunity surface: bid alerts, in-app notifications, digest e-mail, /map
 * and the dashboard listing feeds. Their rows are honest award records whose
 * `due_date` is NULL (chicago/sf/austin map to `due_date: null`), which is why
 * the deadline-gated surfaces (Radar, /awards, the open-bids search) never
 * showed them while the "open = due_date IS NULL OR >= today" surfaces did.
 */
export const AWARD_TYPE_SOURCES: ReadonlySet<string> = new Set([
  "chicago_open_data",
  "sf_open_data",
  "austin_open_data",
]);

/** Labels whose collector has been retired (health/coverage surfaces filter these). */
export const RETIRED_SOURCES: ReadonlySet<string> = new Set(
  Object.entries(SOURCE_CLASSES)
    .filter(([, rec]) => rec.retired === true)
    .map(([label]) => label),
);

/** Every label whose class is INTERNAL (R6) — never state/local, never coverage. */
export const INTERNAL_SOURCE_LABELS: ReadonlySet<string> = new Set(
  Object.entries(SOURCE_CLASSES)
    .filter(([, rec]) => rec.class === "internal")
    .map(([label]) => label),
);

/**
 * The 66 FEDERAL labels of the approved policy: the national + regional pass,
 * the `cities` keyword pass, the VA-scoped federal pass, the 11 trade passes and
 * the 51 state-name doors. `cert-matching.ts` builds its `FEDERAL_SOURCE_LABELS`
 * from these plus FEDERAL_TRADE_LABELS.
 */
export const FEDERAL_LABELS: ReadonlySet<string> = new Set(
  Object.entries(SOURCE_CLASSES)
    .filter(([, rec]) => rec.class === "federal")
    .map(([label]) => label),
);

/** Every LOCAL label (city own-board/open-data feeds). */
export const LOCAL_LABELS: ReadonlySet<string> = new Set(
  Object.entries(SOURCE_CLASSES)
    .filter(([, rec]) => rec.class === "local")
    .map(([label]) => label),
);

/** Every STATE label. */
export const STATE_LABELS: ReadonlySet<string> = new Set(
  Object.entries(SOURCE_CLASSES)
    .filter(([, rec]) => rec.class === "state")
    .map(([label]) => label),
);

/** Normalized-source form used by every predicate below (btrim + lowercase). */
function normalizeSource(source: string | null | undefined): string {
  return String(source ?? "").toLowerCase().trim();
}

/**
 * THE RESOLVER. An UNCLASSIFIED label resolves to INTERNAL (C7): ambiguous or
 * unknown provenance is never treated as state/local by default, so it can
 * never enter the Small-Business pool or inflate coverage until it is validated
 * and added to SOURCE_CLASSES (C8).
 */
export function resolveSourceClass(source: string | null | undefined): SourceClass {
  return sourceClassRecord(source).class;
}

/** The full metadata record for a label; unclassified labels get INTERNAL. */
export function sourceClassRecord(
  source: string | null | undefined,
): SourceClassRecord {
  return (
    SOURCE_CLASSES[normalizeSource(source)] ?? { class: "internal" as const }
  );
}

/** Is this label a federal feed of the approved policy? */
export function isFederalLabel(source: string | null | undefined): boolean {
  return resolveSourceClass(source) === "federal";
}

/**
 * Is this label one of a STATE's own systems or one city's own board? These are
 * the sources whose a NULL set-aside is a genuinely pursuable state/local
 * posting (certification rule 3) — a federal NULL set-aside is NOT (owner
 * ruling f).
 */
export function isStateLocalLabel(source: string | null | undefined): boolean {
  const cls = resolveSourceClass(source);
  return cls === "state" || cls === "local";
}

/** True when a label is one of the award-type city feeds (ruling d / C6). */
export function isAwardTypeSource(source: string | null | undefined): boolean {
  return AWARD_TYPE_SOURCES.has(normalizeSource(source));
}

/** True when a label's collector has been retired. */
export function isRetiredSource(source: string | null | undefined): boolean {
  return RETIRED_SOURCES.has(normalizeSource(source));
}

/**
 * The INTERNAL marker returned by `sourceBadgeLabel`. INTERNAL sources render
 * NO badge at all (lead ruling 1): they are legacy/test-only labels, and an
 * absent badge cannot be misread as a jurisdiction or a set-aside claim. The
 * render site tests the return value for truthiness, so the marker is the empty
 * string rather than an invented user-visible word.
 */
export const NO_SOURCE_BADGE = "";

/** Badge tone, so a render site can colour a class without re-deriving it. */
export type SourceBadgeTone = "federal" | "state" | "local" | "internal";

export function sourceBadgeTone(source: string | null | undefined): SourceBadgeTone {
  return resolveSourceClass(source);
}

/**
 * The provenance badge text for a stored `bids.source`.
 *
 *   FEDERAL  → "Federal"                  (the 66-label federal set, R1–R3)
 *   STATE    → "State (PA)"                (pennbid, ruling b)
 *   LOCAL    → the city's name             (Dayton, Chicago, …)
 *   INTERNAL → NO_SOURCE_BADGE ("")        (render nothing, ruling 1)
 *
 * The previous version of this function existed only to answer
 * `source === "sam_gov" ? "Federal" : "City"`, so every other federal label
 * rendered as "City" (QA N2) and PennBid (a STATE portal) rendered as "City"
 * too. Class-driven now: the badge follows the source's provenance, not its
 * name.
 */
export function sourceBadgeLabel(source: string | null | undefined): string {
  const rec = sourceClassRecord(source);
  if (rec.class === "internal") return NO_SOURCE_BADGE;
  if (rec.class === "federal") return "Federal";
  if (rec.class === "state") {
    return rec.scopeState ? "State (" + rec.scopeState + ")" : "State";
  }
  return rec.city ?? "Local";
}

/**
 * SQL predicate (as a raw string, interpolate with `sql().unsafe(...)`) that
 * evaluates TRUE for a row that may appear on an OPPORTUNITY surface — i.e. NOT
 * one of the award-type city feeds. Mirrors `isAwardTypeSource` exactly; the
 * values are hardcoded constants, never user input, so interpolating them is
 * injection-safe.
 */
export const AWARD_EXCLUSION_SQL = `LOWER(COALESCE(source, '')) NOT IN (${[
  ...AWARD_TYPE_SOURCES,
]
  .map((s) => `'${s}'`)
  .join(", ")})`;
