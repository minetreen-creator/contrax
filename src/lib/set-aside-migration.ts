/**
 * Migration 065's LIST-SHAPE rule, as PURE, DB-free logic.
 *
 * WHY THIS MODULE EXISTS (owner rule 2026-10-19: "a check that fails on every run
 * trains people to ignore it. It must pass when the migration is correct and fail
 * only when something is actually wrong"). db/migrations/run-065.ts is hand-run
 * against production, so its own verify() is the only thing standing between a
 * careless future edit and a widened blast radius. Its first version asserted the
 * two external_id lists were DISJOINT — the opposite of the design: statement 1
 * deliberately keeps the 15 NONE ids inside its exception list (otherwise it would
 * stamp the total-small-business label on a notice SAM says has no set-aside, and
 * statement 2's `set_aside = '8(a)'` guard could no longer reach it), and statement
 * 2 then nulls exactly those 15. So "an id is in BOTH lists" fired on EVERY correct
 * run.
 *
 * THE RULE, stated so that it holds only when the migration is right:
 *   * every NONE id is inside statement 1's exception list (the overlap is exactly
 *     the NONE list — that IS the design, and it is what makes statement 2 able to
 *     see the rows it has to null);
 *   * the rows statement 1 therefore keeps reading "8(a)" forever are exactly the
 *     measured 85 (63 real 8A + 10 real 8AN + 9 with no published value + 3 rows
 *     carrying another designation of the 065 era).
 *
 * SHARED BY: db/migrations/run-065.ts (the hand-run runner) and
 * src/jobs/sam-set-aside-migration.test.ts, which pins the three cases — the real
 * lists pass, an exception id that statement 1 would keep forever but must not
 * fails, and a NONE id missing from the exception list fails.
 */

/**
 * The measured 2026-10-19 split of the 100 exception rows in migration 065's
 * statement 1, re-read per id from SAM's own notice-detail API. It is the source
 * of the two counts below, so the numbers cannot drift from each other: the
 * arithmetic is asserted in the test suite.
 */
export const SET_ASIDE_EVIDENCE_GROUPS = {
  /** "8A" — a REAL 8(a) set-aside. */
  eightA: 63,
  /** "8AN" — the REAL 8(a) sole source. */
  eightAN: 10,
  /** "NONE" — SAM says no set-aside at all; statement 2 nulls these. */
  none: 15,
  /** the API publishes no set-aside value for the notice (5 empty + 4 null). */
  noValue: 9,
  /** WOSB / WOSBSS / SBP — women-owned / partial designations, relabelled by 066. */
  otherDesignation: 3,
} as const;

/** 4,126 rows SAM recorded as the SBA code + 1 in its `["SBA"]` array form = 4,127 SBA rows. */
export const SET_ASIDE_SBA_ROWS = 4_127;
/** The 7 rows whose notices had aged out of SAM (404) and are relabelled on the measured prior. */
export const SET_ASIDE_AGED_OUT_ROWS = 7;
/** Statement 1 relabels every stored "8(a)" row except the exception list. */
export const SET_ASIDE_RELABEL_ROWS =
  SET_ASIDE_SBA_ROWS + SET_ASIDE_AGED_OUT_ROWS; // 4,134 — 065's measured blast radius
/** Statement 1's `NOT IN` list: every stored "8(a)" row whose SAM record is NOT the SBA code. */
export const SET_ASIDE_EXCEPTION_COUNT =
  SET_ASIDE_EVIDENCE_GROUPS.eightA +
  SET_ASIDE_EVIDENCE_GROUPS.eightAN +
  SET_ASIDE_EVIDENCE_GROUPS.none +
  SET_ASIDE_EVIDENCE_GROUPS.noValue +
  SET_ASIDE_EVIDENCE_GROUPS.otherDesignation; // 100
