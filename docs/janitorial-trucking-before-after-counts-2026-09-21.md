# Janitorial + trucking ingestion — BEFORE / AFTER counts (owner rule 5, QA F6)

**PR:** minetreen-creator/contrax #414 · branch `feat/janitorial-trucking-ingestion`
**Captured:** 2026-09-21 (fix round) · **Nothing here is an after-count yet — the PR is NOT merged and NOT deployed.**

## Before (measured, production, SELECT-only)

Source: read-only production introspection run by QA and reproduced by the engineer
(`shared/janitorial-trucking-pr414-qa-evidence/prodcheck.out`, harness `prodcheck.ts`):

| metric | value |
|---|---|
| `bids` total rows | 34,022 |
| janitorial — `naics_code = '561720'` (all / open) | **327 / 18** |
| trucking family — `naics_code IN (484110,484121,484122,484210,484220,484230,492110)` (all / open) | **36 / 5** |
| rows under any new trade-pass source label (`sam_naics_*` / `sam_psc_*`) | **0** |
| migration 047 columns on `bids` (`psc`,`notice_type`,`solicitation_number`) | **0 present** |
| `idx_bids_solicitation_number` | **0 (absent)** |

Counting SQL (exactly what produced the numbers above):

```sql
SELECT count(*)::int AS all_rows,
       count(*) FILTER (WHERE due_date > NOW())::int AS open
FROM bids WHERE naics_code = '561720';

SELECT count(*)::int AS all_rows,
       count(*) FILTER (WHERE due_date > NOW())::int AS open
FROM bids WHERE naics_code IN ('484110','484121','484122','484210','484220','484230','492110');

SELECT count(*)::int AS n FROM bids WHERE source LIKE 'sam_naics_%' OR source LIKE 'sam_psc_%';
```

## After — **PENDING DEPLOY** (never invented in this PR)

No after-count exists or can exist yet: the trade passes have never run against
production (0 rows under the new source labels above), migration 047 is
deliberately **unapplied**, and this PR carries **no merge and no deploy**. The
column below is `pending-deploy` on purpose.

| metric | after (per state / source / category) |
|---|---|
| per existing source (`sam_gov`, `sam_gov_regional`, `sam_naics_561720`, …, `sam_psc_r602`, `pennbid`, `va_evirginia`, 50 state-keyword sources, cities/NYS) | **pending-deploy** |
| per trade category (`Janitorial`, `Transportation`) among the new rows | **pending-deploy** |
| states with **no connected source** (unchanged, documented) | **no change** |

**The exact post-deploy measurement** (run after the sync job completes against
production; read-only, SELECT-only):

```sql
-- 1) rows now held per trade-pass source label (before: 0)
SELECT source,
       count(*)::int AS all_rows,
       count(*) FILTER (WHERE due_date > NOW())::int AS open
FROM bids
WHERE source LIKE 'sam_naics_%' OR source LIKE 'sam_psc_%'
GROUP BY source ORDER BY source;

-- 2) per trade category among the trade-pass rows
SELECT category, count(*)::int AS all_rows,
       count(*) FILTER (WHERE due_date > NOW())::int AS open
FROM bids
WHERE source LIKE 'sam_naics_%' OR source LIKE 'sam_psc_%'
GROUP BY category ORDER BY all_rows DESC;

-- 3) janitorial / trucking reachability after ingest (compare to 327/18 and 36/5)
SELECT
  count(*) FILTER (WHERE naics_code = '561720')::int AS janitorial_all,
  count(*) FILTER (WHERE naics_code = '561720' AND due_date > NOW())::int AS janitorial_open,
  count(*) FILTER (WHERE naics_code IN ('484110','484121','484122','484210','484220','484230','492110'))::int AS trucking_all,
  count(*) FILTER (WHERE naics_code IN ('484110','484121','484122','484210','484220','484230','492110') AND due_date > NOW())::int AS trucking_open
FROM bids;

-- 4) per-state reachability (the owner's "all 50 states + DC" question) — the
--    trade-pass rows are federal notices, so this reports where they can be seen
--    LOCALLY, not where they were fetched from:
SELECT COALESCE(normalized_state,'(none)') AS state,
       count(*)::int AS trade_rows,
       count(*) FILTER (WHERE due_date > NOW())::int AS open
FROM bids
WHERE (source LIKE 'sam_naics_%' OR source LIKE 'sam_psc_%')
GROUP BY 1 ORDER BY trade_rows DESC;
```

## Scope honesty (owner rule 5)

- This PR delivers **nationwide federal** janitorial/trucking ingestion. It adds
  **no new state-local source** and **excludes R6** (`state=` vs the
  silently-ignored `placeOfPerformance.state=`, ~4× volume) and R7 (the Dayton
  connector) — so state/local coverage stays PA (PennBid) + VA (eVA) + NY + 5
  cities. "Across all 50 states + D.C." is **not** delivered by this PR.
- States with no connected source are unchanged and remain the open gap; they are
  listed in `shared/state-grants-*` and are not affected by this PR.

## The ≈360 projection — a PROJECTION, not reality (QA F5)

The audit's ~360 figure is a **filter dry-run projection**, labelled per code
below with its source. It is **not** an ingested count and must never be quoted
as one; page size caps each live count at 25 (QA's independent probe:
`484110=3, 484121=0, 484122=1, 484210=25, 484220=13, 484230=10, 492110=25,
561720=25` — lower bounds), which is why the totals below exceed some per-probe
numbers.

| code | projected | note |
|---|---|---|
| 561720 | ~40 (+ S201 overlap ~253 janitorial) | the janitorial set is ~253 active notices per the audit's live probe |
| 484110 | 3 | matches QA's live probe |
| 484121 | 0 | **live 0 — QA reproduced this** |
| 484122 | 1 | |
| 484210 | ~? (25 in QA's probe = page cap) | treat as ≥25 |
| 484220 | 13 | matches QA's live probe |
| 484230 | 10 | matches QA's live probe (>= 10) |
| 492110 | ≥25 | page cap |
| V112 / R602 | 18 / 28 | audit §3.6 live probes |
| **total** | **≈360 (projection)** | **unverified-but-plausible; not ingested reality** |

Reference: `shared/janitorial-trucking-audit-2026-09-21.md` (§3.5/§3.6) and
`shared/janitorial-trucking-pr414-qa-evidence/samprobe.out`.
