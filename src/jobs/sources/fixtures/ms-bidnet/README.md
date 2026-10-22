# ms-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Mississippi Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /mississippi/solicitations/open-bids` (page 1) | 144496 | `e80c809d955794c2fd9e74e00f1b636b7105b1117c3e378efcbd449e374bc6d8` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /mississippi/solicitations/open-bids/page2` | 145352 | `4923d70e028c4513a741d74d8325e3f80bbfc4cb51429ca02139bb42d4f6b707` |

From `https://www.bidnetdirect.com`. The heading read **"183 Open Solicitations"** over
**8** pages; the captured rows (50) read region "Mississippi" and carry the
`open` state.

Used by `../../ms-bidnet.test.ts`.