/** Statement 2's `IN` list: the rows SAM reports as NONE. */
export const SET_ASIDE_NONE_COUNT = SET_ASIDE_EVIDENCE_GROUPS.none; // 15
/** The rows that must STILL read "8(a)" after 065 — the real 8(a)/8AN opportunities. */
export const SET_ASIDE_KEPT_EIGHT_A_COUNT =
  SET_ASIDE_EXCEPTION_COUNT - SET_ASIDE_NONE_COUNT; // 85

export interface SetAsideListShape {
  /** Statement 1's `external_id NOT IN (…)` list — the rows statement 1 must NOT relabel. */
  exceptionIds: readonly string[];
  /** Statement 2's `external_id IN (…)` list — the NONE rows, which must end NULL. */
  noneIds: readonly string[];
}

/** The ids in BOTH lists — the design's deliberate overlap, reported for the operator. */
export function setAsideListOverlap(shape: SetAsideListShape): string[] {
  const exception = new Set(shape.exceptionIds);
  return shape.noneIds.filter((id) => exception.has(id));
}

/**
 * The shape rule. Returns an EMPTY array when the two lists are the migration's
 * design (that is the normal, correct outcome of every re-run); it returns one
 * message per real defect otherwise.
 */
export function checkSetAsideListShape(shape: SetAsideListShape): string[] {
  const problems: string[] = [];
  const { exceptionIds, noneIds } = shape;
  if (exceptionIds.length !== SET_ASIDE_EXCEPTION_COUNT) {
    problems.push(
      `statement 1 names ${exceptionIds.length} exception ids, expected ${SET_ASIDE_EXCEPTION_COUNT}`,
    );
  }
  if (noneIds.length !== SET_ASIDE_NONE_COUNT) {
    problems.push(`statement 2 names ${noneIds.length} ids, expected ${SET_ASIDE_NONE_COUNT}`);
  }
  if (new Set(exceptionIds).size !== exceptionIds.length) {
    problems.push("statement 1's exception list repeats an id");
  }
  if (new Set(noneIds).size !== noneIds.length) problems.push("statement 2's list repeats an id");
  for (const [label, ids] of [
    ["statement 1", exceptionIds],
    ["statement 2", noneIds],
  ] as const) {
    for (const id of ids) {
      if (!/^sam-[0-9a-f]{32}$/.test(id)) problems.push(`${label} names a non-SAM external_id: ${id}`);
    }
  }
  // THE DESIGNED OVERLAP. Statement 1 keeps the NONE rows in its exception list so
  // that it does not relabel them; statement 2 then nulls them. A NONE id missing
  // from the exception list is the real defect: statement 1 would stamp the
  // total-small-business label on it and statement 2's `set_aside = '8(a)'` guard
  // would no longer match, leaving a notice SAM reports as having no set-aside
  // labelled as a total-small-business set-aside.
  const overlap = setAsideListOverlap(shape);
  if (overlap.length !== noneIds.length) {
    problems.push(
      `only ${overlap.length}/${noneIds.length} NONE ids are protected by statement 1's exception list — ` +
        "statement 1 would relabel the rest to the total-small-business label and statement 2 could no longer reach them",
    );
  }
  // The rows statement 1 keeps reading "8(a)" FOREVER (it never relabels them, and
  // statement 2 does not touch them). A row kept forever that should not be — e.g.
  // an extra id appended to the exception list — is only visible here, as a count.
  const keptForever = exceptionIds.length - overlap.length;
  if (keptForever !== SET_ASIDE_KEPT_EIGHT_A_COUNT) {
    problems.push(
      `statement 1's exception list keeps ${keptForever} row(s) reading '8(a)' forever, expected ` +
        `${SET_ASIDE_KEPT_EIGHT_A_COUNT} (${SET_ASIDE_EVIDENCE_GROUPS.eightA} real 8A + ` +
        `${SET_ASIDE_EVIDENCE_GROUPS.eightAN} real 8AN + ${SET_ASIDE_EVIDENCE_GROUPS.noValue} with no published ` +
        `value + ${SET_ASIDE_EVIDENCE_GROUPS.otherDesignation} carrying another designation)`,
    );
  }
  return problems;
}
