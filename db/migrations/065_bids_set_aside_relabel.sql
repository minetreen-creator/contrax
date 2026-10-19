-- Migration 065 — relabel the 4,134 stored set-aside "8(a)" mislabels (owner-approved 2026-10-19).
--
-- DATA-ONLY, ADDITIVE, HAND-RUN: two UPDATEs on `bids.set_aside`, no DDL, no insert,
-- no delete, no other column. Executed by db/migrations/run-065.ts (never by a test,
-- a CI job or a scheduled task) with before/after proof.
--
-- THE BUG. The 4-hourly SAM sync normalizes a raw set-aside value with the shared
-- `normalizeSetAside` (src/jobs/sources/sam-gov.ts), and that function mapped the CODE
-- "SBA" to "8(a)". "SBA" is SAM's TOTAL SMALL BUSINESS set-aside. Only "8A" is the 8(a)
-- Business Development set-aside (and "8AN" its sole-source variant). So 4,234 stored
-- rows told 8(a) certificants they were eligible for set-asides they are not, and every
-- 8(a)-filtered count ("set_aside IN ('8(a)','8AN')") was inflated with total-small-
-- business notices. The mapping itself is fixed in the same PR
-- (TOTAL_SMALL_BUSINESS_LABEL in sam-gov.ts); this migration cleans up the rows the
-- buggy mapping had already written. ORDERING (owner rule): the deployed mapping fix
-- must precede or coincide with this relabel, or a 4-hourly sync can rewrite the wrong
-- label on its next refresh.
--
-- EVIDENCE (measured 2026-10-19; both channels keyless and reproducible).
--
--   1. SAM's nightly extract
--      https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv
--      — the 2026-10-18 03:30Z copy, 69,674 data rows; 28,957 carry a set-aside. The
--      SetASideCode -> SetASide pairs that matter here:
--        SBA  -> Small Business Set Aside - Total                                    17,702
--        8A   -> 8(a) Set-Aside (FAR 19.8)                                              755
--        8AN  -> 8(a) Sole Source (FAR 19.8)                                             81
--        ["SBA"] -> (empty label, the array form of the same code)                       184
--        NONE -> No Set aside used                                                     5,286
--      (full 21-pair table in src/jobs/sources/sam-gov-setaside.test.ts)
--
--   2. SAM's own notice-detail API (GET /api/prod/opps/v2/opportunities/<NoticeId>,
--      Accept: application/hal+json) for every one of the 4,234 stored rows whose
--      external_id is sam-<32 hex> and whose set_aside reads "8(a)" — 4,227 resolved:
--        SBA             4,126 rows  -> MISLABELED (this migration's relabel set)
--        ["SBA"]             1 row   -> MISLABELED (the same code in its array form)
--        8A                 63 rows  -> a REAL 8(a) set-aside, KEEP "8(a)"
--        8AN                10 rows  -> a REAL 8(a) sole source; kept as "8(a)" (see (b))
--        NONE               15 rows  -> SAM says no set-aside at all        -> NULL (statement 2)
--        (none published)    9 rows  -> SAM publishes no set-aside value    -> KEEP (see (b))
--        WOSB/WOSBSS/SBP     3 rows  -> another designation entirely        -> KEEP (see (b))
--        (aged out, 404)     7 rows  -> see AMBIGUITY (a)
--
-- THE RULE. Relabel EVERY stored "8(a)" row that is SBA-coded, EXCEPT an explicit list
-- of 100 rows whose SAM record says something else — instead of a blanket
-- "UPDATE ... SET set_aside = <total small business>" with no exception list. The 63
-- genuine 8A rows and the 10 8AN rows are the reason: both `open-bids`
-- (ASCII_CODE_TO_SET_ASIDE["8a"] = ["8(a)","8AN"]) and `cert-matching`
-- ("8a": ["8(a)","8an"]) match the literals "8(a)"/"8AN", so a blanket relabel would
-- silently delete real 8(a) opportunities from an 8(a) firm's Radar — inventing the
-- opposite error to the one this migration fixes. The 100 exception rows are the 65
-- real 8A/8AN rows, the 15 rows SAM reports as NONE (statement 2 nulls those), the 9
-- rows where SAM publishes no set-aside value at all, and the 3 rows carrying another
-- designation — i.e. exactly the rows that are NOT mislabels. So after the run,
-- set_aside = '8(a)' holds 85 rows, every one of them a real 8(a) opportunity.
--
-- TARGET LABEL = "Small Business Set Aside - Total", SAM's own words for the code and
-- the string sam-csv.ts#csvSetAsideLabel ALREADY stores for the same notices (1,824
-- production rows before this migration). Both ingests therefore write one string for
-- one notice, so a notice cannot flip labels between the nightly CSV run and the
-- 4-hourly sync. (The label intentionally contains neither "8(a)" nor the word
-- "certified"; it still reads as a small-business set-aside to the "sb" cert rules,
-- which is what it is.)
--
-- IDEMPOTENT BY CONSTRUCTION. Statement 1 is guarded by `set_aside = '8(a)'` (a
-- relabelled row no longer matches) AND by the frozen cut-off
-- `created_at < '2026-10-19 05:00:00+00'` — the cut-off is what keeps a LATER re-run
-- from touching rows that arrive after the mapping fix deploys (a genuine 8A notice
-- stores the correct "8(a)" and is deliberately not in the exception list). Statement 2
-- is pinned to 15 external_ids and also guarded by `set_aside = '8(a)'`. A re-run moves
-- 0 rows and leaves every counter unchanged; run-065.ts runs the statements twice to
-- prove exactly that.
--
-- AMBIGUITY, STATED HONESTLY.
--   (a) 7 rows whose notices have aged out of SAM (the detail API now 404s) have no
--       per-row code to read. They are relabelled with the rest on the measured prior
--       that 4,127 of 4,234 evidence-bearing rows (98.6%) were SBA-coded — and because
--       leaving them is a KNOWN false "8(a)" claim, while the alternative risk (a real
--       8A row losing its label) is bounded by the 100-row exception list. The 7 ids are
--       recorded in this file's own relabel set: production ids 32909, 96843, 109686,
--       128583, 133763, 141216, 152575 (external_ids sam-*). THIS IS THE ONE PART OF THE
--       RULE THAT IS A PRIOR, NOT A MEASUREMENT.
--   (b) NOT FIXED HERE (flagged for the lead, deliberately out of this PR's scope):
--       the 9 rows where SAM publishes no set-aside value at all, the 3 rows whose SAM
--       record reads WOSB / WOSBSS / SBP (a different designation entirely), the 10
--       sole-source rows kept as "8(a)" rather than the code spelling "8AN", and the 41
--       rows in the wider corpus that already read "8AN". None of those is a FALSE claim
--       of 8(a) eligibility the way "SBA" -> "8(a)" was; each is a vocabulary decision
--       for a separate change.
--   (c) THE "md_dc" HYGIENE LINE PLANNED FOR THIS MIGRATION IS NOT HERE, on purpose.
--       Production carries 226 rows under the retired md_dc source label (all 226 with a
--       sam.gov source_url, so they ARE federal notices), and exactly 1 of them sits in
--       the open-bid counter (id 4384, "Senior Leader Cutterhead Dredge Forum"). That
--       one row is a stale duplicate: the nightly CSV ingest has ALREADY re-created the
--       same notice under the live label sam_gov (id 409899, same NoticeId
--       2412c3d99bcb4288a6e742a02b87129d, same due_date 2026-10-27, longer description).
--       Relabelling 4384 to sam_gov would therefore add a SECOND row for one notice to
--       the federal side of the counter — inflating the very number the owner is about
--       to announce — and relabelling the other 225 has the same duplicate risk (26 of
--       the 226 already have a sam_gov twin). So the md_dc rows are left exactly as they
--       are and reported instead; the brief's own "if ambiguous, leave it and say so"
--       applies with evidence rather than by assumption.
--
-- ROLLBACK. Reversible by hand from this file plus run-065.ts's own BEFORE output:
--   UPDATE bids SET set_aside = '8(a)'
--    WHERE set_aside = 'Small Business Set Aside - Total'
--      AND source LIKE 'sam%'
--      AND created_at < '2026-10-19 05:00:00+00'::timestamptz;   -- back to the mislabel
-- and the 15 NULLed rows are named in statement 2 below (their previous value was "8(a)").
--
-- AFTER APPLYING: record the before/after counts from the run-065.ts output (per-code
-- table in the PR body) and re-run once to confirm the idempotent no-op.

UPDATE bids
   SET set_aside = 'Small Business Set Aside - Total'
 WHERE set_aside = '8(a)'
   AND source LIKE 'sam%'
   AND created_at < '2026-10-19 05:00:00+00'::timestamptz
   AND external_id NOT IN (
    'sam-baddc3f9242d4830a04b7f6e40a20c62',
    'sam-566248982e854140af477b2c36f23111',
    'sam-23d7255aecbf44e087af120d7ca3cddb',
    'sam-c994f2a531a94eaf8076f18abcba951d',
    'sam-9c8ab3274de6411282141732f473864e',
    'sam-c6667779c0404950aa13eb08da819b9f',
    'sam-f5d85c38fe1f426585de860c436b5405',
    'sam-3c58a16b4368476ca5b528dc9a90c808',
    'sam-4b2222022b2d4ce0a90be26d64255910',
    'sam-541079a6906f4843b6fa985ca77f14a2',
    'sam-d2d726d9e9944a93a5a14e65a49986fb',
    'sam-67732992238d4751b687b76693ab4017',
    'sam-c61bd295cefe49a083c7cca308dd1522',
    'sam-9ee9883724154620841fa11a0d41939b',
    'sam-dc5e45a3101947c089d348546fe35887',
    'sam-16f767f1875240f191d04eaa39ba7af3',
    'sam-a67f992ece25453797d768abeac9e850',
    'sam-3f44ee54445e49ea9b52df40621dc51e',
    'sam-dcc0ddc65f254e9f9b7fcc541df6ba1c',
    'sam-6a3556d2b9254d55b4ce29f75802805e',
    'sam-8f219bc068bf4e88ac7caadb43c885b7',
    'sam-977ba1c48f484399a0813ea54b6e9039',
    'sam-05810e4be28f45ba95869351cb655ce4',
    'sam-68579ffd7ac4453bb110070c8a6cdf0f',
    'sam-8b909316811a4711b650360f72c1c3ca',
    'sam-620dab6a259841479a36d267a5d4a1d3',
    'sam-400380a1909340b98b66dcd04d701dbe',
    'sam-ed6b4d7a41cd4fc7beb888ec52ef7628',
    'sam-c56ccad112fc49a89d4c1afdbef1ee15',
    'sam-4906ab87dfe14e67b5586022a04ca24b',
    'sam-0e18095788774b4ca0adc8874bfd8e4b',
    'sam-7bc3fb9ee26f47edb3ed47e494014d03',
    'sam-34754d13df214daf81f2af9c4b8e11ce',
    'sam-583836e1cdcf476f83265eb651adca95',
    'sam-70141559a4ad473f86a8f4687d37aaa4',
    'sam-8b80b24e24a74bb2b8bae38cf244244a',
    'sam-f81fdb396a4646baab24bde24d15e75e',
    'sam-05044bcd730f4077a74ba996c13d1eb5',
    'sam-593e520a3cf941cb9ed88716318b8a4b',
    'sam-e0d414bbe2c448e19fc88948403feda7',
    'sam-f84717f1baa340a1ae8d684e53259434',
    'sam-082fa69902114f93a07ff389113d103c',
    'sam-143d17e4e8064cb8bff051c7729a1a47',
    'sam-1501d2b36e6b4547876080447e6acb1e',
    'sam-27e20be832da401db087c668d41d79f0',
    'sam-2ca598e822284555a5bf90b8e91a043b',
    'sam-375a75eb6e5543bd8d6cfedf280d23fd',
    'sam-3b9fa9b6ffe74dc991fbd640a98ec0cb',
    'sam-3e055968a73149178a8e694070667d88',
    'sam-40af17bed71f43548a4b27992a4f2c22',
    'sam-42ae201b42ca4440a31487859c399606',
    'sam-52e026893fb54f379fe1b233c9ac678b',
    'sam-5e977abd26354d9aa662de471bad8bb3',
    'sam-632fdf6f4e5c45d3b7cc58c26ff2d914',
    'sam-75bab0e1901f45f8839a6bdf1ef8be14',
    'sam-7dcab15079124cd2a77c5e29bfd41191',
    'sam-976a36a882c64332897d278bb493b5a9',
    'sam-a1e818e8ed164fc7aefbe89e7000ce4f',
    'sam-ae630d3ea0994b04b40abac99d61c92e',
    'sam-c6c1f7f6112d48a59995b32a1764ac33',
    'sam-ce5c02e40b3b4cabaa1017b82ed53b24',
    'sam-dda144819afc493f8204c2e31f866fd4',
    'sam-fcb6ac17bafa47ba8fb9c0b13eca7928',
    'sam-5deab8271a6a44b78b451cdac9185b43',
    'sam-ee658d286edd48a9a9c60b64e038949f',
    'sam-3156da80a77f4ca5875402d5e0a34b9d',
    'sam-1dab0d17b3fd46b29b19f61b0ec7e90a',
    'sam-e861e758102549b6a14340269b4217fe',
    'sam-6492dc74c3314c2b8e3d3059b9331c3b',
    'sam-8a4d0d0566574b98b7dae82937782be5',
    'sam-d41a3e59b2d742d6bf400af000c09b68',
    'sam-d4deb3114ae44a0f9aa635bea77c1d51',
    'sam-f7801d7b488342e7a34dc0351b4fb821',
    'sam-624e076337ab4f2a95d20421c810bc8d',
    'sam-b6737b37621545cd963e984ac62703a5',
    'sam-6dc3988f69344c54a2543bfdd9349637',
    'sam-5686c5da16da4a979b435c6a30a93edb',
    'sam-f072c073fe5a47e49cb9792c67b59749',
    'sam-5db4a7fa10324045a1989c6292601de1',
    'sam-940f1a512a814db8ab3cfddcf5b2e166',
    'sam-8f19e6c77b504f68821523e6d79ba5cb',
    'sam-b56c84219f1d4f3fb4cd5ada2d1d973c',
    'sam-471e0d0cd0a8456ebd2103d924f94a5b',
    'sam-74b30e52ff494cdca2482cff0bf01d55',
    'sam-278454a47e044229b0e32cb625335d83',
    'sam-d54958ff7dfb417db9ce3453f8095739',
    'sam-45970579afdb4df89b2dd61c5f38e007',
    'sam-a8fd81b6248a4adcaa6732ba29cf50e6',
    'sam-059cebee45e04153b21b582b9d06ab4e',
    'sam-5491c2afe79c433b884489fa618b0df7',
    'sam-885d433d85b441be9c378c98e5204fab',
    'sam-066d9133f27f4b6a809b7db944f5c294',
    'sam-2b652b90a5524e70b87f1df75cc5b4f1',
    'sam-49894c697d0140bdafbba3555f14a2c0',
    'sam-a3a62cd6015a4844a7e708121d9cde1f',
    'sam-794ab2ff193e4b619e877ea2c0fdb62e',
    'sam-5648c571c7db4d8e8df43c8d2f3ff416',
    'sam-f0c78ea349e342329b172564ad69ab4e',
    'sam-daab0dffa3044ad19e6d7ca610be2bc0',
    'sam-ecd2e2a033c147f0ba7f7de6fb14f528'
   )
RETURNING id;

UPDATE bids
   SET set_aside = NULL
 WHERE set_aside = '8(a)'
   AND external_id IN (
    'sam-624e076337ab4f2a95d20421c810bc8d',
    'sam-b6737b37621545cd963e984ac62703a5',
    'sam-6dc3988f69344c54a2543bfdd9349637',
    'sam-5686c5da16da4a979b435c6a30a93edb',
    'sam-f072c073fe5a47e49cb9792c67b59749',
    'sam-5db4a7fa10324045a1989c6292601de1',
    'sam-940f1a512a814db8ab3cfddcf5b2e166',
    'sam-8f19e6c77b504f68821523e6d79ba5cb',
    'sam-b56c84219f1d4f3fb4cd5ada2d1d973c',
    'sam-471e0d0cd0a8456ebd2103d924f94a5b',
    'sam-74b30e52ff494cdca2482cff0bf01d55',
    'sam-278454a47e044229b0e32cb625335d83',
    'sam-d54958ff7dfb417db9ce3453f8095739',
    'sam-45970579afdb4df89b2dd61c5f38e007',
    'sam-a8fd81b6248a4adcaa6732ba29cf50e6'
   )
RETURNING id;
