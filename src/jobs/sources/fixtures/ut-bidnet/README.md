# ut-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Utah Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /utah/solicitations/open-bids` (page 1) | 139772 | `63d0df6e2e49687793ab7399842b56352949f99f0afd91c4cf016d56362d6a3a` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /utah/solicitations/open-bids/page2` | 140182 | `baed2fe9e3be38750ecfc7e71ada39ba3b76bc09fb48a8fe1b428b51c7d5e241` |

From `https://www.bidnetdirect.com`. The heading read **"294 Open Solicitations"** over
**12** pages; the captured rows (50) read region "Utah" and carry the
`open` state.

Used by `../../ut-bidnet.test.ts`.
