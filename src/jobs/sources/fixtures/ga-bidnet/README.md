# ga-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
Georgia Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /georgia/solicitations/open-bids` (page 1) | 147021 | `6b16b3d22bb1008b517eeb0b308365fb31bf2569da895464cbb7f36f12409ce8` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /georgia/solicitations/open-bids/page2` | 147602 | `5aa58bcd41bb236f403edd080cf93b04d713307134c0ff7cbcf1ac1a3c433bdd` |

From `https://www.bidnetdirect.com`. The heading read **"509 Open Solicitations"** over
**21** pages; the captured rows (50) read region "Georgia" and carry the
`open` state.

Used by `../../ga-bidnet.test.ts`.
