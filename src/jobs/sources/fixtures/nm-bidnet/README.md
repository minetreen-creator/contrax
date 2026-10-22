# nm-bidnet fixtures

Verbatim capture of BidNet Direct's **public, no-login** "open bids" list for the
New Mexico Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /new-mexico/solicitations/open-bids` (page 1) | 118586 | `1a16ff865b5e7089db5b0b9872a34e7f4e0ea59ca23847fdcc0f24bea01060dd` |

From `https://www.bidnetdirect.com`. The heading read **"17 Open Solicitations"** over
a single page (no page selector); the captured rows (17) read region "New Mexico" and carry the
`open` state.

Used by `../../nm-bidnet.test.ts`.
