# Bid-tabulation fixtures (ALDOT, Phase 1)

Captured **live** on 2026-10-08 by the research session
(`shared/bid-tabulations-research-2026-10-08/evidence/`) and copied here unchanged so
the tests are deterministic and never touch the network (owner guardrail 2026-09-19).

| File | Source URL | sha256 |
|---|---|---|
| `aldot_bidtabs.html` | `https://alletting.dot.state.al.us/DW_Pages/Bid_Tabs/Bidtabs.html` | `90d9ef2ee1bb2de2cdbcb5e710b6ba375f798afd4b5efde783a8010135b0a60c` |
| `aldot_bidtab_2026.html` | `https://alletting.dot.state.al.us/DW_Pages/Bid_Tabs/Bidtab_2026.html` | `aed91b77fa38bea24d6a2018f68695ae71b790e3bdae471e3a4886713c1ee1b0` |
| `aldot_ljan3026.pdf` | `https://alletting.dot.state.al.us/BidTabs/bidtab_pdf/ljan3026.pdf` | `aab516f84e96ebabd5b8eb5c1cfabefc251ecdbc37dbb87d4892c43d2a23d330` |

## Why the PDF is committed raw (and not the `.txt`)

The research session also captured a naive
text extraction of the same PDF (`aldot_ljan3026.txt`, 3.3 KB). It is **not** used as
the fixture: the naive capture is truncated, loses the per-bidder `Vendor Ranking`
tables entirely, and keeps no text positions — so it cannot exercise the thing this
reader is actually responsible for (keeping the publisher's own column/bidder
attribution). The PDF is 1.38 MB, in line with the largest existing fixtures in
`src/jobs/sources/fixtures` (521 KB), and gzip would save ~2 % because a PDF's streams
are already Flate-compressed. `aldot_ljan3026.txt` is therefore NOT committed; its
sha256 is recorded here for provenance: `a92e5fb6acb1710106618274d82c62d12388a7aeea32c8f26aba099a63ec7e65`.

## PII

None to redact. These are publisher documents about public construction contracts:
company names (the bidders), ALDOT contract/project numbers, counties and costs are
all published by the agency. No individual's personal data appears in the captured
pages or in the parsed fields.

## What the PDF contains (measured, this fixture)

* 305 pages / 9,461 extracted baselines; **35 contracts** (one per "call order").
* 35 `Vendor Ranking` pages; **96 ranked bidder rows**, every one of them with a
  cleanly parsed amount.
* 38 `Contract Totals` rows (three contracts print more than one — the row is a
  fallback source only; see `aldot-tabs.ts`).
* Contract `20260130067` (JEFFERSON, project `ATRP2-37-2024-109`) is the contract the
  owner's example describes: 3 bidders, $2,137,726.63 lowest, $2,413,157.95 highest.
  **Note:** ALDOT's own ranking page attributes the $2,137,726.63 low to
  **MCELHENNEY CONSTRUCTION CO., LLC**, not to BULLS CONSTRUCTION GROUP, LLC as the
  delegation brief's example sentence says. The brief asked for the owner's example
  *shape*; the data here is what the publisher actually states, and the surface renders
  the publisher's attribution.
