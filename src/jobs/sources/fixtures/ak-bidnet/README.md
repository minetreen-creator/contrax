# ak-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Alaska Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /alaska/solicitations/open-bids` (page 1) | 143401 | `40d58cf4962f1a1c86748313da9d9da4e1c38e693eb43205e25cac406956c8cb` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /alaska/solicitations/open-bids/page2` | 143704 | `77e4cafe7809a1019a7d4dd8c15106e9e1ed2b22168a45ff059e936c19f7d6a1` |

From `https://www.bidnetdirect.com`. The heading read **"92 Open Solicitations"** over
**4** pages; the captured rows (50) read region "Alaska" and carry the
`open` state.

Used by `../../ak-bidnet.test.ts`.
