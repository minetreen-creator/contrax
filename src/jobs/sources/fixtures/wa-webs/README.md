# wa-webs fixtures

HTML (gzipped) of the WEBS public bid calendar,
`https://pr-webs-vendor.des.wa.gov/BidCalendar.aspx`, captured 2026-10-04
(no login, no CAPTCHA):

- `open-page{0..5}-2026-10-04.html.gz`: the first GET and pager pages 2 to 6
  (127 open solicitations, 25 per page).
- `org-<value>-p<n>-2026-10-04.html.gz`: the list after choosing each
  "Filter by Government Organization" entry (value from the dropdown) and
  pressing Search, then its pager pages. 42 organizations; every listed bid
  appears under exactly one.

Every file is verbatim except that the `__VIEWSTATE` and `__EVENTVALIDATION`
values are blanked in all but `open-page0` (they are opaque, large, and not
read by the parser), to keep the fixtures small.

Used by `../../wa-webs.test.ts`.
