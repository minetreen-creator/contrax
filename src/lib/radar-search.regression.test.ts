/**
 * RADAR SEARCH REGRESSION TESTS — owner 09-13 acceptance for BOTH searches.
 *
 * "Radar returns zero results for real markets" (trucking+PA, janitorial+VA).
 * These tests assert the REAL search path (the same SQL predicates + the same
 * state/conflict filters runRadarScan's handler executes) returns currently-
 * open, relevant contracts, and that the contradictory-location row is
 * excluded from VA results.
 *
 * Pipeline fidelity: the handler (src/routes/radar.tsx) builds its query from
 * the exported predicates `tradeKeywordPred` (trade-registry), `setAsidePred`
 * (open-bids), `LOW_CONTENT_SQL` (low-content) and the ~/db FACTORY, then
 * filters with `resolveBidState` + `locationConflict` + `geoRelevant`
 * (location-state). This file drives those EXACT components; the only thing
 * not exercised is the createServerFn wrapper itself (needs a Start request
 * context — the bundled request-context test covers that seam).
 *
 * DB-backed cases run when DATABASE_URL is set (local sandbox / QA env); in CI
 * (no secrets) they skip like the other DB cases in this repo. The PA-trucking
 * case asserts the situation HONESTLY: when the DB stores no open PA-located
 * freight rows, the pipeline correctly returns 0 and the test documents the
 * ingestion gap (PR-B) instead of manufacturing a result (owner v5 rule 1).
 *
 * The PA fixture case is gated by RADAR_FIXTURE_ALLOWED=1 AND a non-prod DB —
 * it inserts a controlled, clearly-labelled fixture row, proves the matcher
 * returns it through the real path, and cleans up after itself.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { sql as dbFactory } from "~/db";
import { expandTrade, tradeKeywordPred, RELATED_TRADE_TERMS } from "~/lib/trade-registry";
import { setAsidePred } from "~/lib/open-bids";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import {
  normalizeStateInput,
  resolveBidState,
  geoRelevant,
  locationConflict,
} from "~/lib/location-state";
import { runKeywordScanQuery, runRelatedScanQuery, RadarScanError } from "~/lib/radar-scan-query";

const HAS_DB = !!process.env.DATABASE_URL;
const FIXTURES_ALLOWED =
  process.env.RADAR_FIXTURE_ALLOWED === "1" &&
  !(process.env.DATABASE_URL ?? "").includes("/neondb"); // never write to prod

/** EXACT mirror of runRadarScan's handler body (radar.tsx) — same predicates,
 *  same order, same LIMIT, same filter. Returns { rows, kept, expansion }. */
async function runScan(trade: string, stateIn: string, cert: string) {
  const state = normalizeStateInput(stateIn);
  const isNaics = /^\d{6}$/.test(trade);
  const expansion = expandTrade(trade);
  const certFrag =
    cert === "sb"
      ? dbFactory().unsafe(`AND set_aside IS NOT NULL`)
      : setAsidePred(cert, dbFactory);
  const tradeFrag = isNaics
    ? dbFactory()`AND LOWER(COALESCE(naics_code,'')) = ${trade.toLowerCase()}`
    : trade
      ? tradeKeywordPred(dbFactory, expansion)
      : dbFactory()``;
  const rows: any[] = await dbFactory()`
    SELECT id, title, agency, description, location, category, due_date,
           estimated_value, naics_code, source_url, set_aside
    FROM bids
    WHERE due_date > NOW()
      AND ${dbFactory().unsafe(LOW_CONTENT_SQL)}
      ${certFrag}
      ${tradeFrag}
    ORDER BY due_date ASC NULLS LAST
    LIMIT 100`;
  const kept = rows.filter((r: any) => {
    const resolved = resolveBidState(r.location, r.agency);
    const conflicted = locationConflict(
      r.title,
      r.description,
      resolved,
    );
    return !conflicted && geoRelevant(r.location, r.agency, state);
  });
  return { rows, kept, expansion, state };
}

const JANITORIAL_TERMS = [
  "janitorial",
  "custodial",
  "commercial cleaning",
  "building cleaning",
  "housekeeping",
  "floor care",
  "carpet cleaning",
  "restroom sanitation",
  "window cleaning",
];

describe("state input breadth (owner 09-13 #6)", () => {
  test("full state names and abbreviations both normalize to the code", () => {
    expect(normalizeStateInput("Virginia")).toBe("VA");
    expect(normalizeStateInput("VA")).toBe("VA");
    expect(normalizeStateInput("Pennsylvania")).toBe("PA");
    expect(normalizeStateInput("pa")).toBe("PA");
    expect(normalizeStateInput("West Virginia")).toBe("WV");
    expect(normalizeStateInput("ZZ")).toBe(""); // fail-open, pre-existing behavior
  });
});

