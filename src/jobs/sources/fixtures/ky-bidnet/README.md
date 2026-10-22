# ky-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Kentucky Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /kentucky/solicitations/open-bids` (page 1) | 138852 | `ecf3cf5a70ad07ed7d7a35c932aa5d926f814f51c3456a2854b0d540c8bb4190` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /kentucky/solicitations/open-bids/page2` | 139439 | `36cef92deb2369b83a03e0996febcb1492ea3d50a1fba282e5c77f988ca5db67` |

From `https://www.bidnetdirect.com`. The heading read **"172 Open Solicitations"** over
**7** pages; the captured rows (50) read region "Kentucky" and carry the
`open` state.

Used by `../../ky-bidnet.test.ts`.
