# co-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Colorado Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /colorado/solicitations/open-bids` (page 1) | 146455 | `166110839b16c2826091034b936b64c43c2d7c4245daa3daba0b9b23a705f58e` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /colorado/solicitations/open-bids/page2` | 147018 | `199c80c8c811a855fd940049dd1944922a90f2e281798d89d19e1e7f62d0042e` |

From `https://www.bidnetdirect.com`. The heading read **"397 Open Solicitations"** over
**16** pages; the captured rows (50) read region "Colorado" and "Wyoming" and carry the
`open` state.

Used by `../../co-bidnet.test.ts`.
