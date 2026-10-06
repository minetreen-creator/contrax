# tx-uttyler-bonfire fixture

`open-opportunities-2026-10-06.json.gz` is the verbatim JSON response (gzipped) of

```
GET https://uttyler.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
```

the public call the UT Tyler Bonfire portal page (`/portal/?tab=openOpportunities`;
the bare `/opportunities` URL 307-redirects there) makes to list its open
opportunities. Captured **2026-10-06 ~05:58Z** from this sandbox with the same
browser-like header set as the TxDOT capture — **no login, no cookie, no CAPTCHA**.

- 785 bytes on the wire; `success: 1`; `payload.projects` = **2** entries, both
  `ProjectStatusID: "2"` (open); `payload.departments` = 1 entry (`Procurement`).
- The tenant is the **University of Texas at Tyler** portal and it hosts BOTH
  UT Tyler and UT Health Science Center at Tyler rows (their titles say which);
  there is no separate UTHSCT tenant. Nothing is trimmed, offset or rewritten;
  the gzip is byte-for-byte `gzip -9 -n` of the captured body (sha256 of the .gz:
  `8e784a08c42cc22faf6fb7424fab1f7a9a2909a6fc1f2784efcb35d079d7e906`).
- **No PII**: public solicitations only — the payload carries no contact name,
  email, phone, address or attachment.

Provenance: `/home/team/shared/texas-bonfire-jaggaer-probe-2026-10-06/`
(`raw-uttyler-bonfire-data.json`, `raw-uttyler-portal-open-follow.html`,
`repoheader-uttyler-bonfire.json`, `h-out.json` = `parseUtBonfire()` over these
bytes → 2/2 accepted, 0 skipped).

Used by `../../tx-bonfire.test.ts` (deterministic parser suite, zero network).
