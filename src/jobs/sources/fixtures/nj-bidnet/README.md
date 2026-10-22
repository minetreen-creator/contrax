# nj-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
New Jersey Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /new-jersey/solicitations/open-bids` (page 1) | 144067 | `16343d0b3ebbcb2475921ddba2d76c2031fbbc1f090243f7f993b7b8503c1f1b` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /new-jersey/solicitations/open-bids/page2` | 144699 | `cb4a8777264874ae754d691b6746d45d844d3627ab3463c34877e0649651de21` |

From `https://www.bidnetdirect.com`. The heading read **"70 Open Solicitations"** over
**3** pages; the captured rows (50) read region "New Jersey" and carry the
`open` state.

Used by `../../nj-bidnet.test.ts`.
