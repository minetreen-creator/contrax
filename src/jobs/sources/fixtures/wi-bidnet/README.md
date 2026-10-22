# wi-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Wisconsin Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /wisconsin/solicitations/open-bids` (page 1) | 139524 | `8daa6ef184d8d94a7356a048c68c10b36628752466b8bf85fd2f5070ee585ad6` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /wisconsin/solicitations/open-bids/page2` | 140172 | `9ba80cf5166d7c1b3287269a3ea2e946e9aade1fb9a117a9ac4ae346a66abfd4` |

From `https://www.bidnetdirect.com`. The heading read **"250 Open Solicitations"** over
**10** pages; the captured rows (50) read region "Wisconsin" and carry the
`open` state.

Used by `../../wi-bidnet.test.ts`.
