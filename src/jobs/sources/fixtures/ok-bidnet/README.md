# ok-bidnet fixtures

Verbatim capture of BidNet Direct's **public, no-login** "open bids" list for the
Oklahoma Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /oklahoma/solicitations/open-bids` (page 1) | 133038 | `19aa481be5297ff4d2d000623d75df0628be211c9bf72a25318a6411a14b7341` |

From `https://www.bidnetdirect.com`. The heading read **"22 Open Solicitations"** over
a single page (no page selector); the captured rows (22) read region "Oklahoma" and carry the
`open` state.

Used by `../../ok-bidnet.test.ts`.
