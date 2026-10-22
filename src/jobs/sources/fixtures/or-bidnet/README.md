# or-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Oregon Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /oregon/solicitations/open-bids` (page 1) | 145108 | `10b409343b289dfe4f7c793f441b0cec0dc948eb2ade557c715f03816814e73a` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /oregon/solicitations/open-bids/page2` | 145714 | `9ac4172261cf75e30eab02e7393ffe0a2919a704ef6c27706c664ed582d219bb` |

From `https://www.bidnetdirect.com`. The heading read **"318 Open Solicitations"** over
**13** pages; the captured rows (50) read region "Oregon" and carry the
`open` state.

Used by `../../or-bidnet.test.ts`.
