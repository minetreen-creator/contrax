# sc-bidnet fixtures

Verbatim captures of BidNet Direct's **public, no-login** "open bids" list for the
South Carolina Purchasing Group, fetched 2026-10-22 with a plain GET and the engine's own headers (desktop
User-Agent, `Accept: text/html`, `Referer` = the list URL). No login, no CAPTCHA
solved, no JavaScript, no cookies, no POST.

| File | Captured from | Bytes (pre-gzip) | sha256 (pre-gzip) |
| ---- | ------------- | ---------------- | ----------------- |
| `open-bids-2026-10-22.html.gz` | `GET /south-carolina/solicitations/open-bids` (page 1) | 147953 | `8907195348b7c5e6d173681d3e0c6e01e748eec2652e10b3048caf06956d037d` |
| `open-bids-page2-2026-10-22.html.gz` | `GET /south-carolina/solicitations/open-bids/page2` | 148743 | `863d643311c5876d44695d40cb8240cdfb59178cf270453959421814d4f20f43` |

From `https://www.bidnetdirect.com`. The heading read **"577 Open Solicitations"** over
**24** pages; the captured rows (50) read region "South Carolina" and carry the
`open` state.

Used by `../../sc-bidnet.test.ts`.
