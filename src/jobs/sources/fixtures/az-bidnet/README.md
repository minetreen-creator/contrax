# az-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Arizona Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /arizona/solicitations/open-bids` (page 1) | 144742 | `3221293a096ad69a0890dd5db1f07a3c33bfa170067b4fa2bad0d217e650b944` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /arizona/solicitations/open-bids/page2` | 145279 | `449062fa7d24ca95af4f01f3fe0858cac076ecc4fe1ce661b2ba19ad0eda851a` |

From `https://www.bidnetdirect.com`. The heading read **"251 Open Solicitations"** over
**11** pages; the captured rows (50) read region "Arizona" and carry the
`open` state.

Used by `../../az-bidnet.test.ts`.
