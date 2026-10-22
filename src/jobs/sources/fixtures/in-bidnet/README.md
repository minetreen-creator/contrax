# in-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Indiana Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /indiana/solicitations/open-bids` (page 1) | 139244 | `4a985a5b5c43155a48cd0f1e85eda441a6763ae255813255c8d4374c56262027` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /indiana/solicitations/open-bids/page2` | 139651 | `ea6dbafd7ab9a1cc8974b43fcbde9249ed17c62088d3ece0b6b9a010e23dc528` |

From `https://www.bidnetdirect.com`. The heading read **"212 Open Solicitations"** over
**9** pages; the captured rows (50) read region "Indiana" and carry the
`open` state.

Used by `../../in-bidnet.test.ts`.
