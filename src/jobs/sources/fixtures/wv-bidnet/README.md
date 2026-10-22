# wv-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
West Virginia Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /west-virginia/solicitations/open-bids` (page 1) | 138771 | `39700ddd09d102172a9e91dcebff251278a218afc3d53ba932b8febfcde55867` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /west-virginia/solicitations/open-bids/page2` | 139287 | `b46d62552473ecd9c8cbd36e57f7792d0b394c1e50adbbb038b900174ac2da0d` |

From `https://www.bidnetdirect.com`. The heading read **"104 Open Solicitations"** over
**5** pages; the captured rows (50) read region "West Virginia" and carry the
`open` state.

Used by `../../wv-bidnet.test.ts`.
