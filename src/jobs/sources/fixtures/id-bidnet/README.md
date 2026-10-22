# id-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Idaho Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /idaho/solicitations/open-bids` (page 1) | 142964 | `a96ea936b92a4292285f15722d4b5b097bd0ace468748836f19b8e9579f69d59` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /idaho/solicitations/open-bids/page2` | 143677 | `8a1622814a9eb911263463ab3a49214e54d6e6c1490578d763cd3654e2578312` |

From `https://www.bidnetdirect.com`. The heading read **"88 Open Solicitations"** over
**4** pages; the captured rows (50) read region "Idaho" and carry the
`open` state.

Used by `../../id-bidnet.test.ts`.
