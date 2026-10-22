# ne-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Nebraska Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /nebraska/solicitations/open-bids` (page 1) | 138385 | `633f3dcc39a8be353c90efbaf979215c014dfe17245b050404d4b4e6f06862a7` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /nebraska/solicitations/open-bids/page2` | 138901 | `3ae5602766af18756476cece0318d93363a5f0ddbbd82f012ff780265dafe52f` |

From `https://www.bidnetdirect.com`. The heading read **"106 Open Solicitations"** over
**5** pages; the captured rows (50) read region "Nebraska" and carry the
`open` state.

Used by `../../ne-bidnet.test.ts`.
