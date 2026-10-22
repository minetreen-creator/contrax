# ri-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Rhode Island Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /rhode-island/solicitations/open-bids` (page 1) | 143784 | `16045ddf2714f36f3cbe6a6c21c4246a385201e4d157e9e5d52f34f5b72960dc` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /rhode-island/solicitations/open-bids/page2` | 140742 | `d7c43d4753e3e9f5320cd6c155b5e27b11443e702791eda3121ec7bcf296ea85` |

From `https://www.bidnetdirect.com`. The heading read **"48 Open Solicitations"** over
**2** pages; the captured rows (48) read region "Rhode Island" and carry the
`open` state.

Used by `../../ri-bidnet.test.ts`.
