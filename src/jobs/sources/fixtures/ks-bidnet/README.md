# ks-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Kansas Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /kansas/solicitations/open-bids` (page 1) | 138621 | `b4d8e698e39f89476c4ed2c99bcc15b1793170b020ad82fac609430a6282c292` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /kansas/solicitations/open-bids/page2` | 139324 | `83eb3566131d37bc34b1aee936d1ded1dcd5a3d5d0ee3008b27bc08e17a41307` |

From `https://www.bidnetdirect.com`. The heading read **"160 Open Solicitations"** over
**7** pages; the captured rows (50) read region "Kansas" and carry the
`open` state.

Used by `../../ks-bidnet.test.ts`.
