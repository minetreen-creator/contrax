# mt-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Montana Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /montana/solicitations/open-bids` (page 1) | 143120 | `7be2a7127d89dfc00de7fed5a93823617d087a4bacf81724dc623ea8eaaa9703` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /montana/solicitations/open-bids/page2` | 143838 | `9d87c7c85023f120212709fdb82649bf4c333ce7f4deb140a53d5f8563daa2d3` |

From `https://www.bidnetdirect.com`. The heading read **"97 Open Solicitations"** over
**4** pages; the captured rows (50) read region "Montana" and carry the
`open` state.

Used by `../../mt-bidnet.test.ts`.
