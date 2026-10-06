# nm-epronm fixture

`public-events-2026-10-06.html.gz` is the HTML (gzipped) of

```
GET https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=StateOfNewMexico
```

the State of New Mexico's public eProNM event list ("Open for Bid"),
captured 2026-10-06 (no login, no CAPTCHA): 10 open events. Verbatim except
that the short-lived signed query strings on document links (`X-Amz-*`) and
the per-event `AuthToken` values were removed before committing; the parser
reads neither. Used by `../../nm-epronm.test.ts`.
