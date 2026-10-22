# ct-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Connecticut Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /connecticut/solicitations/open-bids` (page 1) | 139743 | `d4f3e9c2362af1770c6bd1a599345e653fe41c7143816bf4e8c9299192dc361f` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /connecticut/solicitations/open-bids/page2` | 140155 | `492b13dbcce88bf0d41bb40cb5072159dc2a6aad78049d1962bbd7d540494005` |

From `https://www.bidnetdirect.com`. The heading read **"212 Open Solicitations"** over
**9** pages; the captured rows (50) read region "Connecticut" and carry the
`open` state.

Used by `../../ct-bidnet.test.ts`.
