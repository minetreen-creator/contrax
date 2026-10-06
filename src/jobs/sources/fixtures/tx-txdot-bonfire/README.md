# tx-txdot-bonfire fixture

`open-opportunities-2026-10-06.json.gz` is the verbatim JSON response (gzipped) of

```
GET https://txdot.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
```

the public call the TxDOT Bonfire portal page (`/portal/?tab=openOpportunities`)
makes to list its open opportunities. Captured **2026-10-06 ~05:58Z** from this
sandbox with browser-like headers (Chrome/141 UA, `Accept: application/json`,
`Referer: https://txdot.bonfirehub.com/portal/?tab=openOpportunities`) and the
portal's own `?_=<ms>` cache-buster — **no login, no cookie, no CAPTCHA**.

- 11,972 bytes on the wire; `success: 1`; `payload.projects` = **37** entries,
  every one `ProjectStatusID: "2"` (open); `payload.departments` = 8 entries.
- Row keys are exactly the platform shape: `ProjectID`, `PrivateProjectID`,
  `ReferenceID`, `ProjectStatusID`, `ProjectSubStatusID`, `ProjectVisibilityID`,
  `ProjectName`, `DateClose`, `DepartmentID`. Nothing is trimmed, offset or
  rewritten; the gzip is byte-for-byte `gzip -9 -n` of the captured body
  (sha256 of the .gz: `cc2ba1e051f225941c29dbffcebb78bc158a3c757f836d6c451d5a7d00b09a6b`).
- **No PII**: these are public solicitations and the payload carries no contact
  name, email, phone, address or attachment — only the fields listed above.

Provenance: capture + reader-fit run are recorded in the shared probe directory
`/home/team/shared/texas-bonfire-jaggaer-probe-2026-10-06/`
(`raw-txdot-bonfire-data.json`, `repoheader-txdot-bonfire.json` = the same body
re-fetched with the reader's own header set, `h-out.json` = the repo's
`parseUtBonfire()` over these bytes → 37/37 accepted, 0 skipped).

Used by `../../tx-bonfire.test.ts` (deterministic parser suite, zero network).
