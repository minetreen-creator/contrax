# nd-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
North Dakota Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /north-dakota/solicitations/open-bids` (page 1) | 138125 | `bd382e1108f58bb49da0830247360e5d9eb6eaff7030bdcca7ac4b1a59b1aea3` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /north-dakota/solicitations/open-bids/page2` | 138657 | `dc5b9321e04e337cfcd3effa485fc7b6b51767af43d42963899ffccc8da2b205` |

From `https://www.bidnetdirect.com`. The heading read **"61 Open Solicitations"** over
**3** pages; the captured rows (50) read region "North Dakota" and carry the
`open` state.

Used by `../../nd-bidnet.test.ts`.
