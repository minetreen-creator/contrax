# de-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Delaware Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /delaware/solicitations/open-bids` (page 1) | 138501 | `73663a82f317d9c87e926b284c2447dead20366483f6459f9b0961c6fc8309d6` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /delaware/solicitations/open-bids/page2` | 138676 | `dc8a3f0a14649d34c82f9ffa97bce663c3a02eaba8537178c7cea200ad94161d` |

From `https://www.bidnetdirect.com`. The heading read **"73 Open Solicitations"** over
**3** pages; the captured rows (50) read region "Delaware" and carry the
`open` state.

Used by `../../de-bidnet.test.ts`.
