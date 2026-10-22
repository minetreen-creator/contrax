# pa-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Pennsylvania Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's
own headers (desktop User-Agent, `Accept: text/html`, `Referer` = the list URL). No
login, no CAPTCHA solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /pennsylvania/solicitations/open-bids` (page 1) | 148803 | `075ffd8bf52251081c7385df1b96c2efded260e11c3ad27444f62a0618940450` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /pennsylvania/solicitations/open-bids/page2` | 149348 | `1c37b16b6cc71750bb8228c340ddb83a18bac5715eb779daa75ce22a1e12d1f2` |

Both from `https://www.bidnetdirect.com`.

What the captures contained: the heading read **"1,263 Open
Solicitations"** and the page selector advertised **51** pages (past the
engine's default cap of 40, hence this group's own cap); pages 1 and 2 carry 25 rows
each, ids disjoint; every row's region read "Pennsylvania" and every closing cell
carried the `open` state; closing dates 10/23/2026 … 09/30/2027; rows link with the
`/public/supplier/solicitations/<scope>/<id>/abstract` shape.

Used by `../../pa-bidnet.test.ts`.
