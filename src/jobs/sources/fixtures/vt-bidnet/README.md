# vt-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Vermont Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /vermont/solicitations/open-bids` (page 1) | 137928 | `bc45bf7624d26b3fc656eab8c8b88f7519d683c368e22acb8b03affb6e0dac70` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /vermont/solicitations/open-bids/page2` | 138614 | `e31d392c60411bcb125d61e505f1292cb446cdbe1679ae37143b0b94233d525b` |

From `https://www.bidnetdirect.com`. The heading read **"61 Open Solicitations"** over
**3** pages; the captured rows (50) read region "Vermont" and carry the
`open` state.

Used by `../../vt-bidnet.test.ts`.
