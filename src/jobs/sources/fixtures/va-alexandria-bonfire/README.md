# City of Alexandria Bonfire fixtures (`va_alexandria_bonfire`)
Read only by tests (`readFileSync` via `import.meta.url`), never by app code.
| File | What it is | as-fetched bytes | as-fetched sha256 | committed bytes | committed sha256 |
|---|---|---|---|---|---|
| `open-opportunities-2026-10-08-fetch1.json` | verbatim JSON body of the tenant's open-opportunities call, fetch 1 (the parse fixture) | 1211 | `24ddbe522ba0f9d4420607b8646e199214dec79d74a5a8002ad432f4818bb3b2` | 1211 | `24ddbe522ba0f9d4420607b8646e199214dec79d74a5a8002ad432f4818bb3b2` |
| `open-opportunities-2026-10-08-fetch2.json` | verbatim JSON body, fetch 2 (stability cross-check) | 1211 | `24ddbe522ba0f9d4420607b8646e199214dec79d74a5a8002ad432f4818bb3b2` | 1211 | `24ddbe522ba0f9d4420607b8646e199214dec79d74a5a8002ad432f4818bb3b2` |
The two hashes are IDENTICAL on purpose: the committed file is the as-fetched body
byte-for-byte (no gzip, no reformat, no re-serialisation), and **no edit of any kind was
made** — so "as-fetched" and "committed" are the same bytes by construction.

## Provenance
Captured **2026-10-08 01:43:58Z** from this sandbox with the connector's own request shape
(`bonfire-public.ts` → `fetchBonfireBids`), namely:
```
GET https://alexandriava.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData?_=<ms>
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
  Accept: application/json
  Referer: https://alexandriava.bonfirehub.com/portal/?tab=openOpportunities
```
**No login, no cookie, no CAPTCHA, no browser.** Both fetches: HTTP **200**, 1,211 bytes,
`success: 1`, `payload.projects` = **3** entries (every one `ProjectStatusID: "2"`),
`payload.departments` = **3** entries (`15584` "34 - General Services", `15586`
"41 - Transportation and Environmental Services (TES/DPI)", `15587`
"46 - Transit Services (DASH)"). Full capture log:
`shared/va-bonfire-2026-10-08/capture-log.txt`.

## PII redaction — none needed, and none performed
A scan of both as-fetched bodies for emails and phone numbers returns **none**
(`emails=[]`, `phones=[]`), and the payload schema carries no contact field at all:
`ProjectID`, `PrivateProjectID` (an opaque per-project GUID, not a person), `ReferenceID`,
`ProjectStatusID`, `ProjectSubStatusID`, `ProjectVisibilityID`, `ProjectName`,
`DateClose`, `DepartmentID`. Nothing was redacted, so the parse fingerprint of these
bytes is by definition the fingerprint of the live response.

## Live-capture stability (2026-10-08)
TWO fetches were taken, 243 ms apart, with different `?_=` cache-busters; both were
**byte-identical** (same 1,211 bytes, same sha256) and parsed to the same row
fingerprint. Unlike a server-rendered HTML board there is nothing per-request in this
JSON (no session ids, no viewstate), so a byte comparison is meaningful here — the test
suite still compares the PARSED fingerprint, which is the property the connector relies
on.

## What the capture listed (quoted, not a standing count)
3 open projects: `231851` ref 2009 · `251367` ref 2037 (the DOT Paratransit /
City Programs transportation services solicitation) · `250710` ref 2036. Provenance of
the reader-fit run: `shared/va-bonfire-2026-10-08/` (raw bodies, capture log, live-gate
run). **Do not edit these files.** Re-capture instead. A parse failure against these bytes
is the intended signal that the live portal changed.
