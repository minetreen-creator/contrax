# md-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Maryland Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /maryland/solicitations/open-bids` (page 1) | 146909 | `557e59ad42e33b7427fc0506d47bf52d53cad52c9808cac3005ff7cc6ea410eb` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /maryland/solicitations/open-bids/page2` | 147377 | `9addf4ae8a64c80060cb1251845ae00c5fc9b232b4cdbb7e7af8133cd83b7344` |

From `https://www.bidnetdirect.com`. The heading read **"451 Open Solicitations"** over
**19** pages; the captured rows (50) read region "Maryland" and carry the
`open` state.

Used by `../../md-bidnet.test.ts`.
