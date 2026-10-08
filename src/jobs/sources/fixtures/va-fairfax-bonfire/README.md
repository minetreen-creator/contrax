# Fairfax County Bonfire fixtures (`va_fairfax_bonfire`)
Read only by tests (`readFileSync` via `import.meta.url`), never by app code.
| File | What it is | as-fetched bytes | as-fetched sha256 | committed bytes | committed sha256 |
|---|---|---|---|---|---|
| `open-opportunities-2026-10-08-fetch1.json` | verbatim JSON body of the tenant's open-opportunities call, fetch 1 (the parse fixture) | 2234 | `1c3ee35de753157005068ca3b0b5d57ae8ffa109b7af45ec68c2409e75c0ed6b` | 2234 | `1c3ee35de753157005068ca3b0b5d57ae8ffa109b7af45ec68c2409e75c0ed6b` |
| `open-opportunities-2026-10-08-fetch2.json` | verbatim JSON body, fetch 2 (stability cross-check) | 2234 | `1c3ee35de753157005068ca3b0b5d57ae8ffa109b7af45ec68c2409e75c0ed6b` | 2234 | `1c3ee35de753157005068ca3b0b5d57ae8ffa109b7af45ec68c2409e75c0ed6b` |
The two hashes are IDENTICAL on purpose: the committed file is the as-fetched body
byte-for-byte (no gzip, no reformat, no re-serialisation), and **no edit of any kind was
made** — so "as-fetched" and "committed" are the same bytes by construction.

## Provenance
Captured **2026-10-08 01:43:58Z** from this sandbox with the connector's own request shape
(`bonfire-public.ts` → `fetchBonfireBids`), namely:
```
GET https://fairfaxcounty.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData?_=<ms>
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
  Accept: application/json
  Referer: https://fairfaxcounty.bonfirehub.com/portal/?tab=openOpportunities
```
**No login, no cookie, no CAPTCHA, no browser.** Both fetches: HTTP **200**, 2,234 bytes,
`success: 1`, `payload.projects` = **7** entries (every one `ProjectStatusID: "2"`),
`payload.departments` = **0** entries (this tenant publishes no department names — see
the connector's header). Full capture log:
`shared/va-bonfire-2026-10-08/capture-log.txt`.

## PII redaction — none needed, and none performed
A scan of both as-fetched bodies for emails and phone numbers returns **none**
(`emails=[]`, `phones=[]`), and the payload schema carries no contact field at all:
`ProjectID`, `PrivateProjectID` (an opaque per-project GUID, not a person), `ReferenceID`,
`ProjectStatusID`, `ProjectSubStatusID`, `ProjectVisibilityID`, `ProjectName`,
`DateClose`, `DepartmentID`. Nothing was redacted, so the parse fingerprint of these
bytes is by definition the fingerprint of the live response.

## Live-capture stability (2026-10-08)
TWO fetches were taken, 271 ms apart, with different `?_=` cache-busters; both were
**byte-identical** (same 2,234 bytes, same sha256) and parsed to the same row
fingerprint. Unlike a server-rendered HTML board there is nothing per-request in this
JSON (no session ids, no viewstate), so a byte comparison is meaningful here — the test
suite still compares the PARSED fingerprint, which is the property the connector relies
on.

## What the capture listed (quoted, not a standing count)
7 open projects: `254550` IFB 2000004412 · `252833` RFP 2000004251 - DRAFT · `256548`
IFB 2000004473 · `255790` RFP 2000004461 · `253098` RFP 2000004251 · `256205` IFB
2000004476 · `257005` CSAFY2027 - Quarter 2. Provenance of the reader-fit run:
`shared/va-bonfire-2026-10-08/` (raw bodies, capture log, live-gate run).
**Do not edit these files.** Re-capture instead. A parse failure against these bytes is
the intended signal that the live portal changed.
