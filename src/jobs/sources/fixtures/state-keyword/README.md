# `state-keyword` door fixtures — provenance

Nationwide correctness FIX ⑤ (owner-locked scope, PR B1). These fixtures make the
door suite (`src/jobs/sources/state-keyword.test.ts`) deterministic and
zero-network: the door's **page fetcher and detail fetcher are injected**, and the
only bytes they may read are the four files below (plus two already-committed
`fixtures/sam-trades/` payloads).

| file | what it is | provenance |
|---|---|---|
| `doors-florida-page0.json` | a SAM.gov v1 `sgs/v1/search` response for `q=Florida`: the multi-state notice + one Florida-only notice | envelope/page block and the second item are **verbatim** from a page captured live on 2026-09-23 (`c3b14ddce163426288dc9957bb38692e`, "Sarasota Vet Center - New Lease (20Yrs) - Sarasota, FL"); the multi-state item is described below |
| `doors-virginia-page0.json` | the same response shape for `q=Virginia`, carrying **byte-identical** bytes of the multi-state notice | see above |
| `doors-illinois-page0.json` | a one-item page for `q=Illinois` carrying the **verbatim** Fermilab notice (`18011fdf88c84e35a15ee186f0b5c29f`, `parentNoticeId 7a176367f4944d2a91f948411bba07c1`) | copied verbatim out of `fixtures/sam-trades/naics-561720-page0.json` |
| `detail-multistate.json` | the SAM.gov **v2** opportunity payload for the multi-state notice: `data2.classificationCode = "Z111"`, `data2.naics = [{code:["238220"],type:"primary"}]`, `data2.type = "k"`, `data2.solicitationNumber = "N4008526R0219"`, `data2.placeOfPerformance = Annapolis, Maryland` | field-for-field the shape of the captured `fixtures/sam-trades/detail-561720.json` / `detail-v112.json` payloads, with the multi-state notice's own values |

Two further fixtures are **reused** rather than copied, so the repository holds no
duplicate bytes:

- `fixtures/sam-trades/detail-561720.json` — the real v2 payload for
  `7a176367f4944d2a91f948411bba07c1` (PSC `S201`, notice type `o`, solicitation
  `DH-377725`, place of performance `IL`). The Illinois-door test asserts the
  door's PSC / notice type / solicitation number / location come from it.
- `fixtures/sam-trades/psc-r602-page0.json` — the real `R602` page containing the
  **two Award Notices that share a title and an agency but have different `_id`s**.
  The guard test uses that pair to prove the run-level key is the NOTICE ID and
  not `(title, agency)`.

## The multi-state notice (`5c1e0f7a2d8b4a1e9f3c6b0d847a2e51`)

Its title prefix, solicitation number (`N4008526R0219`), agency
(`NAVFACSYSCOM MID-ATLANTIC`) and NAVFAC organization hierarchy come from the
**live duplicate group measured in the before-matrix census**
(`shared/nationwide-coverage-matrix-2026-09-23/census.json`, `Q14_dup_groups`:
`"n4008526r0219, design bid build - decentralize steam - provi"` /
`"navfacsyscom mid-atlantic"`, stored by **16 jurisdictions + `sam_gov`**).

The notice `_id`, the description text and the v2 payload values are written to
reproduce that live cross-door match: the description names locations in **two**
states (Florida and Virginia), which is why both the Florida and the Virginia door
query return it — the exact mechanism behind the 4,059 duplicate groups / 14,690
rows (one notice, one row per matching door). No production id is claimed for the
notice `_id`; the v2 payload is not a captured byte stream but is shape-identical
to the captured ones and is only ever read by an **injected** fetcher.

## What must NOT be inferred from these files

- The PSC values are fixture data; the point of the pin is that the door reads the
  PSC from the payload it already fetched, never that a particular code is right.
- Nothing here says a door's NAICS is authoritative: `detail-multistate.json`
  carries `naics [238220]` precisely so the test can assert the door does **not**
  copy it (NAICS stays inference-derived, `naics_code_source='inferred'`).
- `set_aside` is absent from door rows by design (owner-gated cert-matching
  decision, option E) — the saved payloads carry `SBA`/`NONE` so the pin is real.
