# la-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Louisiana Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /louisiana/solicitations/open-bids` (page 1) | 139941 | `0e0c6afcd812affc7d017cdeb6db14017359012abb014178127797005323a8f6` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /louisiana/solicitations/open-bids/page2` | 140733 | `4b4a6d85df32fe098cec3e70cde180c583818e7b68e77509ac51f718c772429f` |

From `https://www.bidnetdirect.com`. The heading read **"303 Open Solicitations"** over
**13** pages; the captured rows (50) read region "Louisiana" and carry the
`open` state.

Used by `../../la-bidnet.test.ts`.
