-- Migration 066 — the three 8(a)-relabel FOLLOW-UPS from migration 065 (owner-approved 2026-10-19).
--
-- DATA-ONLY, ADDITIVE, HAND-RUN: three UPDATEs on `bids`, no DDL, no insert, no
-- delete. Executed by db/migrations/run-066.ts (never by a test, a CI job or a
-- scheduled task) with before/after proof. It CONTINUES migration 065
-- (065_bids_set_aside_relabel.sql), which relabelled the 4,134 SBA-coded rows and
-- left 85 rows reading "8(a)". This file takes them 85 -> 82 and closes one
-- duplicate. NUMBERING: the highest pair on main is
-- 065_bids_set_aside_relabel.sql + run-065.ts, so this migration takes the next
-- FREE pair: 066_*.sql + run-066.ts. Nothing is overwritten.
--
-- ① THE 3 "OTHER DESIGNATION" ROWS (statement 1 and statement 2).
--
--   065's 100-row exception list contains 3 rows whose SAM record is neither "8A"
--   nor "8AN" and not "NONE" either: they are WOMEN-OWNED / partial small-business
--   set-asides, i.e. they were never 8(a) at all. They still read "8(a)", so they
--   still tell an 8(a) certificant they are eligible for a set-aside that belongs
--   to a different program. Re-read per id on 2026-10-19 from SAM's own
--   notice-detail API (GET sam.gov/api/prod/opps/v2/opportunities/<NoticeId>,
--   Accept: application/hal+json), the 100 ids reproduce 065's split EXACTLY:
--       8A  63  |  8AN  10  |  NONE  15  |  (no value published)  9  |  other  3
--   63 + 10 + 15 + 9 + 3 = 100 (and 73 + 15 + 9 + 3 = 100).
--
--   THE TARGET STRING IS NOT A CHOICE — IT IS THE SYNC'S OWN OUTPUT. The 4-hourly
--   SAM sync stores bids.set_aside through `normalizeSetAside`
--   (src/jobs/sources/sam-gov.ts), so the correct target for a row is, by
--   definition, the string that function returns for the SAM code on that notice.
--   Measured 2026-10-19 by CALLING the shipped function:
--
--     SAM code  notice (external_id)                     normalizeSetAside ->  stored today
--     WOSB      sam-f0c78ea349e342329b172564ad69ab4e     "WOSB"                "8(a)"
--     WOSBSS    sam-daab0dffa3044ad19e6d7ca610be2bc0     "WOSB"                "8(a)"
--     SBP       sam-ecd2e2a033c147f0ba7f7de6fb14f528     "SBP"                 "8(a)"
--
--   * WOSBSS collapses onto WOSB (the pre-existing sole-source phrase rule that
--     065's header flagged and deliberately did NOT change), so statements 1's two
--     rows both take "WOSB". Production already stores "WOSB" on 234 rows.
--   * SBP has NO entry in the map (only SBA / 8A / 8AN / WOSB / EDWOSB / HUBZone /
--     SDVOSB / VOSB / MBE / WBE / DBE do), so the function falls through and returns
--     the CODE — statement 2 therefore writes "SBP", NOT "WOSB". Labelling that row
--     "WOSB" would DISAGREE with the mapping the sync will use the next time it
--     refreshes the same notice, i.e. it would recreate exactly the stored-vs-sync
--     drift this migration exists to remove. "SBP" is also already the stored string
--     on 24 production rows, so it joins existing vocabulary instead of inventing
--     one (the same deliberate-CODE convention 8AN already uses).
--   FLAGGED FOR THE OWNER — A VOCABULARY DECISION, NOT TAKEN HERE: if ONE label is
--   wanted for all three, `normalizeSetAside` needs an SBP rule first (SBP is the
--   code for SAM's "Small Business Set Aside - Partial", the full phrase the nightly
--   CSV ingest stores for it). That is a mapping change with its own corpus effect
--   (24 stored "SBP" rows), so it is not smuggled into a data migration.
--   CONSEQUENCE, STATED PLAINLY: this migration moves "8(a)" 85 -> 82, "WOSB"
--   +2 and "SBP" +1 — not "WOSB +3".
--
--   NO ORDERING CONSTRAINT, UNLIKE 065. 065 had to be applied at or after the
--   mapping fix or the 4-hourly sync could rewrite the old label. Here the stored
--   value and the normalizer agree by construction, so a later sync of the same
--   notice writes the same string this migration does.
--
-- ② THE run-065.ts verify() CHECK IS FIXED IN THE SAME PR (not in this file — it
--   lives in db/migrations/run-065.ts and the shared rule in
--   src/lib/set-aside-migration.ts). Its old check asserted statement 1's exception
--   list and statement 2's NONE list were DISJOINT, which is the opposite of the
--   design: statement 1 deliberately CONTAINS the 15 NONE ids (otherwise it would
--   stamp the total-small-business label on a notice SAM says has no set-aside, and
--   statement 2's `set_aside = '8(a)'` guard could no longer reach it), and statement
--   2 then nulls exactly those 15. The check therefore FAILED on every correct run.
--   It now asserts the overlap EQUALS the NONE list (15/15) and that the rows
--   statement 1 keeps reading "8(a)" forever are exactly 85 — so it passes on a
--   correct run and fails only on a real defect.
--
-- ③ THE STALE md_dc DUPLICATE, CLOSED (statement 3).
--
--   Production carries 226 rows under the retired `md_dc` source label.
--   `md_dc` is classified INTERNAL by src/lib/source-class.ts (a retired label), so
--   those rows count on the STATE & LOCAL side of the public counter, not the
--   federal one — measured 2026-10-19: isFederalLabel("md_dc") === false while
--   isFederalLabel("sam_gov") === true.
--
--   Exactly ONE of the 226 sits in the public counter today: id 4384, a stale
--   duplicate of id 409899, the row the nightly CSV ingest created for the SAME
--   notice:
--
--     id      source  external_id                                  due_date                  closed_at  created_at
--     4384    md_dc   mddc-dc-2412c3d99bcb4288a6e742a02b87129d    2026-10-27 14:00Z         NULL       2026-08-06
--     409899  sam_gov sam-2412c3d99bcb4288a6e742a02b87129d       2026-10-27 14:00Z         NULL       2026-10-19T03:30:34Z
--     (same title "Senior Leader Cutterhead Dredge Forum", same NoticeId, same due
--      date, and 4384 carries the sam.gov source_url for that NoticeId)
--
--   So one notice is counted TWICE (counter totalOpen 13,139 with it, 13,138
--   without). It cannot be resolved by relabelling: 4384's set_aside is NULL and
--   writing source = 'sam_gov' on it would ADD a second sam_gov row for one notice
--   — making the duplicate worse on the federal side of the split. Nor can the
--   nightly job ever close it: its close-out statement is scoped to
--   `source = 'sam_gov'` rows, so a retired-label row is outside it forever.
--
--   The close-out MIRRORS that nightly statement exactly (src/jobs/sam-csv-ingest.ts
--   §Close-out, `UPDATE bids SET closed_at = NOW(), updated_at = NOW() WHERE …
--   AND closed_at IS NULL`): closed_at + updated_at, and nothing else. `archive_date`
--   is deliberately NOT set: the close-out path never writes it — it is the CSV's own
--   `archiveDate` column, written by the ingest's upsert — and the live twin row
--   409899 already carries SAM's published value (2027-10-28) for this notice.
--   Inventing a value on a retired-label row would be a fact the CSV never published
--   for it.
--
--   The other 225 md_dc rows are LEFT ALONE (not in the counter, most with no sam_gov
--   twin) — flagged, not changed, as in 065.
--
-- IDEMPOTENT BY CONSTRUCTION. Statements 1 and 2 are pinned to 3 external_ids and
-- guarded by `set_aside = '8(a)'`, so a re-run matches nothing (a relabelled row no
-- longer reads "8(a)" — no created_at cut-off is needed because no other row can
-- match the frozen id list, and unlike 065 there is no future row whose correct
-- value could collide with the guard). Statement 3 is pinned to BOTH the surrogate
-- id and the natural key AND guarded by `closed_at IS NULL`, so a re-run cannot
-- re-stamp the timestamp. run-066.ts executes all three twice and asserts the
-- second run moves 0 rows and does not move closed_at.
--
-- ROLLBACK. Reversible by hand:
--   UPDATE bids SET set_aside = '8(a)'
--    WHERE external_id IN ('sam-f0c78ea349e342329b172564ad69ab4e',
--                          'sam-daab0dffa3044ad19e6d7ca610be2bc0',
--                          'sam-ecd2e2a033c147f0ba7f7de6fb14f528')
--      AND set_aside IN ('WOSB','SBP')   -- back to the pre-066 label
--   UPDATE bids SET closed_at = NULL, updated_at = NOW() WHERE id = 4384 AND source = 'md_dc'
--
-- AFTER APPLYING: record the before/after counts from the run-066.ts output (the PR
-- body quotes them) and re-run once to confirm the idempotent no-op.

UPDATE bids
   SET set_aside = 'WOSB'
 WHERE set_aside = '8(a)'
   AND external_id IN (
    'sam-f0c78ea349e342329b172564ad69ab4e',
    'sam-daab0dffa3044ad19e6d7ca610be2bc0'
   )
RETURNING id;

UPDATE bids
   SET set_aside = 'SBP'
 WHERE set_aside = '8(a)'
   AND external_id IN (
    'sam-ecd2e2a033c147f0ba7f7de6fb14f528'
   )
RETURNING id;

UPDATE bids
   SET closed_at = NOW(), updated_at = NOW()
 WHERE id = 4384
   AND source = 'md_dc'
   AND external_id = 'mddc-dc-2412c3d99bcb4288a6e742a02b87129d'
   AND closed_at IS NULL
RETURNING id;
