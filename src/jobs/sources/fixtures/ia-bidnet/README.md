# ia-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Iowa Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /iowa/solicitations/open-bids` (page 1) | 143948 | `363b449a9c73e5e37e030241dc0770dbf48220b866ca5d2e30eef6df0b597499` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /iowa/solicitations/open-bids/page2` | 144351 | `bd0e133aba5b5fdfe80907e7de96b280c717638a8e234fcf8e1a02173793073f` |

From `https://www.bidnetdirect.com`. The heading read **"236 Open Solicitations"** over
**10** pages; the captured rows (50) read region "Iowa" and carry the
`open` state.

Used by `../../ia-bidnet.test.ts`.
