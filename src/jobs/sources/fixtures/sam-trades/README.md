# `sam-trades` fixture provenance — zero-yield trucking passes (FIX ④, PR B2)

Nationwide correctness FIX ④ (owner-locked scope, PR B2). The trade-pass suite
(`src/jobs/sources/sam-gov-trades.test.ts`) is deterministic and zero-network: the
**page fetcher and the detail fetcher are injected**, so the only bytes read are
the files in this directory. This file records where each byte came from, and —
for the two files that are NOT captures — says so explicitly.

## Captures (verbatim live SAM.gov v1 responses)

| file | request | provenance |
|---|---|---|
| `naics-484110-page0.json` | `GET https://sam.gov/api/prod/sgs/v1/search/?page=0&size=25&sort=-modifiedDate&mode=opportunities&q=&is_active=true&naics=484110` | **verbatim**, captured live 2026-09-23 with a browser-like `Accept` header. HTTP 200, `page = {size: 3, totalElements: 3, totalPages: 1, number: 0}`; 3 items: *Depot Consumable Parts Processing & Disposal (DEMIL)* (`e1829bc29d9e4807a20772f1e581daaf`, sol `FA857126Q0110`), *Removal of 32 FT Bathroom Trailer* (`9f0723de02054bcda5b6bb39a0c32847`, parent `ca7a25d9b8ea4c06bd7f05f5097c50d1`, sol `N6852026Q1052`), *91--Service, Diesel Fuel and Delivery* (`de184344e31e4beeb56fa19525022da1`, parent `ca7ca0a298d2422b91197d3c95ce5565`, sol `140P5426Q0035`). Nothing was trimmed: the whole live result set is 3 items. |
| `naics-484121-page0.json` | the same URL with `naics=484121` | **verbatim**, captured live 2026-09-23. HTTP 200, and the honest-empty signature: **no `_embedded` key at all** and `page = {size: 0, totalElements: 0, totalPages: 0, number: 0}` — SAM itself reports ZERO matching notices for this code. This is the file that proves the pass's zero is an honest zero, not a swallowed error (see the `zero_empty` pin). |
| `naics-484122-page0.json` | the same URL with `naics=484122` | **verbatim**, captured live 2026-09-23. HTTP 200, `page = {size: 1, totalElements: 1, ...}`; 1 item: *SV26.2 Linehaul, MHE, AGWASH Services* (`1fee13009b544bd5b57d2afca7d94a4f`, parent `81ccc8f3abff4074826cd14064221151`, sol `W912CL-26-Q-A033`, agency `0410 AQ HQ CONTRACT`). The same notice is stored in production under `sam_gov` (two legacy rows), which is why this pass reports `suppressed_duplicate` rather than a yield. |

Requests were issued 2026-09-23 ~13:46Z, page 0 only, `size=25`, one call per
code. The captures are read ONLY by injected fetchers in tests — the default test
run makes no network call (live-source validation is a separate opt-in gate, per
the owner's 2026-09-19 determinism guardrail).

## Authored envelopes (NOT captures — declared as such)

Both files below reproduce a **response shape** the pass must not mistake for an
honest empty. They are hand-written on purpose: we did not induce a 500 on the
official API, and SAM does not volunteer a contradictory `totalElements`.

| file | what it is | provenance |
|---|---|---|
| `envelope-error-500.json` | a Spring-whitelabel **error body** (`{"timestamp","status":500,"error","message","path"}`) | **AUTHORED** — reproduces the shape a SAM.gov Spring app returns for a 5xx (as contrasted with the v1 search envelope). It carries neither `_embedded.results` nor `page.totalElements`, which is exactly what `readSearchEnvelope` rejects. |
| `envelope-count-empty.json` | a v1 envelope whose `page.totalElements` is **3** while `_embedded.results` is `[]` | **AUTHORED** — reproduces the "SAM says it has matches and then hands over none" contradiction. The `_links.self` value is copied from the live `naics=484121` capture. A payload like this must fail loudly (`data_error`), never be recorded as a clean zero. |

## The live 484110 result set is why the gate exists (owner F4b pin, unchanged)

All three `naics=484110` notices are refused by the trucking gate with
`product_buy`, and three of the four live titles are pinned by the owner's
already-ratified test (`src/lib/janitorial-trucking.test.ts:264-266`: DEMIL parts /
32 FT Bathroom Trailer / Diesel Fuel + Delivery). **PR B2 does not change that
gate** — the pass is reachable, it accepts a legitimate trucking notice (see the
positive-control pin), and its zero is now reported as `all_skipped` with SAM's
own `totalElements = 3` instead of as a silent nothing.

## What must NOT be inferred from these files

- SAM's `totalElements` is the SOURCE's count of matching notices, not a coverage
  claim: `naics=484121` returning 0 means SAM has nothing coded 484121 *right
  now* — the corpus's 484121-tagged rows come from `wa` / `va` / `sam_gov` and are
  `naics_code_source = 'inferred'`, not SAM-coded.
- The 484122 notice being stored under `sam_gov` is the cross-source attribution
  in action (one row per notice, full metadata, winning label preserved). PR B2
  neither relabels nor deletes that row — owner rule: legacy rows are never
  backfilled.
