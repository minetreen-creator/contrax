# mn-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Minnesota Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /minnesota/solicitations/open-bids` (page 1) | 145791 | `5ad600dae71245577520973724e48c7692bf580980e9ee3379f819fbb99197b9` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /minnesota/solicitations/open-bids/page2` | 146873 | `8a0d52f6bdfe7d5be61acee45f36bca1a6a250c381d1c36cde7007d31b9f3f7b` |

From `https://www.bidnetdirect.com`. The heading read **"355 Open Solicitations"** over
**15** pages; the captured rows (50) read region "Minnesota" and carry the
`open` state.

Used by `../../mn-bidnet.test.ts`.
