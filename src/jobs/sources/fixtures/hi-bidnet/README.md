# hi-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Hawaii Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /hawaii/solicitations/open-bids` (page 1) | 139485 | `9cf246af6817a0e5c53e44ec416ec39beadb9351118bec0c23ce29915c7bf151` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /hawaii/solicitations/open-bids/page2` | 139999 | `57baa8139660249e0cfebf5fede673b250d87d4ffc5f426ee862433efd102126` |

From `https://www.bidnetdirect.com`. The heading read **"246 Open Solicitations"** over
**10** pages; the captured rows (50) read region "Hawaii" and carry the
`open` state.

Used by `../../hi-bidnet.test.ts`.