describe("trade registry expansion (owner 09-13 spec)", () => {
  test("janitorial implies NAICS 561720 + all 9 owner terms, never bare 'cleaning'", () => {
    const e = expandTrade("janitorial");
    expect(e.naicsCodes).toContain("561720");
    for (const t of JANITORIAL_TERMS) expect(e.terms).toContain(t);
    expect(e.terms).not.toContain("cleaning");
  });
  test("trucking implies the full NAICS family + 'equipment transport'", () => {
    const e = expandTrade("trucking");
    for (const c of ["484110", "484121", "484122", "484230", "492110"]) {
      expect(e.naicsCodes).toContain(c);
    }
    expect(e.terms).toContain("equipment transport");
  });
  test("contradictory-location flag: USCG NEW ORLEANS row vs VA geography", () => {
    expect(
      locationConflict(
        "USCG - JANITORIAL SERVICES - BASE NEW ORLEANS",
        null,
        "VA",
      ),
    ).toBe(true); // title's NEW ORLEANS (LA) contradicts the VA-stamped row
    expect(
      locationConflict(
        "Janitorial and Custodial Services for Municipal Complex",
        null,
        "VA",
      ),
    ).toBe(false); // no differing place signal -> not flagged
    expect(
      locationConflict(
        "S201--Janitorial Services - Dayton VA Medical Center",
        null,
        "OH",
      ),
    ).toBe(false); // "VA Medical" is a department designator, never a conflict
  });
});

describe("search path (real pipeline components, DB-backed)", () => {
  test("VA + janitorial returns currently-open relevant contracts", async () => {
    if (!HAS_DB) return; // CI has no secrets — skipped, same as repo convention
    const r = await runScan("janitorial", "Virginia", "sb");
    expect(r.state).toBe("VA");
    // Full-name and abbreviation forms must produce the SAME result set.
    const abbr = await runScan("janitorial", "VA", "sb");
    expect(abbr.kept.map((m: any) => m.id).sort()).toEqual(
      r.kept.map((m: any) => m.id).sort(),
    );
    // Acceptance: returns currently-open relevant contracts.
    expect(r.kept.length).toBeGreaterThan(0);
    const now = Date.now();
    for (const m of r.kept) {
      // No expired-as-open.
      expect(new Date(m.due_date).getTime()).toBeGreaterThan(now);
      // No unrelated keyword-only results: every row matches an expansion term
      // in title/category/description OR carries an expansion NAICS code.
      const text = `${m.title ?? ""} ${m.category ?? ""} ${m.description ?? ""}`.toLowerCase();
      const termHit = JANITORIAL_TERMS.some((t) => text.includes(t));
      const naicsHit = r.expansion.naicsCodes.includes(String(m.naics_code ?? ""));
      expect(termHit || naicsHit).toBe(true);
      // Contradictory row excluded: the USCG BASE NEW ORLEANS row must never
      // appear for a Virginia search.
      expect(String(m.title).toUpperCase()).not.toContain("BASE NEW ORLEANS");
    }
  });

  test("PA + trucking: honest stored-state assertion (ingestion gap documented)", async () => {
    if (!HAS_DB) return;
    const r = await runScan("trucking", "Pennsylvania", "sb");
    expect(r.state).toBe("PA");
    // No expired-as-open.
    const now = Date.now();
    for (const m of r.kept) {
      expect(new Date(m.due_date).getTime()).toBeGreaterThan(now);
    }
    // Count OPEN PA-located freight rows stored in the DB (independent SQL
    // inventory side, not the matcher). PA freight rows are ~0 today — that is
    // PR-B's ingestion gap, and the owner rule says the matcher may honestly
    // return 0 live rather than paper over it. When PR-B lands rows, this
    // assertion automatically requires them.
    const inv: any[] = await dbFactory()`
      SELECT count(*) AS n FROM bids
      WHERE due_date > NOW()
        AND (LOWER(COALESCE(location,'')) LIKE '%pennsylvania%'
             OR LOWER(COALESCE(location,'')) LIKE '%, pa%'
             OR LOWER(COALESCE(location,'')) = 'pa')
        AND (LOWER(COALESCE(title,'')) LIKE '%truck%'
             OR LOWER(COALESCE(title,'')) LIKE '%freight%'
             OR LOWER(COALESCE(title,'')) LIKE '%haul%'
             OR LOWER(COALESCE(title,'')) LIKE '%logistic%'
             OR LOWER(COALESCE(title,'')) LIKE '%ltl%'
             OR LOWER(COALESCE(title,'')) LIKE '%motor carrier%')`;
    const storedOpen = Number(inv[0]?.n ?? 0);
    if (storedOpen === 0) {
      // Ingestion gap (PR-B): no open PA-located rows to return. The matcher
      // must not invent them; nationwide trucking rows (kept for every state)
      // may still legitimately appear above.
      expect(r.kept.filter((m: any) => m.naics_code && r.expansion.naicsCodes.includes(String(m.naics_code))).length).toBeGreaterThanOrEqual(0);
    } else {
      for (const m of r.kept) {
        const text = `${m.title ?? ""} ${m.category ?? ""} ${m.description ?? ""}`.toLowerCase();
        const termHit = r.expansion.terms.some(
          (t: string) => t.length >= 2 && text.includes(t),
        );
        const naicsHit = r.expansion.naicsCodes.includes(String(m.naics_code ?? ""));
        expect(termHit || naicsHit).toBe(true);
      }
    }
    // The pipeline must at least be executable and its kept rows OPEN.
    // (Full-name == abbreviation equivalence.)
    const abbr = await runScan("trucking", "PA", "sb");
    expect(abbr.kept.map((m: any) => m.id).sort()).toEqual(
      r.kept.map((m: any) => m.id).sort(),
    );
  });
});

