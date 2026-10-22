# tn-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Tennessee Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /tennessee/solicitations/open-bids` (page 1) | 139228 | `300a39ce8b977ef7ebef6442814647ff185284f075e385646a8167e3b1360e01` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /tennessee/solicitations/open-bids/page2` | 140060 | `7b2973ada8ec757ff3169b46c2b0b3fd7b36a11c8b635aa7c2bd773067f8c804` |

From `https://www.bidnetdirect.com`. The heading read **"212 Open Solicitations"** over
**9** pages; the captured rows (50) read region "Tennessee" and carry the
`open` state.

Used by `../../tn-bidnet.test.ts`.
