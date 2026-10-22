# ma-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Massachusetts Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /massachusetts/solicitations/open-bids` (page 1) | 151323 | `e6c4e6f653661c55ce8323f177d6f18787666ed3fe7660c573be94e7a16ea97f` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /massachusetts/solicitations/open-bids/page2` | 151694 | `5e43a683eacd8c9ac3c58899a575878c06d59945d2645a77919a7319838ec455` |

From `https://www.bidnetdirect.com`. The heading read **"910 Open Solicitations"** over
**37** pages; the captured rows (50) read region "Massachusetts" and carry the
`open` state.

Used by `../../ma-bidnet.test.ts`.
