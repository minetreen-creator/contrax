# wa-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Washington Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /washington/solicitations/open-bids` (page 1) | 142705 | `c66cdbf941c72ef24f4067a21c0fea9f4fddfa540a65666dbf38714fa7e2fa4f` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /washington/solicitations/open-bids/page2` | 143185 | `410524bfa72a04c58cb99aebe7ebd9e02d91f84c29ceb7243827639cd2054b80` |

From `https://www.bidnetdirect.com`. The heading read **"594 Open Solicitations"** over
**24** pages; the captured rows (50) read region "Washington" and carry the
`open` state.

Used by `../../wa-bidnet.test.ts`.
