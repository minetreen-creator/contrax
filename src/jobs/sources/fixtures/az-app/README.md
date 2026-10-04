# az-app fixtures

Verbatim HTML (gzipped) of the Arizona Procurement Portal public list,
`https://app.az.gov/page.aspx/en/rfp/request_browse_public`, captured
2026-10-04 (no login, no CAPTCHA):

- `unfiltered-first-get-2026-10-04.html.gz`: the first GET (no filter).
- `open-page{0,1,2}-2026-10-04.html.gz`: the list after the Status =
  "Open for Bidding" search, then grid pages 2 and 3 (39 rows; 7 are 2019
  leftovers with a passed deadline).

Used by `../../az-app.test.ts`.
