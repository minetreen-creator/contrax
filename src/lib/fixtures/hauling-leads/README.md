# hauling-leads fixtures

## `lexicon-slice.json`

**What it is.** A verbatim slice (119 rows) of the USAspending.gov award search the
trucking #4 proposal measured on, used by `src/lib/hauling-leads.test.ts` to pin the
whole owner-endorsed definition "R" with NO network access.

* **Source capture:** `spending_by_award` with `award_type_codes A–D`,
  `time_period action_date 2025-10-16 → 2026-10-16`, and the 10-term hauling keyword
  arm. The full 1,775-row capture is committed in the team workspace as
  `shared/trucking-4-hauling-leads-proposal-2026-10-16/lexicon-raw.json`
  (pulled 2026-10-16 03:09 UTC); this file is a slice of exactly that capture.
* **Captured:** 2026-10-16. **sha256 of the `rows` array (JSON, no whitespace):**
  `9effb603c46e70129eac0b879fe1553469856dad846e3a34523273bdcab61e13`
* **What is in the slice:** all **99** rows that pass definition R (the whole stored
  set the 12-month pull yields — the same number the proposal reports), plus 20
  measured NEGATIVE controls — 3 below the $25,000 floor, 3 whose base obligation date
  falls outside the window, 4 in a freight/courier/postal NAICS, 4 in a
  vehicle/equipment NAICS (the "DUMP TRUCK" purchase rows R exists to remove), 3 whose
  description carries no hauling wording, and 3 whose WINNER NAME reads as a
  hauling/waste firm. Each control is a real captured row, kept so a fixture pins every
  rung of the ladder rather than only the final count.
* **Reproduction:** over the FULL 1,775-row capture, the same pipeline in
  `src/lib/hauling-leads.ts` keeps 99 of 1,775 (drops: 650 under $25k, 379 outside the
  window, 320 carrier NAICS, 159 non-service NAICS, 160 no scope wording, 8 winner name)
  — identical to the proposal's R. This slice pins the same 99 plus the controls.

Nothing here is edited: the JSON is the source's own rows, keys unchanged.
