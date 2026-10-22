# nv-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Nevada Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /nevada/solicitations/open-bids` (page 1) | 138542 | `a448d05592279a0d1ef45c2adec06af665fcb37554305e9ca0c3f84adb893abc` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /nevada/solicitations/open-bids/page2` | 139230 | `6e96323addb50352f6b91595bc9bcd6b2fe882ba78362b7d8ba6e74d67f48714` |

From `https://www.bidnetdirect.com`. The heading read **"127 Open Solicitations"** over
**6** pages; the captured rows (50) read region "Nevada" and carry the
`open` state.

Used by `../../nv-bidnet.test.ts`.
