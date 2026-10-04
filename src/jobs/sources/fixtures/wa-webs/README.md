# wa-webs fixtures

HTML (gzipped) of the Washington WEBS public bid calendar,
`https://pr-webs-vendor.des.wa.gov/BidCalendar.aspx`, captured 2026-10-04
(no login, no CAPTCHA). The `__VIEWSTATE` and `__EVENTVALIDATION` values are
replaced with `STRIPPED` (they were ~127 KB each and the tests don't use them);
everything else is verbatim.

- `all-page{0..5}-2026-10-04.html.gz`: the unfiltered calendar, grid pages 1-6
  (127 bids; 2 marked "Selective").
- `org-16-wsdot-2026-10-04.html.gz`: filtered to "Transportation, Dept of" (5 bids).
- `org-3512-des-page{0,1}-2026-10-04.html.gz`: filtered to "Enterprise Services
  (DES), Dept. of", pages 1-2 (25 + 11 bids).

Used by `../../wa-webs.test.ts`.
