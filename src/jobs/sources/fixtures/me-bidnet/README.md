# me-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Maine Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /maine/solicitations/open-bids` (page 1) | 137919 | `6a5024c6d738392772b7d3040356225cf284ec0c6380c3872d9bba9b0918fef4` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /maine/solicitations/open-bids/page2` | 138632 | `3b4e9c22cc35e9831dcef2ae9b3069c33eca9438720406036f3649f768c7ca97` |

From `https://www.bidnetdirect.com`. The heading read **"93 Open Solicitations"** over
**4** pages; the captured rows (50) read region "Maine" and carry the
`open` state.

Used by `../../me-bidnet.test.ts`.
