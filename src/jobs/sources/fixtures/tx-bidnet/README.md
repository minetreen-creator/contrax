# tx-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Texas Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's
own headers (desktop User-Agent, `Accept: text/html`, `Referer` = the list URL). No
login, no CAPTCHA solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /texas/solicitations/open-bids` (page 1) | 158876 | `7f60fac1c3ef8a5668d17a2c9411a529253c19b4b88de5841bc995995d6655d5` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /texas/solicitations/open-bids/page2` | 159504 | `e36596541f847b50a417679d7b5654ed91badcfb8ad9a94b0bb07c499a49a99e` |

Both from `https://www.bidnetdirect.com`.

What the captures contained: the heading read **"1,915 Open
Solicitations"** and the page selector advertised **77** pages (past the
engine's default cap of 40, hence this group's own cap); pages 1 and 2 carry 25 rows
each, ids disjoint; every row's region read "Texas" and every closing cell
carried the `open` state; closing dates 10/26/2026 … 12/02/2026; rows link with the
`/public/supplier/solicitations/<scope>/<id>/abstract` shape.

Used by `../../tx-bidnet.test.ts`.
