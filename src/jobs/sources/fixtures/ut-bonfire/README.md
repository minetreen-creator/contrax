# ut-bonfire fixture

`open-opportunities-2026-10-05.json.gz` is the verbatim JSON response (gzipped) of

```
GET https://utah.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData
```

the public call the Utah U3P portal page (`/portal/?tab=openOpportunities`)
makes to list open opportunities, captured 2026-10-05 (no login, no CAPTCHA):
186 open projects from 44 organizations. Used by `../../ut-bonfire.test.ts`.
