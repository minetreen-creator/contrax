# oh-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Ohio Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's
own headers (desktop User-Agent, `Accept: text/html`, `Referer` = the list URL). No
login, no CAPTCHA solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /ohio/solicitations/open-bids` (page 1) | 154903 | `d3550820cc3b104973cbadfc07eeba695560f233ad93b71e0143b1371122593d` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /ohio/solicitations/open-bids/page2` | 155018 | `2776860fab918bcdaebabf310c0d83bbae653025f3ff93d7c99922fff105f90f` |

Both from `https://www.bidnetdirect.com`.

What the captures contained: the heading read **"1,452 Open
Solicitations"** and the page selector advertised **59** pages (past the
engine's default cap of 40, hence this group's own cap); pages 1 and 2 carry 25 rows
each, ids disjoint; every row's region read "Ohio" and every closing cell
carried the `open` state; closing dates 10/26/2026 … 11/25/2026; rows link with the
`/public/supplier/solicitations/<scope>/<id>/abstract` shape.

Used by `../../oh-bidnet.test.ts`.
