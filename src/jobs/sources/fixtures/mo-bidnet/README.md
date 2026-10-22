# mo-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Missouri Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /missouri/solicitations/open-bids` (page 1) | 146394 | `c6f23f5d8b7d44125070adf7f619a76f4c474e3cf4a75e1c893b7a4eda21250e` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /missouri/solicitations/open-bids/page2` | 147013 | `698f18f613122fb91d840b027126daff801539e1dcf8e100f204f2d8715d792f` |

From `https://www.bidnetdirect.com`. The heading read **"428 Open Solicitations"** over
**18** pages; the captured rows (50) read region "Missouri" and carry the
`open` state.

Used by `../../mo-bidnet.test.ts`.
