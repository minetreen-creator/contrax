# al-bidnet fixtures

Verbatim capture of BidNet Direct's **public, no-login** "open bids" list for the
Alabama Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /alabama/solicitations/open-bids` (page 1) | 112958 | `c27874d5f9796c6c2bc4bfce6391042ffe697d1cec48fcdcb53977d9c61dbff5` |

From `https://www.bidnetdirect.com`. The heading read **"15 Open Solicitations"** over
a single page (no page selector); the captured rows (15) read region "Alabama" and carry the
`open` state.

Used by `../../al-bidnet.test.ts`.
