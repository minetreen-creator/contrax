# ar-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Arkansas Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /arkansas/solicitations/open-bids` (page 1) | 139146 | `cb84a6bc87fc002670e7d825db9acacf28363d218d11bfa89f2f4ddb9ad7f939` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /arkansas/solicitations/open-bids/page2` | 139506 | `d3279c23f1294a123b2bb499da62116f8c52357aa36569fdc3c3940421481317` |

From `https://www.bidnetdirect.com`. The heading read **"180 Open Solicitations"** over
**8** pages; the captured rows (50) read region "Arkansas" and carry the
`open` state.

Used by `../../ar-bidnet.test.ts`.