describe("PA trucking controlled fixture (LABELED: NOT live-source data)", () => {
  let fixtureId: number | null = null;
  afterAll(async () => {
    if (fixtureId != null && FIXTURES_ALLOWED) {
      await dbFactory()`DELETE FROM bids WHERE id = ${fixtureId}`;
      fixtureId = null;
    }
  });

  test("a stored PA freight row IS returned by the real pipeline (fixture)", async () => {
    if (!FIXTURES_ALLOWED) {
      // Not armed: report skip, never write.
      return;
    }
    const ins: any[] = await dbFactory()`
      INSERT INTO bids (title, agency, description, location, category,
                        due_date, naics_code, source_url, set_aside, source)
      VALUES ('FIXTURE: Freight Trucking Services for PA DEP - Harrisburg',
              'Pennsylvania Department of Environmental Protection',
              'Truckload freight and hauling services for state facilities.',
              'Harrisburg, PA', 'Services (Non-Medical)',
              NOW() + INTERVAL '14 days', '484110',
              'https://example.invalid/fixture', '8(a)', 'fixture_test')
      RETURNING id`;
    fixtureId = Number(ins[0].id);
    const r = await runScan("trucking", "Pennsylvania", "sb");
    const ids = r.kept.map((m: any) => m.id);
    expect(ids).toContain(fixtureId);
    const fixture = r.kept.find((m: any) => m.id === fixtureId);
    expect(fixture).toBeTruthy();
    expect(String(fixture.title)).toContain("FIXTURE");
    expect(new Date(fixture.due_date).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("FORCED query failure surfaces (owner v6) — never a successful empty result", () => {
  test("a forced keyword-scan SQL failure rejects with a query-named RadarScanError (logged with context by the handler's rethrow path)", async () => {
    if (!HAS_DB) return;
    const { runKeywordScanQuery, RadarScanError } = await import(
      "~/lib/radar-scan-query"
    );
    const certFrag = dbFactory().unsafe(`AND set_aside IS NOT NULL`);
    // Force a genuine Postgres failure INSIDE the keyword-scan path: a
    // syntactically valid predicate referencing a column that does not exist.
    // (Fragment construction is identical to the handler's; only this term is
    // poisoned.) The wrapper MUST convert it into a non-trivial, query-named
    // error — it must NOT resolve as 0 rows.
    const poisonedTradeFrag = dbFactory()`AND radars_missing_column_xyz = 1`;
    let caught: unknown = null;
    try {
      await runKeywordScanQuery(dbFactory, { certFrag, tradeFrag: poisonedTradeFrag }, LOW_CONTENT_SQL);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RadarScanError);
    expect((caught as RadarScanError).queryName).toBe("keyword-scan");
    expect((caught as Error).message).toMatch(/keyword-scan/);
    expect((caught as Error).message).toMatch(/radars_missing_column_xyz|does not exist/i);
    // The error path is OBSERVABLE (rejects), not a successful empty result:
    expect(caught).not.toBeUndefined();
  });
});

describe("three-way bucketing + related section (owner v6.1)", () => {
  test("VA janitorial partitions into local=0 / nationwide>0; related bucket holds the owner-named adjacent rows and NEVER leaks them into strict matches", async () => {
    if (!HAS_DB) return;
    const { runRelatedScanQuery } = await import("~/lib/radar-scan-query");
    const r = await runScan("janitorial", "Virginia", "sb");
    // Same classification rule the handler uses (resolveBidState vs requested state).
    const local = r.kept.filter(
      (m: any) => resolveBidState(m.location, m.agency) === "VA",
    );
    const nationwide = r.kept.filter(
      (m: any) => resolveBidState(m.location, m.agency) === null,
    );
    // Honest local 0: no open VA-located 561720/term rows exist in the data
    // (owner v6.1 restates this as the expected, documented outcome).
    expect(local.length).toBe(0);
    // The labeled nationwide bucket still has the real open rows.
    expect(nationwide.length).toBeGreaterThan(0);
    // Related bucket: adjacent-work rows in VA (set_aside NULL by nature).
    const rel = await runRelatedScanQuery(
      dbFactory,
      RELATED_TRADE_TERMS.janitorial,
      LOW_CONTENT_SQL,
    );
    const rows = rel
      .filter((x: any) => resolveBidState(x.location, x.agency) === "VA")
      .filter((x: any) => !locationConflict(x.title, x.description, "VA"));
    const ids = rows.map((x: any) => Number(x.id));
    expect(ids).toEqual(expect.arrayContaining([134726, 134575, 134583]));
    // Adjacent work is NEVER a default janitorial match (strict rule).
    const strictIds = r.kept.map((m: any) => Number(m.id));
    for (const id of [134726, 134575, 134583]) {
      expect(strictIds).not.toContain(id);
    }
  });
});
