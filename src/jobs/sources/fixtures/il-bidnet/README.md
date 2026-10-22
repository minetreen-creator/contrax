# il-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Illinois Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /illinois/solicitations/open-bids` (page 1) | 150537 | `5e2a16236b229b0cad2fea1b7d4e3e3530e866a06a0415259bd8f66916fd0f3d` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /illinois/solicitations/open-bids/page2` | 151297 | `1a9d17c07e9a7805679576e735d7c273684a7cb59b87ef85ddddaa722bd348a0` |

From `https://www.bidnetdirect.com`. The heading read **"909 Open Solicitations"** over
**37** pages; the captured rows (50) read region "Illinois" and carry the
`open` state.

Used by `../../il-bidnet.test.ts`.
